import { prisma } from "@/lib/prisma"
import {
  decidirCiclo,
  type EngineMessage,
  type LeadCycleDecision,
} from "@/lib/campaign-engine-schedule"
import { recordAppLog } from "@/services/app-logs"
import { encerrarCampanhasExpiradas } from "@/services/campaigns"
import { sendCampaignMessageToLead } from "@/services/evolution"
import { recordMessageEvent } from "@/services/message-events"
import { getSettings } from "@/services/settings"

/**
 * Número máximo de tentativas de envio por mensagem dentro de um ciclo.
 *
 * Cada falha de envio grava um evento de timeline `falha`. Quando o total de
 * falhas de uma mensagem no ciclo atual atinge este limite, a engine para de
 * tentar (a mensagem passa a ser tratada como "resolvida", liberando a
 * sequência) e registra a desistência nos logs e eventos. Ao reiniciar o ciclo
 * pela recorrência, a contagem zera — pois só valem as falhas após a âncora.
 */
export const MAX_TENTATIVAS_ENVIO = 3

/**
 * Descrição exata gravada no evento de timeline quando a engine desiste de uma
 * mensagem. É usada como marcador DURÁVEL: nos ticks seguintes, a presença deste
 * evento indica que a mensagem já foi abortada neste ciclo, então ela não é
 * recontada como tentativa nem tem a desistência registrada de novo.
 */
export const ABORT_DESCRICAO = `Envio abortado após ${MAX_TENTATIVAS_ENVIO} tentativas.`

/**
 * Engine de disparo das campanhas.
 *
 * Este é o processo que faltava: percorre todas as campanhas ativas e, para
 * cada lead vinculado, envia a próxima mensagem quando o horário previsto chega,
 * avançando a sequência, aplicando a recorrência ao terminar e respeitando a
 * data limite. É chamado de forma recorrente por `instrumentation.ts` (timer
 * interno do servidor) e também pode ser acionado externamente via
 * `POST /api/cron`.
 */

export interface EngineResult {
  processados: number
  enviados: number
  reiniciados: number
  encerrados: number
  ignorado?: boolean
}

// Evita que duas execuções (timer + chamada manual) rodem ao mesmo tempo no
// mesmo processo e disparem a mesma mensagem duas vezes.
let emAndamento = false

function calcularAncora(marcos: Array<Date | null | undefined>, fallback: Date): Date {
  const validos = marcos.filter(Boolean) as Date[]
  return validos.length ? new Date(Math.max(...validos.map((d) => d.getTime()))) : fallback
}

/** Converte o período de espera entre lotes (valor + unidade) em milissegundos. */
function calcularPeriodoEsperaMs(valor: number, unidade: string): number {
  const base = unidade === "minutos" ? 60_000 : 3_600_000
  return Math.max(0, valor) * base
}

/**
 * Orçamento de envios permitido NESTE tick, aplicando o "Ritmo de envio"
 * configurado globalmente:
 *
 *   - `limiteDiario`: teto de mensagens enviadas por dia. Ao ser atingido,
 *     nada mais é disparado até a virada do dia.
 *   - `maxEnviosPorPeriodo`: tamanho máximo de cada lote.
 *   - período de espera: intervalo mínimo entre um lote e o próximo.
 *
 * O lote atual é inferido a partir dos horários reais de envio (timeline):
 * envios consecutivos separados por menos que o período pertencem ao mesmo
 * lote. Quando o lote enche, o cálculo naturalmente zera o orçamento até que o
 * período de espera decorra desde o último envio — momento em que um novo lote
 * pode começar. Como a base é durável (eventos no banco), o ritmo é respeitado
 * mesmo entre reinícios do processo.
 */
