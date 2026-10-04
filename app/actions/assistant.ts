"use server"

import { recordAppLog } from "@/services/app-logs"
import { consultarAssistente, type AssistenteConsulta } from "@/services/assistant"
import { getAssistentePluginAtivo } from "@/services/settings"
import { assertSecao } from "@/lib/session"

const CONSULTAS_VALIDAS: AssistenteConsulta[] = [
  "kpis",
  "relatorios",
  "dashboard",
  "dashboard",
  "semResposta24h",
  "nuncaResponderam",
  "semCampanhaAtiva",
  "respostasRecentes",
  "semResposta48h",
]

export async function consultarAssistenteAction(tipo: AssistenteConsulta) {
  await assertSecao("assistente")
  if (!CONSULTAS_VALIDAS.includes(tipo)) {
    return { ok: false as const, message: "Consulta inválida." }
  }
  if (!(await getAssistentePluginAtivo())) {
    return { ok: false as const, message: "O plugin Assistente está desativado." }
  }

  try {
    return { ok: true as const, tipo, ...(await consultarAssistente(tipo)) }
  } catch (error) {
    await recordAppLog({ origem: "assistant", mensagem: `Falha na consulta "${tipo}" do Assistente.`, detalhes: error })
    return { ok: false as const, message: "Não foi possível executar a consulta agora." }
  }
}