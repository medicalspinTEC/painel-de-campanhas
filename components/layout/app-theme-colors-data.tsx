import { AppThemeColors } from "@/components/layout/app-theme-colors"
import { getAppTema } from "@/services/settings"

export async function AppThemeColorsData() {
  const tema = await getAppTema()
  return <AppThemeColors tema={tema} />
}