function calcularOrcamentoRitmo(
  enviosRecentesDesc: Array<{ data: Date }>,
  agora: Date,
  limiteDiario: number,
  maxEnviosPorPeriodo: number,
  periodoEsperaMs: number,
): number {
  const enviadosHoje = enviosRecentesDesc.length
  const restanteDia = Math.max(0, limiteDiario - enviadosHoje)
  if (restanteDia <= 0) return 0

  // Conta quantos envios pertencem ao lote atual: caminha do mais recente para
  // trás enquanto a distância entre envios consecutivos for menor que o período.
  // Se o último envio já ficou além do período, o loop para em 0 => novo lote.
  let loteAtual = 0
  let anterior = agora.getTime()
  for (const envio of enviosRecentesDesc) {
    if (anterior - envio.data.getTime() < periodoEsperaMs) {
      loteAtual += 1
      anterior = envio.data.getTime()
    } else {
      break
    }
  }

  const restanteLote = Math.max(0, maxEnviosPorPeriodo - loteAtual)
  return Math.min(restanteDia, restanteLote)
}

async function enviarMensagem(
  vinculo: { leadId: string; lead: { telefone: string } },
  campanhaId: string,
  mensagem: EngineMessage,
  reiniciouCiclo: boolean,
  instanciaNome: string | null,
): Promise<boolean> {
  try {
    const envio = await sendCampaignMessageToLead({
      leadId: vinculo.leadId,
      campanhaId,
      mensagemId: mensagem.id,
      texto: mensagem.texto,
      telefone: vinculo.lead.telefone,
      instanciaNome,
      descricaoSucesso: reiniciouCiclo
        ? "Ciclo reiniciado: primeira mensagem reenviada pela engine."
        : mensagem.dia === 0
          ? "Mensagem inicial da campanha enviada pela engine."
          : "Mensagem da sequência enviada pela engine.",
      descricaoFalha: "Falha ao enviar mensagem da sequência pela engine.",
    })
    return envio.ok
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "campaigns",
      mensagem: `Exceção ao disparar mensagem ${mensagem.id} para lead ${vinculo.leadId} na campanha ${campanhaId}.`,
      detalhes: error,
    })
    return false
  }
}

