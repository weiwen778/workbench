export const DEFAULT_THEME_COLOR = '#18181B'

/** 校验并保存强调色；实际主题由 MUI ThemeProvider 应用。 */
export function applyThemeColor(color: string): string {
  const value = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_THEME_COLOR
  localStorage.setItem('wb_theme_color', value)
  return value
}
