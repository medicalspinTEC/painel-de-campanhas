"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { iniciaisDoNome, urlFotoUsuario } from "@/lib/foto-usuario"

/**
 * Avatar de um usuário do painel: a foto de perfil, ou as iniciais quando ele não tem foto
 * (ou a imagem não carrega).
 */
export function UserAvatar({
  userId,
  nome,
  fotoEm,
  className,
  fallbackClassName,
  size,
}: {
  userId: string
  nome: string
  /** `fotoEm` do usuário (momento da última troca). Ausente/nulo = sem foto. */
  fotoEm?: number | null
  className?: string
  fallbackClassName?: string
  size?: "default" | "sm" | "lg"
}) {
  const src = urlFotoUsuario(userId, fotoEm)
  return (
    <Avatar className={className} size={size}>
      {src ? <AvatarImage key={src} src={src} alt="" className="rounded-[inherit]" /> : null}
      <AvatarFallback className={fallbackClassName}>{iniciaisDoNome(nome)}</AvatarFallback>
    </Avatar>
  )
}