export async function processDueMessages(agora: Date = new Date()): Promise<EngineResult> {
  if (emAndamento) return { processados: 0, enviados: 0, reiniciados: 0, encerrados: 0, ignorado: true }
  emAndamento = true

  try {
    // Encerra campanhas com data limite vencida ANTES de disparar qualquer coisa.
    const encerradas = await encerrarCampanhasExpiradas()

    // Configuração global: quando ativa, nenhum disparo cai no fim de semana e
    // os disparos respeitam a janela de horário permitida.
    const {
      pausarNoFimDeSemana,
      respeitarJanela,
      janelaInicio,
      janelaFim,
      limiteDiario,
      maxEnviosPorPeriodo,
      periodoEsperaValor,
      periodoEsperaUnidade,
    } = await getSettings()
    const janela = { ativa: respeitarJanela, inicio: janelaInicio, fim: janelaFim }

    // Ritmo de envio: teto diário, tamanho do lote e intervalo entre lotes.
    // O orçamento é GLOBAL (soma de todas as campanhas) e é decrementado a cada
    // envio bem-sucedido dentro deste tick. Contamos os envios já feitos hoje a
    // partir da timeline (base durável, sobrevive a reinícios do processo).
    const periodoEsperaMs = calcularPeriodoEsperaMs(periodoEsperaValor, periodoEsperaUnidade)
    const inicioDoDia = new Date(agora)
    inicioDoDia.setHours(0, 0, 0, 0)
    const enviosDeHoje = await prisma.timelineEvent.findMany({
      where: { tipo: "mensagem_enviada", data: { gte: inicioDoDia } },
      select: { data: true },
      orderBy: { data: "desc" },
    })
    let orcamento = calcularOrcamentoRitmo(
      enviosDeHoje,
      agora,
      limiteDiario,
      maxEnviosPorPeriodo,
      periodoEsperaMs,
    )

    const campanhas = await prisma.campaign.findMany({
      where: { status: "ativa" },
      select: {
        id: true,
        recorrenciaDias: true,
        dataFinal: true,
        reiniciadaEm: true,
        instanciaNome: true,
        mensagens: {
          select: { id: true, dia: true, horario: true, texto: true },
          orderBy: { dia: "asc" },
        },
        leadCampaigns: {
          select: {
            id: true,
            leadId: true,
            criadoEm: true,
            cicloReiniciadoEm: true,
            lead: { select: { telefone: true, entradaCampanhaEm: true } },
          },
        },
      },
    })

    let processados = 0
    let enviados = 0
    let reiniciados = 0

    for (const campanha of campanhas) {
      if (campanha.mensagens.length === 0) continue
      // Data limite já vencida: será encerrada pela varredura, não dispara nada.
      if (campanha.dataFinal && campanha.dataFinal.getTime() < agora.getTime()) continue
      if (campanha.leadCampaigns.length === 0) continue

      const leadIds = campanha.leadCampaigns.map((v) => v.leadId)

      // Envios já registrados na timeline (dedupe por ciclo é feito abaixo).
      const eventos = await prisma.timelineEvent.findMany({
        where: { campanhaId: campanha.id, leadId: { in: leadIds }, tipo: "mensagem_enviada" },
        select: { leadId: true, mensagemId: true, data: true },
      })

      // Falhas de envio registradas na timeline — usadas para contar tentativas
      // por mensagem dentro do ciclo e parar de tentar após MAX_TENTATIVAS_ENVIO.
      const falhas = await prisma.timelineEvent.findMany({
        where: { campanhaId: campanha.id, leadId: { in: leadIds }, tipo: "falha" },
        select: { leadId: true, mensagemId: true, data: true, descricao: true },
      })

      for (const vinculo of campanha.leadCampaigns) {
        processados += 1

        const cycleAnchor = calcularAncora(
          [campanha.reiniciadaEm, vinculo.criadoEm, vinculo.cicloReiniciadoEm, vinculo.lead.entradaCampanhaEm],
          vinculo.criadoEm,
        )

        // O ciclo é "reiniciado" quando a âncora vigente é o marco de recorrência
        // deste lead (`cicloReiniciadoEm`), e não a entrada original. Nesse caso
        // a sequência é ancorada no dia 0 para que a primeira mensagem dispare
        // no instante em que a recorrência venceu — sem re-somar o offset inicial.
        const cicloReiniciado =
          vinculo.cicloReiniciadoEm != null &&
          cycleAnchor.getTime() === vinculo.cicloReiniciadoEm.getTime()

        const eventosDoCiclo = eventos.filter(
          (e) =>
            e.leadId === vinculo.leadId &&
            e.mensagemId &&
            e.data.getTime() >= cycleAnchor.getTime(),
        )
        const enviadosIds = new Set<string>(eventosDoCiclo.map((e) => e.mensagemId as string))

        // Conta as falhas REAIS de envio por mensagem dentro do ciclo atual
        // (após a âncora) e identifica as mensagens que já foram abortadas.
        //
        // O evento de abort é gravado como `falha` (mesmo tipo), então precisamos
        // distinguí-lo pela descrição: ele NÃO conta como tentativa (senão o
        // próprio abort infla a contagem) e serve como marcador durável de que a
        // mensagem já foi abortada neste ciclo.
        const falhasPorMensagem = new Map<string, number>()
        const abortadasIds = new Set<string>()
        for (const f of falhas) {
          if (f.leadId !== vinculo.leadId || !f.mensagemId) continue
          if (f.data.getTime() < cycleAnchor.getTime()) continue
          if (f.descricao === ABORT_DESCRICAO) {
            abortadasIds.add(f.mensagemId)
            continue
          }
          falhasPorMensagem.set(f.mensagemId, (falhasPorMensagem.get(f.mensagemId) ?? 0) + 1)
        }

        // Mensagens já abortadas em ticks anteriores: apenas as ignora (entram em
        // `enviadosIds` para não serem reprocessadas). NÃO re-registra a desistência.
        for (const mensagemId of abortadasIds) {
          enviadosIds.add(mensagemId)
        }

        // Mensagens que atingiram o limite AGORA (ainda não abortadas): marca como
        // esgotadas para registrar a desistência uma única vez neste tick.
        const esgotadasNovas: string[] = []
        for (const [mensagemId, total] of falhasPorMensagem) {
          if (total >= MAX_TENTATIVAS_ENVIO && !enviadosIds.has(mensagemId) && !abortadasIds.has(mensagemId)) {
            enviadosIds.add(mensagemId)
            abortadasIds.add(mensagemId)
            esgotadasNovas.push(mensagemId)
          }
        }

        // Houve alguma mensagem abortada neste ciclo (nova ou de tick anterior)?
        // Se sim, o ciclo não deve reiniciar — reiniciar zeraria a âncora e a
        // contagem, ressuscitando as mensagens esgotadas e recomeçando o loop.
        const houveAborto = abortadasIds.size > 0

        // Registra a desistência (log + evento) uma única vez, no tick em que o
        // limite é atingido. Nos ticks seguintes a mensagem já está em
        // `abortadasIds`, então não cai mais aqui.
        for (const mensagemId of esgotadasNovas) {
          const mensagem = campanha.mensagens.find((m) => m.id === mensagemId)
          await recordAppLog({
            nivel: "erro",
            origem: "campaigns",
            mensagem: `Envio abortado após ${MAX_TENTATIVAS_ENVIO} tentativas para lead ${vinculo.leadId} na campanha ${campanha.id}.`,
            detalhes: `mensagemId=${mensagemId} dia=${mensagem?.dia ?? "?"} — a engine parou de tentar e avançou a sequência.`,
          })
          await recordMessageEvent({
            kind: "falha",
            leadId: vinculo.leadId,
            campanhaId: campanha.id,
            mensagemId,
            descricao: ABORT_DESCRICAO,
            detalhes: `A engine atingiu o limite de ${MAX_TENTATIVAS_ENVIO} tentativas e não tentará novamente esta mensagem no ciclo atual.`,
          })
        }
        // Momento real do último envio deste ciclo — base para a recorrência.
        const ultimoEnvioEm = eventosDoCiclo.length
          ? new Date(Math.max(...eventosDoCiclo.map((e) => e.data.getTime())))
          : null

        const decisao: LeadCycleDecision = decidirCiclo(
          {
            cycleAnchor,
            mensagens: campanha.mensagens,
            enviadosIds,
          recorrenciaDias: campanha.recorrenciaDias,
          ultimoEnvioEm,
          cicloReiniciado,
          pausarNoFimDeSemana,
          janela,
        },
        agora,
      )

        if (decisao.tipo === "reiniciar") {
          // Se alguma mensagem foi abortada neste ciclo, NÃO reinicia: reiniciar
          // zeraria a âncora e a contagem de tentativas, ressuscitando as
          // mensagens esgotadas e recomeçando o loop de envios que falham. O
          // ciclo fica parado (a desistência já foi registrada em logs/eventos).
          if (houveAborto) continue
          // Não reinicia um ciclo que já começaria depois da data limite.
          if (campanha.dataFinal && decisao.novoAnchor.getTime() > campanha.dataFinal.getTime()) continue
          // Marca o novo ciclo para este lead; o próximo tick envia o dia 0.
          await prisma.leadCampaign.update({
            where: { id: vinculo.id },
            data: { cicloReiniciadoEm: decisao.novoAnchor, proximaMensagemEm: decisao.novoAnchor },
          })
          reiniciados += 1
          continue
        }

        if (decisao.tipo === "enviar") {
          // Ritmo de envio esgotado neste tick (teto diário atingido ou lote
          // cheio aguardando o intervalo entre lotes). Não dispara agora: a
          // mensagem continua pendente e será tentada no próximo tick, quando o
          // orçamento for recalculado.
          if (orcamento <= 0) continue

          const ok = await enviarMensagem(vinculo, campanha.id, decisao.mensagem, false, campanha.instanciaNome)
          if (ok) {
            enviados += 1
            orcamento -= 1
            await prisma.leadCampaign.update({
              where: { id: vinculo.id },
              data: { proximaMensagemEm: decisao.proximaEm },
            })
          }
          continue
        }

        // aguardar: só mantém o horário previsto atualizado para a UI.
        await prisma.leadCampaign.update({
          where: { id: vinculo.id },
          data: { proximaMensagemEm: decisao.proximaEm },
        })
      }
    }

    return { processados, enviados, reiniciados, encerrados: encerradas.length }
  } finally {
    emAndamento = false
  }
}
