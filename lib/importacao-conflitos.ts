/**
 * Reimportação de um lead que JÁ EXISTE (mesmo telefone) com dados diferentes dos salvos na plataforma.
 *
 * Funções puras (sem banco) usadas pela importação para:
 *  1. descobrir o que mudou entre a planilha e o cadastro (`diferencasLeadImportacao`);
 *  2. montar a nota que guarda os valores anteriores quando o usuário escolhe sobrescrever
 *     (`montarNotaDeSobrescrita`), para nenhum dado se perder.
 *
 * Regras de comparação:
 *  - célula vazia na planilha NÃO é diferença (não apaga dado da plataforma);
 *  - nome e segmentação (produto, marca, persona, região) ignoram maiúsculas/minúsculas e espaços repetidos;
 *  - notas, negócio e atividade comparam o texto exato (sem espaços nas pontas), pois são IDs/textos livres;
 *  - telefone é a identidade do lead e status é controlado pelo fluxo de campanhas/CRM: nenhum dos dois é comparado.
 */

export const CAMPOS_IMPORTAVEIS = ["nome", "produto", "marca", "persona", "regiao", "notas", "negocio", "atividade"] as const
export type CampoImportavel = (typeof CAMPOS_IMPORTAVEIS)[number]

export const ROTULO_CAMPO_IMPORTAVEL: Record<CampoImportavel, string> = {
  nome: "Nome",
  produto: "Produto",
  marca: "Marca",
  persona: "Persona",
  regiao: "Região",
  notas: "Notas",
  negocio: "Negócio",
  atividade: "Atividade",
}

export interface DiferencaImportacao {
  campo: CampoImportavel
  rotulo: string
  /** Valor salvo na plataforma (`null` = vazio). */
  atual: string | null
  /** Valor vindo da planilha. */
  planilha: string
}

export type DadosComparaveis = Partial<Record<CampoImportavel, string | null | undefined>>

const CAMPOS_SEM_CASO = new Set<CampoImportavel>(["nome", "produto", "marca", "persona", "regiao"])

function normalizar(campo: CampoImportavel, valor: string): string {
  const limpo = valor.trim()
  return CAMPOS_SEM_CASO.has(campo) ? limpo.replace(/\s+/g, " ").toLowerCase() : limpo
}

export function diferencasLeadImportacao(atual: DadosComparaveis, planilha: DadosComparaveis): DiferencaImportacao[] {
  const diferencas: DiferencaImportacao[] = []
  for (const campo of CAMPOS_IMPORTAVEIS) {
    const novo = (planilha[campo] ?? "").trim()
    if (!novo) continue
    const salvo = (atual[campo] ?? "").trim()
    if (normalizar(campo, novo) === normalizar(campo, salvo)) continue
    diferencas.push({ campo, rotulo: ROTULO_CAMPO_IMPORTAVEL[campo], atual: salvo || null, planilha: novo })
  }
  return diferencas
}

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/** Nota (texto) que registra o que foi sobrescrito, com os valores anteriores completos. */
export function montarNotaDeSobrescrita(diferencas: readonly DiferencaImportacao[], quando: Date = new Date()): string {
  const linhas = [`── Importação de planilha em ${FORMATO_DATA.format(quando).replace(",", "")} ──`, "Dados da plataforma substituídos pelos da planilha:"]
  for (const d of diferencas) {
    if (d.campo === "notas") {
      linhas.push(`• ${d.rotulo}: texto anterior preservado abaixo; as notas passaram a ser o texto da planilha.`, "  --- notas anteriores ---", ...(d.atual ?? "(vazio)").split("\n").map((l) => `  ${l}`), "  --- fim das notas anteriores ---")
    } else {
      linhas.push(`• ${d.rotulo}: ${d.atual === null ? "(vazio)" : `"${d.atual}"`} → "${d.planilha}"`)
    }
  }
  return linhas.join("\n")
}
