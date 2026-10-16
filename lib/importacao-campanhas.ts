/**
 * Coluna "campanha" da importação de leads: aceita UMA ou VÁRIAS campanhas por linha.
 *
 * Formatos aceitos (cada item é o ID de importação da campanha ou o nome exato dela):
 *   20            → uma campanha
 *   {20}          → uma campanha (chaves opcionais)
 *   {20};{21}     → várias campanhas, separadas por ponto e vírgula
 *   20;21         → idem, sem chaves
 *
 * Itens repetidos (inclusive IDs diferentes que apontam para a mesma campanha) contam uma vez só.
 * Se QUALQUER item não for encontrado, a linha inteira é rejeitada (nada de importar só metade em silêncio).
 */

export interface CampanhasDaLinha {
  /** IDs internos das campanhas, na ordem em que apareceram na célula, sem repetição. */
  ids: string[]
  /** Texto original (sem chaves) de cada campanha em `ids`, para mensagens de erro. */
  rotulos: string[]
  /** Itens que não casaram com nenhuma campanha. */
  naoEncontradas: string[]
}

/** Remove espaços e as chaves opcionais de um item: "{ 20 }" → "20". */
function limparItem(item: string): string {
  const texto = item.trim()
  const dentro = texto.match(/^\{\s*([^{}]*?)\s*\}$/)
  return (dentro ? dentro[1] : texto).trim()
}

/**
 * @param bruta texto da célula "campanha"
 * @param mapa  chave minúscula (ID de importação ou nome da campanha) → id da campanha
 */
export function resolverCampanhasDaLinha(bruta: string, mapa: ReadonlyMap<string, string>): CampanhasDaLinha {
  const texto = bruta.trim()
  const vazio: CampanhasDaLinha = { ids: [], rotulos: [], naoEncontradas: [] }
  if (!texto) return vazio

  // Compatibilidade: um nome de campanha que por acaso contenha ";" continua valendo como nome inteiro.
  const inteiro = mapa.get(limparItem(texto).toLowerCase())
  if (inteiro) return { ids: [inteiro], rotulos: [limparItem(texto)], naoEncontradas: [] }

  const itens = texto.split(";").map(limparItem).filter((item) => item.length > 0)
  const resultado: CampanhasDaLinha = { ids: [], rotulos: [], naoEncontradas: [] }
  for (const item of itens) {
    const id = mapa.get(item.toLowerCase())
    if (!id) {
      if (!resultado.naoEncontradas.includes(item)) resultado.naoEncontradas.push(item)
      continue
    }
    if (resultado.ids.includes(id)) continue
    resultado.ids.push(id)
    resultado.rotulos.push(item)
  }
  return resultado
}
