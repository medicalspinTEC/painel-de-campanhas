import { AppThemeColors } from "@/components/layout/app-theme-colors"
import { getCurrentUser } from "@/lib/session"
import { TEMA_PADRAO } from "@/lib/temas"

/** Tema PESSOAL do usuário logado (cada usuário tem o seu). */
export async function AppThemeColorsData() {
  const usuario = await getCurrentUser()
  return <AppThemeColors tema={usuario?.temaApp ?? TEMA_PADRAO} />
}
