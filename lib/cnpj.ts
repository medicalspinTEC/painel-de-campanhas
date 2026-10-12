/**
 * CNPJ: máscara, validação e leitura da resposta da ReceitaWS.
 * Arquivo puro (sem servidor/cliente): usado pelo formulário, pelas actions, pelo serviço de consulta
 * (`services/cnpj.ts`) e pela nota exibida nos detalhes do lead.
 */

export function cnpjApenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "")
}

/** Máscara progressiva: 55534724000107 → 55.534.724/0001-07. */
export function cnpjMascara(valor: string): string {
  const d = cnpjApenasDigitos(valor).slice(0, 14)
  let saida = d.slice(0, 2)
  if (d.length > 2) saida += `.${d.slice(2, 5)}`
  if (d.length > 5) saida += `.${d.slice(5, 8)}`
  if (d.length > 8) saida += `/${d.slice(8, 12)}`
  if (d.length > 12) saida += `-${d.slice(12, 14)}`
  return saida
}

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = base.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

/** 14 dígitos, não repetidos e com os dois dígitos verificadores corretos. */
export function cnpjValido(valor: string): boolean {
  const d = cnpjApenasDigitos(valor)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const d1 = digitoVerificador(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digitoVerificador(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === Number(d[12]) && d2 === Number(d[13])
}

// ---------------------------------------------------------------------------
// Dados da consulta (formato próprio, guardado em Lead.cnpjDados)
// ---------------------------------------------------------------------------

export interface CnpjAtividade {
  codigo: string
  texto: string
}

export interface CnpjDados {
  cnpj: string
  nome: string
  fantasia: string
  situacao: string
  dataSituacao: string
  motivoSituacao: string
  situacaoEspecial: string
  tipo: string
  porte: string
  naturezaJuridica: string
  abertura: string
  /** Valor em reais (a ReceitaWS devolve texto, ex.: "120000.00"). */
  capitalSocial: number | null
  atividadePrincipal: CnpjAtividade[]
  atividadesSecundarias: CnpjAtividade[]
  socios: { nome: string; qualificacao: string }[]
  endereco: {
    logradouro: string
    numero: string
    complemento: string
    bairro: string
    municipio: string
    uf: string
    cep: string
  }
  email: string
  telefone: string
  simples: { optante: boolean | null; dataOpcao: string; dataExclusao: string }
  simei: { optante: boolean | null; dataOpcao: string; dataExclusao: string }
  /** Atualização da base na Receita (ISO), quando informada. */
  ultimaAtualizacao: string
}

type Obj = Record<string, unknown>
const ehObjeto = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "")

function atividades(v: unknown): CnpjAtividade[] {
  if (!Array.isArray(v)) return []
  return v
    .filter(ehObjeto)
    .map((a) => ({ codigo: texto(a.code), texto: texto(a.text) }))
    // A ReceitaWS devolve "00.00-0-00 / Não informada" quando não há atividade.
    .filter((a) => a.texto && a.codigo !== "00.00-0-00")
}

function regime(v: unknown): CnpjDados["simples"] {
  const o = ehObjeto(v) ? v : {}
  return {
    optante: typeof o.optante === "boolean" ? o.optante : null,
    dataOpcao: texto(o.data_opcao),
    dataExclusao: texto(o.data_exclusao),
  }
}

/** Converte a resposta bruta da ReceitaWS no formato do app. Devolve o motivo quando a Receita recusou a consulta. */
export function lerRespostaReceitaWS(bruto: unknown): { ok: true; dados: CnpjDados } | { ok: false; erro: string } {
  if (!ehObjeto(bruto)) return { ok: false, erro: "Resposta inesperada da Receita (ReceitaWS)." }
  if (texto(bruto.status).toUpperCase() === "ERROR") {
    return { ok: false, erro: texto(bruto.message) || "A consulta foi recusada pela ReceitaWS." }
  }
  const capital = Number(texto(bruto.capital_social))
  return {
    ok: true,
    dados: {
      cnpj: texto(bruto.cnpj),
      nome: texto(bruto.nome),
      fantasia: texto(bruto.fantasia),
      situacao: texto(bruto.situacao),
      dataSituacao: texto(bruto.data_situacao),
      motivoSituacao: texto(bruto.motivo_situacao),
      situacaoEspecial: texto(bruto.situacao_especial),
      tipo: texto(bruto.tipo),
      porte: texto(bruto.porte),
      naturezaJuridica: texto(bruto.natureza_juridica),
      abertura: texto(bruto.abertura),
      capitalSocial: texto(bruto.capital_social) && Number.isFinite(capital) ? capital : null,
      atividadePrincipal: atividades(bruto.atividade_principal),
      atividadesSecundarias: atividades(bruto.atividades_secundarias),
      socios: (Array.isArray(bruto.qsa) ? bruto.qsa : [])
        .filter(ehObjeto)
        .map((s) => ({ nome: texto(s.nome), qualificacao: texto(s.qual) }))
        .filter((s) => s.nome),
      endereco: {
        logradouro: texto(bruto.logradouro),
        numero: texto(bruto.numero),
        complemento: texto(bruto.complemento),
        bairro: texto(bruto.bairro),
        municipio: texto(bruto.municipio),
        uf: texto(bruto.uf),
        cep: texto(bruto.cep),
      },
      email: texto(bruto.email),
      telefone: texto(bruto.telefone),
      simples: regime(bruto.simples),
      simei: regime(bruto.simei),
      ultimaAtualizacao: texto(bruto.ultima_atualizacao),
    },
  }
}

/** Endereço em uma linha: "AVENIDA X, 650 - SALA 5 - BAIRRO, CIDADE/UF, CEP". */
export function enderecoEmUmaLinha(e: CnpjDados["endereco"]): string {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ")
  const cidade = [e.municipio, e.uf].filter(Boolean).join("/")
  return [rua, e.complemento, e.bairro, cidade, e.cep ? `CEP ${e.cep}` : ""].filter(Boolean).join(" - ")
}

/** Leitura defensiva do JSON gravado no banco (pode vir de versões anteriores ou incompleto). */
export function cnpjDadosDoBanco(valor: unknown): CnpjDados | null {
  if (!ehObjeto(valor) || typeof valor.nome !== "string") return null
  return valor as unknown as CnpjDados
}
