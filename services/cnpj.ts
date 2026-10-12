import { cnpjApenasDigitos, cnpjDadosDoBanco, cnpjValido, lerRespostaReceitaWS, type CnpjDados } from "@/lib/cnpj"
import { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { exigirPlugin } from "@/services/settings"

/**
 * Consulta de CNPJ na Receita Federal (plugin CRM), pela API pública da ReceitaWS:
 * GET https://receitaws.com.br/v1/cnpj/{cnpj}
 *
 * A consulta é MANUAL (botão nos detalhes do lead). O resultado é guardado no próprio lead
 * (`cnpjDados`) e aparece como uma nota estruturada; consultar de novo substitui a nota.
 * O plano gratuito da ReceitaWS aceita 3 consultas por minuto por IP: o app respeita esse teto.
 */

const URL_BASE = "https://receitaws.com.br/v1/cnpj"
const TIMEOUT_MS = 15_000
const LIMITE_POR_MINUTO = 3

/** Janela de consultas feitas por este processo (compartilhada entre as cópias do módulo). */
const consultas = ((globalThis as unknown as { __receitawsConsultas?: number[] }).__receitawsConsultas ??= [])

/** Segundos até haver vaga na janela de 1 minuto (0 = pode consultar agora). */
function segundosParaVaga(): number {
  const agora = Date.now()
  while (consultas.length && consultas[0] <= agora - 60_000) consultas.shift()
  if (consultas.length < LIMITE_POR_MINUTO) return 0
  return Math.max(1, Math.ceil((consultas[0] + 60_000 - agora) / 1000))
}

export interface NotaCnpj {
  cnpj: string | null
  dados: CnpjDados | null
  consultadoEm: string | null
}

/** Nota do CNPJ guardada no lead (para os detalhes). */
export async function lerNotaCnpj(leadId: string): Promise<NotaCnpj> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { cnpj: true, cnpjDados: true, cnpjConsultadoEm: true },
  })
  return {
    cnpj: lead?.cnpj ?? null,
    dados: cnpjDadosDoBanco(lead?.cnpjDados),
    consultadoEm: lead?.cnpjConsultadoEm?.toISOString() ?? null,
  }
}

export type ResultadoConsultaCnpj =
  | { ok: true; dados: CnpjDados; consultadoEm: string }
  | { ok: false; erro: string }

/** Consulta o CNPJ cadastrado no lead e grava o resultado. Nunca lança por falha da API externa. */
export async function consultarCnpjDoLead(leadId: string): Promise<ResultadoConsultaCnpj> {
  await exigirPlugin("crm")

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, cnpj: true } })
  if (!lead) return { ok: false, erro: "Lead não encontrado." }
  const cnpj = cnpjApenasDigitos(lead.cnpj ?? "")
  if (!cnpj) return { ok: false, erro: "Este lead não tem CNPJ cadastrado. Informe o CNPJ ao editar o lead." }
  if (!cnpjValido(cnpj)) return { ok: false, erro: "O CNPJ cadastrado é inválido. Corrija-o ao editar o lead." }

  const espera = segundosParaVaga()
  if (espera > 0) {
    return { ok: false, erro: `Limite de consultas da ReceitaWS atingido (3 por minuto). Tente de novo em ${espera} s.` }
  }
  consultas.push(Date.now())

  let resposta: Response
  try {
    resposta = await fetch(`${URL_BASE}/${cnpj}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    const expirou = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
    return { ok: false, erro: expirou ? "A ReceitaWS demorou demais para responder. Tente novamente." : "Não foi possível falar com a ReceitaWS. Tente novamente em instantes." }
  }

  if (resposta.status === 429) {
    return { ok: false, erro: "A ReceitaWS limitou as consultas (muitas em pouco tempo). Aguarde 1 minuto e tente de novo." }
  }

  let corpo: unknown = null
  try {
    corpo = await resposta.json()
  } catch {
    return { ok: false, erro: `A ReceitaWS devolveu uma resposta inválida (HTTP ${resposta.status}). Tente novamente.` }
  }

  const lido = lerRespostaReceitaWS(corpo)
  if (!lido.ok) return lido
  if (!resposta.ok) return { ok: false, erro: `A ReceitaWS recusou a consulta (HTTP ${resposta.status}).` }

  const agora = new Date()
  // Só grava se o CNPJ do lead não mudou enquanto a consulta rodava (senão a nota seria de outra empresa).
  const gravado = await prisma.lead.updateMany({
    where: { id: leadId, cnpj },
    data: { cnpjDados: JSON.parse(JSON.stringify(lido.dados)) as Prisma.InputJsonValue, cnpjConsultadoEm: agora },
  })
  if (gravado.count !== 1) return { ok: false, erro: "O CNPJ do lead mudou durante a consulta. Consulte novamente." }

  return { ok: true, dados: lido.dados, consultadoEm: agora.toISOString() }
}
