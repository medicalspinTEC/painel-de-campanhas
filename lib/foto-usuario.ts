/**
 * Foto de perfil dos usuários — helpers seguros para o navegador (sem `server-only`).
 *
 * A imagem é servida por `/api/usuarios/:id/foto`. O `v` (momento da última troca) faz o
 * navegador guardar a foto em cache por muito tempo e buscar de novo só quando ela muda.
 */

/** Lado (px) da foto depois de reduzida no navegador. */
export const FOTO_LADO = 256

/** URL da foto, ou `null` quando o usuário não tem foto (mostre as iniciais). */
export function urlFotoUsuario(id: string, fotoEm: number | null | undefined): string | null {
  return fotoEm ? `/api/usuarios/${id}/foto?v=${fotoEm}` : null
}

export function iniciaisDoNome(nome: string, padrao = "?"): string {
  return (
    nome
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? "")
      .join("") || padrao
  )
}
