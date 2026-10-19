import { prisma } from "@/lib/prisma"
import {
  normalizarNomePasta,
  ordenarPastas,
  PASTAS_MAX,
  type CampanhaPasta,
  type CampanhaPastaComContagem,
} from "@/lib/campanha-pastas"

export type ResultadoPasta = { ok: true; pasta: CampanhaPasta } | { ok: false; message: string }

export async function listPastas(): Promise<CampanhaPastaComContagem[]> {
  const pastas = await prisma.campaignPasta.findMany({
    select: { id: true, nome: true, _count: { select: { campanhas: true } } },
  })
  return ordenarPastas(pastas.map((p) => ({ id: p.id, nome: p.nome, total: p._count.campanhas })))
}

export async function getPasta(id: string): Promise<CampanhaPasta | null> {
  const pasta = await prisma.campaignPasta.findUnique({ where: { id }, select: { id: true, nome: true } })
  return pasta
}

async function nomeEmUso(nome: string, ignorarId?: string): Promise<boolean> {
  const existentes = await prisma.campaignPasta.findMany({ select: { id: true, nome: true } })
  const alvo = nome.toLocaleLowerCase("pt-BR")
  return existentes.some((p) => p.id !== ignorarId && p.nome.toLocaleLowerCase("pt-BR") === alvo)
}

export async function createPasta(nomeBruto: string): Promise<ResultadoPasta> {
  const nome = normalizarNomePasta(nomeBruto)
  if (!nome) return { ok: false, message: "Dê um nome para a pasta." }
  if ((await prisma.campaignPasta.count()) >= PASTAS_MAX) {
    return { ok: false, message: `Limite de ${PASTAS_MAX} pastas atingido.` }
  }
  if (await nomeEmUso(nome)) return { ok: false, message: "Já existe uma pasta com esse nome." }
  const pasta = await prisma.campaignPasta.create({ data: { nome }, select: { id: true, nome: true } })
  return { ok: true, pasta }
}

export async function renamePasta(id: string, nomeBruto: string): Promise<ResultadoPasta> {
  const nome = normalizarNomePasta(nomeBruto)
  if (!nome) return { ok: false, message: "Dê um nome para a pasta." }
  if (!(await getPasta(id))) return { ok: false, message: "Pasta não encontrada." }
  if (await nomeEmUso(nome, id)) return { ok: false, message: "Já existe uma pasta com esse nome." }
  const pasta = await prisma.campaignPasta.update({ where: { id }, data: { nome }, select: { id: true, nome: true } })
  return { ok: true, pasta }
}

/** Exclui só a pasta: as campanhas dela voltam para a raiz (`onDelete: SetNull`), nenhuma é apagada. */
export async function deletePasta(id: string): Promise<boolean> {
  if (!(await getPasta(id))) return false
  await prisma.campaignPasta.delete({ where: { id } })
  return true
}

/** Move a campanha para uma pasta (ou para a raiz, com `pastaId` nulo). Devolve false se algo não existe. */
export async function moverCampanhaParaPasta(campanhaId: string, pastaId: string | null): Promise<boolean> {
  if (pastaId && !(await getPasta(pastaId))) return false
  const campanha = await prisma.campaign.findUnique({ where: { id: campanhaId }, select: { id: true } })
  if (!campanha) return false
  await prisma.campaign.update({ where: { id: campanhaId }, data: { pastaId } })
  return true
}
