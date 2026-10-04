/**
 * Leitor em fluxo do arquivo de backup.
 *
 * Lê o JSON aos pedaços e entrega (1) o cabeçalho e (2) cada linha de cada
 * tabela como texto, sem nunca montar o arquivo inteiro na memória. Conhece só
 * a forma do formato `painel-backup`:
 *
 *   { "formato": ..., "versao": ..., "id": ..., "geradoEm": ..., "secoes": [...],
 *     "tabelas": { "Lead": [ {...}, {...} ], "Campaign": [ ... ] } }
 *
 * Funciona com o arquivo compacto (como o app gera) e com ele reformatado
 * (quebras de linha, indentação), e com qualquer tamanho de pedaço.
 */

export class ArquivoInvalidoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArquivoInvalidoError"
  }
}

export interface OuvinteLeitor {
  /** Chamado uma vez, quando o objeto "tabelas" começa (todo o cabeçalho já foi lido). Pode lançar para abortar. */
  aoCabecalho: (cabecalho: Record<string, unknown>) => void | Promise<void>
  /** Uma linha da tabela, como texto JSON (um objeto). Se devolver uma Promise, a leitura espera por ela. */
  aoLinha: (tabela: string, linhaJson: string) => void | Promise<void>
}

type Pedaco = Uint8Array | string

const ASPAS = 34
const BARRA = 92
const ABRE_CHAVE = 123
const FECHA_CHAVE = 125
const ABRE_COLCHETE = 91
const FECHA_COLCHETE = 93
const VIRGULA = 44
const DOIS_PONTOS = 58

export async function lerBackupEmStream(fonte: AsyncIterable<Pedaco>, ouvinte: OuvinteLeitor): Promise<void> {
  const decodificador = new TextDecoder("utf-8")
  const cabecalho: Record<string, unknown> = {}

  let cabecalhoEntregue = false
  let encerrou = false
  let primeiro = true

  // Posição dentro do JSON (fora de strings).
  let profundidade = 0
  let emString = false
  let escape = false

  // Chaves: nível 1 = campos do arquivo; nível 2 (dentro de "tabelas") = nomes das tabelas.
  let esperandoChave = false
  let lendoChave = false
  let bufferChave = ""
  let chaveRaiz: string | null = null
  let tabela: string | null = null

  // Captura de trechos que atravessam pedaços: o valor de um campo do cabeçalho ou uma linha de tabela.
  let capturando: "valor" | "linha" | null = null
  let partes: string[] = []
  let inicio = 0

  const aoLerChave = (nome: string) => {
    if (profundidade === 1) chaveRaiz = nome
    else if (profundidade === 2) tabela = nome
  }

  const finalizarValor = (texto: string, fim: number) => {
    const bruto = partes.join("") + texto.slice(inicio, fim)
    partes = []
    capturando = null
    try {
      cabecalho[chaveRaiz as string] = JSON.parse(bruto)
    } catch {
      throw new ArquivoInvalidoError(`O campo "${chaveRaiz}" do início do arquivo está malformado.`)
    }
  }

  const processar = async (entrada: string): Promise<void> => {
    let texto = entrada
    if (primeiro) {
      texto = texto.replace(/^\uFEFF/, "")
      const primeiroCaractere = /\S/.exec(texto)
      if (!primeiroCaractere) return
      primeiro = false
      if (primeiroCaractere[0] !== "{") {
        throw new ArquivoInvalidoError('Este arquivo não é um backup do painel (o JSON deveria começar com "{").')
      }
    }

    if (capturando) inicio = 0
    const total = texto.length

    for (let i = 0; i < total; i++) {
      const c = texto.charCodeAt(i)

      if (emString) {
        if (escape) {
          escape = false
          if (lendoChave) bufferChave += texto[i]
        } else if (c === BARRA) {
          escape = true
          if (lendoChave) bufferChave += "\\"
        } else if (c === ASPAS) {
          emString = false
          if (lendoChave) {
            lendoChave = false
            let nome: string
            try {
              nome = JSON.parse(`"${bufferChave}"`) as string
            } catch {
              throw new ArquivoInvalidoError("O arquivo tem um nome de campo malformado.")
            }
            bufferChave = ""
            aoLerChave(nome)
          }
        } else if (lendoChave) {
          bufferChave += texto[i]
        }
        continue
      }

      switch (c) {
        case ASPAS:
          emString = true
          if (esperandoChave && (profundidade === 1 || (profundidade === 2 && chaveRaiz === "tabelas"))) {
            lendoChave = true
            bufferChave = ""
            esperandoChave = false
          }
          break

        case ABRE_CHAVE:
          profundidade++
          if (profundidade === 1) {
            esperandoChave = true
          } else if (profundidade === 2 && chaveRaiz === "tabelas") {
            esperandoChave = true
            if (!cabecalhoEntregue) {
              cabecalhoEntregue = true
              await ouvinte.aoCabecalho(cabecalho)
            }
          } else if (profundidade === 4 && chaveRaiz === "tabelas" && tabela !== null) {
            capturando = "linha"
            partes = []
            inicio = i
          }
          break

        case FECHA_CHAVE:
          if (capturando === "linha" && profundidade === 4) {
            const linha = partes.join("") + texto.slice(inicio, i + 1)
            partes = []
            capturando = null
            profundidade--
            const retorno = ouvinte.aoLinha(tabela as string, linha)
            if (retorno) await retorno
            break
          }
          if (capturando === "valor" && profundidade === 1) finalizarValor(texto, i)
          profundidade--
          if (profundidade === 0) encerrou = true
          else if (profundidade === 1 && chaveRaiz === "tabelas") tabela = null
          break

        case ABRE_COLCHETE:
          profundidade++
          break

        case FECHA_COLCHETE:
          profundidade--
          break

        case VIRGULA:
          if (profundidade === 1) {
            if (capturando === "valor") finalizarValor(texto, i)
            esperandoChave = true
          } else if (profundidade === 2 && chaveRaiz === "tabelas") {
            esperandoChave = true
          }
          break

        case DOIS_PONTOS:
          if (profundidade === 1 && chaveRaiz !== null && chaveRaiz !== "tabelas" && capturando === null) {
            capturando = "valor"
            partes = []
            inicio = i + 1
          }
          break

        default:
          break
      }
    }

    // O trecho em captura continua no próximo pedaço.
    if (capturando) {
      partes.push(texto.slice(inicio))
      inicio = 0
    }
  }

  for await (const pedaco of fonte) {
    const texto = typeof pedaco === "string" ? pedaco : decodificador.decode(pedaco, { stream: true })
    if (texto) await processar(texto)
  }
  const resto = decodificador.decode()
  if (resto) await processar(resto)

  if (primeiro) throw new ArquivoInvalidoError("O arquivo está vazio.")
  if (!encerrou) {
    throw new ArquivoInvalidoError("O arquivo está incompleto (termina antes do fim). Gere o backup de novo.")
  }
  if (!cabecalhoEntregue) {
    throw new ArquivoInvalidoError("Não encontrei as tabelas do backup neste arquivo.")
  }
}
