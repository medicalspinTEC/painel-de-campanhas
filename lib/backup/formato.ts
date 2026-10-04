/**
 * Formato do arquivo de backup (.json) e tipos da restauração.
 *
 * Sem imports de servidor: a tela usa para ler o cabeçalho do arquivo escolhido
 * e o serviço (`services/restore.ts`) para validar o que chega.
 *
 * O arquivo é o gerado por "Baixar backup" (`criarDownloadBackup` em
 * `services/backup.ts`):
 *   { formato, versao, id, geradoEm, secoes, tabelas: { Lead: [...], ... } }
 */

export const FORMATO_BACKUP = "painel-backup"
/** Maior versão do formato que esta versão do app sabe ler. */
export const VERSAO_BACKUP = 1
/** Tamanho máximo aceito para o arquivo (a leitura é em fluxo, mas é um teto de segurança). */
export const LIMITE_ARQUIVO_BYTES = 1024 * 1024 * 1024
/** Quanto do início do arquivo a tela lê para mostrar o cabeçalho. */
export const BYTES_CABECALHO = 64 * 1024

export interface CabecalhoBackup {
  formato: string
  versao: number
  id: string
  geradoEm: string
  secoes: string[]
}

export type ResultadoCabecalho = { ok: true; cabecalho: CabecalhoBackup } | { ok: false; erro: string }

/** Confere o cabeçalho (já convertido de JSON) e devolve um objeto tipado. */
export function validarCabecalho(bruto: unknown): ResultadoCabecalho {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, erro: "Este arquivo não parece ser um backup do painel." }
  }
  const c = bruto as Record<string, unknown>
  if (c.formato !== FORMATO_BACKUP) {
    return { ok: false, erro: "Este arquivo não é um backup do painel (formato desconhecido)." }
  }
  if (typeof c.versao !== "number" || !Number.isInteger(c.versao) || c.versao < 1) {
    return { ok: false, erro: "A versão do backup não foi informada no arquivo." }
  }
  if (c.versao > VERSAO_BACKUP) {
    return {
      ok: false,
      erro: `Este backup foi gerado por uma versão mais nova do painel (formato v${c.versao}). Atualize o app antes de restaurar.`,
    }
  }
  const secoes = Array.isArray(c.secoes) ? c.secoes.filter((s): s is string => typeof s === "string") : []
  return {
    ok: true,
    cabecalho: {
      formato: c.formato,
      versao: c.versao,
      id: typeof c.id === "string" ? c.id : "",
      geradoEm: typeof c.geradoEm === "string" ? c.geradoEm : "",
      secoes,
    },
  }
}

/**
 * Lê o cabeçalho a partir do começo do arquivo (tudo antes da chave "tabelas").
 * Usada pela tela, que só lê os primeiros KB do arquivo escolhido.
 */
export function lerCabecalhoBackup(inicioDoArquivo: string): ResultadoCabecalho {
  const texto = inicioDoArquivo.replace(/^\uFEFF/, "")
  const indice = texto.indexOf('"tabelas"')
  if (indice < 0) {
    return { ok: false, erro: "Este arquivo não parece ser um backup do painel (não encontrei as tabelas)." }
  }
  let bruto: unknown
  try {
    bruto = JSON.parse(`${texto.slice(0, indice).replace(/,\s*$/, "")}}`)
  } catch {
    return { ok: false, erro: 'Não consegui ler o início do arquivo. Use um .json gerado por "Baixar backup".' }
  }
  return validarCabecalho(bruto)
}

// ---------------------------------------------------------------------------
// Restauração
// ---------------------------------------------------------------------------

/**
 * - `mesclar`: só adiciona o que falta. O que já existe no banco NÃO é alterado.
 * - `sobrescrever`: adiciona o que falta e substitui os dados dos registros que
 *   já existem (mesmo id) pelos do backup. O que só existe no banco é mantido.
 */
export type ModoRestauracao = "mesclar" | "sobrescrever"

export const MODOS_RESTAURACAO: readonly ModoRestauracao[] = ["mesclar", "sobrescrever"]

export function isModoRestauracao(valor: unknown): valor is ModoRestauracao {
  return valor === "mesclar" || valor === "sobrescrever"
}

export interface ResumoTabelaRestauracao {
  tabela: string
  secao: string
  /** Linhas deste arquivo. */
  noArquivo: number
  /** Registros que não existiam e foram (ou seriam) criados. */
  novos: number
  /** Registros que já existiam no banco (mesmo id). */
  existentes: number
  /** Só em "sobrescrever": existentes que foram (ou seriam) atualizados. */
  atualizados: number
  /** Ignorados: dependem de um registro que não existe no banco nem no arquivo. */
  semReferencia: number
  /** Ignorados: conflitam com outro registro (campo único) ou são protegidos. */
  conflitos: number
  /** Ignorados: linha malformada (tipo errado, campo obrigatório ausente). */
  invalidos: number
  /** Vínculos opcionais apontando para algo que não existe: gravados sem o vínculo. */
  vinculosRemovidos: number
  /** Usuários do backup que já existem (mesmo login, outro id): reaproveitados. */
  mapeados: number
  /** Falhas ao gravar. */
  erros: number
  /** Exemplos das ocorrências acima (no máximo alguns). */
  amostras: string[]
}

export interface ResultadoRestauracao {
  simulacao: boolean
  modo: ModoRestauracao
  backup: CabecalhoBackup
  tabelas: ResumoTabelaRestauracao[]
  avisos: string[]
  duracaoMs: number
}

/** Linhas enviadas pela rota de restauração (NDJSON, uma por linha). */
export type EventoRestauracao =
  | { tipo: "fase"; mensagem: string }
  | {
      tipo: "progresso"
      tabela: string
      feitas: number
      total: number
      tabelasConcluidas: number
      totalTabelas: number
    }
  | { tipo: "fim"; resultado: ResultadoRestauracao }
  | { tipo: "erro"; mensagem: string }

/** Soma dos registros ignorados por qualquer motivo. */
export function totalIgnorados(r: ResumoTabelaRestauracao): number {
  return r.semReferencia + r.conflitos + r.invalidos + r.erros
}
