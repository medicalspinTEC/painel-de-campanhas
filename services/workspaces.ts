import { prisma, prismaGlobal } from "@/lib/prisma"
import { runInWorkspace } from "@/lib/workspace-context"

/**
 * Exclui uma instância inteira: todos os dados e todos os usuários dela.
 * Irreversível. A instância principal (a do Root) nunca pode ser excluída.
 *
 * `workspaceId` nas tabelas é coluna simples (sem FK), então a limpeza é feita
 * aqui, tabela a tabela, dentro do contexto da própria instância — o filtro
 * automático de `prisma` garante que só as linhas dela sejam apagadas. As
 * tabelas filhas saem junto, por cascata (leads, campanhas, fluxos, usuários).
 */
export async function excluirWorkspace(workspaceId: string, preservarUserId?: string): Promise<void> {
  const ws = await prismaGlobal.workspace.findUnique({ where: { id: workspaceId }, select: { principal: true } })
  if (!ws) return
  if (ws.principal) throw new Error("A instância principal não pode ser excluída.")

  await runInWorkspace(workspaceId, async () => {
    await prisma.noCodeFlow.deleteMany({})
    await prisma.lead.deleteMany({})
    await prisma.campaign.deleteMany({})
    await prisma.departamento.deleteMany({})
    await prisma.produto.deleteMany({})
    await prisma.marca.deleteMany({})
    await prisma.persona.deleteMany({})
    await prisma.regiao.deleteMany({})
    await prisma.webhook.deleteMany({})
    await prisma.appLog.deleteMany({})
    await prisma.inboundEvent.deleteMany({})
    await prisma.inboundWebhookToken.deleteMany({})
    await prisma.mcpToken.deleteMany({})
    await prisma.instance.deleteMany({})
    await prisma.backupExecucao.deleteMany({})
    await prisma.backupConfig.deleteMany({})
    await prisma.settings.deleteMany({})
    await prisma.user.deleteMany(preservarUserId ? { where: { id: { not: preservarUserId } } } : {})
  })
  await prismaGlobal.workspace.deleteMany({ where: { id: workspaceId, principal: false } })
}