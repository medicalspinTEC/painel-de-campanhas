/**
 * Integridade ANTES/DEPOIS dos testes do MCP.
 *
 * Uso (na raiz do projeto, com DATABASE_URL apontando para o ambiente de TESTE):
 *   WORKSPACE_ID=<id da instância> npx tsx scripts/mcp-integridade.ts antes  > antes.json
 *   ... roda os testes do MCP (consultas, filtros inválidos, erro técnico simulado) ...
 *   WORKSPACE_ID=<id da instância> npx tsx scripts/mcp-integridade.ts depois antes.json
 *
 * Compara, por conjunto, o TOTAL e o hash da lista ordenada de IDs: leads, envios (mensagem_enviada + falha),
 * respostas, vínculos (LeadCampaign + Lead.campanhaId) e eventos (toda a timeline). Também lista IDs que
 * sumiram ou apareceram. Sai com código 0 se tudo igual e 1 se houver qualquer diferença.
 * Somente LEITURA: o script nunca grava nada.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { prisma } from "@/lib/prisma"
import { runInWorkspace } from "@/lib/workspace-context"

type Conjunto = { total: number; hash: string; ids: string[] }
type Snapshot = Record<"leads" | "envios" | "respostas" | "vinculos" | "eventos", Conjunto>

function conjunto(ids: string[]): Conjunto {
  const ordenados = [...ids].sort()
  return { total: ordenados.length, hash: createHash("sha256").update(ordenados.join("\n")).digest("hex"), ids: ordenados }
}

async function tirarSnapshot(): Promise<Snapshot> {
  const ids = (linhas: { id: string }[]) => linhas.map((l) => l.id)
  const [leads, envios, respostas, vinculos, leadsComCampanha, eventos] = await Promise.all([
    prisma.lead.findMany({ select: { id: true } }),
    prisma.timelineEvent.findMany({ where: { tipo: { in: ["mensagem_enviada", "falha"] } }, select: { id: true } }),
    prisma.timelineEvent.findMany({ where: { tipo: "resposta" }, select: { id: true } }),
    prisma.leadCampaign.findMany({ select: { id: true, leadId: true, campanhaId: true } }),
    prisma.lead.findMany({ where: { campanhaId: { not: null } }, select: { id: true, campanhaId: true } }),
    prisma.timelineEvent.findMany({ select: { id: true } }),
  ])
  return {
    leads: conjunto(ids(leads)),
    envios: conjunto(ids(envios)),
    respostas: conjunto(ids(respostas)),
    vinculos: conjunto([
      ...vinculos.map((v) => `LC:${v.id}:${v.leadId}:${v.campanhaId}`),
      ...leadsComCampanha.map((l) => `L:${l.id}:${l.campanhaId}`),
    ]),
    eventos: conjunto(ids(eventos)),
  }
}

async function main() {
  const [modo, arquivoAntes] = process.argv.slice(2)
  const workspaceId = process.env.WORKSPACE_ID
  if (!workspaceId || (modo !== "antes" && modo !== "depois") || (modo === "depois" && !arquivoAntes)) {
    console.error("Uso: WORKSPACE_ID=<id> tsx scripts/mcp-integridade.ts antes > antes.json | depois antes.json")
    process.exit(2)
  }

  const atual = await runInWorkspace(workspaceId, tirarSnapshot)
  if (modo === "antes") {
    console.log(JSON.stringify({ tiradoEm: new Date().toISOString(), snapshot: atual }, null, 2))
    return
  }

  const antes = (JSON.parse(readFileSync(arquivoAntes, "utf8")) as { snapshot: Snapshot }).snapshot
  let ok = true
  for (const nome of Object.keys(antes) as (keyof Snapshot)[]) {
    const a = antes[nome]
    const d = atual[nome]
    const igual = a.total === d.total && a.hash === d.hash
    ok &&= igual
    const sumiram = a.ids.filter((id) => !d.ids.includes(id))
    const novos = d.ids.filter((id) => !a.ids.includes(id))
    console.log(`${igual ? "OK   " : "DIFF "} ${nome}: antes=${a.total} depois=${d.total}${igual ? "" : ` | removidos=${sumiram.length} novos=${novos.length}`}`)
    if (!igual) {
      if (sumiram.length) console.log(`  removidos: ${sumiram.slice(0, 20).join(", ")}${sumiram.length > 20 ? " …" : ""}`)
      if (novos.length) console.log(`  novos: ${novos.slice(0, 20).join(", ")}${novos.length > 20 ? " …" : ""}`)
    }
  }
  console.log(ok ? "\nINTEGRIDADE APROVADA: nenhum registro foi criado, alterado ou removido." : "\nINTEGRIDADE REPROVADA: houve diferença entre antes e depois.")
  process.exit(ok ? 0 : 1)
}

main()
  .catch((error) => {
    console.error("[integridade] Falha:", error instanceof Error ? error.message : error)
    process.exit(2)
  })
  .finally(() => prisma.$disconnect())
