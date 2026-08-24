import { prisma } from "@/lib/prisma"
import {
  decidirCiclo,
  type EngineMessage,
  type LeadCycleDecision,
} from "@/lib/campaign-engine-schedule"
import { recordAppLog } from "@/services/app-logs"
import { encerrarCampanhasExpiradas } from "@/services/campaigns"
import { sendCampaignMessageToLead } from "@/services/evolution"
import { getSettings } from "@/services/settings"

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

async function enviarMensagem(
  vinculo: { leadId: string; lead: { telefone: string } },
  campanhaId: string,
  mensagem: EngineMessage,
  reiniciouCiclo: boolean,
): Promise<boolean> {
  try {
    const envio = await sendCampaignMessageToLead({
      leadId: vinculo.leadId,
      campanhaId,
      mensagemId: mensagem.id,
      texto: mensagem.texto,
      telefone: vinculo.lead.telefone,
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
    const { pausarNoFimDeSemana, respeitarJanela, janelaInicio, janelaFim } = await getSettings()
    const janela = { ativa: respeitarJanela, inicio: janelaInicio, fim: janelaFim }

    const campanhas = await prisma.campaign.findMany({
      where: { status: "ativa" },
      select: {
        id: true,
        recorrenciaDias: true,
        dataFinal: true,
        reiniciadaEm: true,
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
        const enviadosIds = new Set(eventosDoCiclo.map((e) => e.mensagemId as string))
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
          const ok = await enviarMensagem(vinculo, campanha.id, decisao.mensagem, false)
          if (ok) {
            enviados += 1
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
