import { AppThemeColors } from "@/components/layout/app-theme-colors"
import { getAppThemeColors } from "@/services/settings"

export async function AppThemeColorsData() {
  const cores = await getAppThemeColors()
  return <AppThemeColors cores={cores} />
}