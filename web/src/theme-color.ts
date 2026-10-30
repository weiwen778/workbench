// 主题色计算：把用户选的主色展开成 Element Plus 需要的一套色阶。
export const DEFAULT_THEME_COLOR = '#39776f'

type Rgb = [number, number, number]

function parse(hex: string): Rgb | null {
  const value = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)) as Rgb
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

function mix(color: Rgb, target: Rgb, weight: number): string {
  return toHex(color.map((v, index) => v * (1 - weight) + target[index] * weight) as Rgb)
}

function alpha(rgb: Rgb, value: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${value})`
}

/** 写入 CSS 变量，深色模式下用半透明色阶，避免浅底高亮在暗色里发白。 */
export function applyThemeColor(color: string, theme: 'light' | 'dark' = 'light'): string {
  const rgb = parse(color)
  const value = rgb && color.startsWith('#') ? color.toLowerCase() : DEFAULT_THEME_COLOR
  const base = parse(value) as Rgb
  const root = document.documentElement.style

  root.setProperty('--wb-primary', value)
  root.setProperty('--el-color-primary', value)

  if (theme === 'dark') {
    root.setProperty('--el-color-primary-light-3', alpha(base, 0.55))
    root.setProperty('--el-color-primary-light-5', alpha(base, 0.4))
    root.setProperty('--el-color-primary-light-7', alpha(base, 0.26))
    root.setProperty('--el-color-primary-light-8', alpha(base, 0.18))
    root.setProperty('--el-color-primary-light-9', alpha(base, 0.12))
    root.setProperty('--el-color-primary-dark-2', mix(base, [255, 255, 255], 0.25))
  } else {
    root.setProperty('--el-color-primary-light-3', mix(base, [255, 255, 255], 0.3))
    root.setProperty('--el-color-primary-light-5', mix(base, [255, 255, 255], 0.5))
    root.setProperty('--el-color-primary-light-7', mix(base, [255, 255, 255], 0.7))
    root.setProperty('--el-color-primary-light-8', mix(base, [255, 255, 255], 0.8))
    root.setProperty('--el-color-primary-light-9', mix(base, [255, 255, 255], 0.9))
    root.setProperty('--el-color-primary-dark-2', mix(base, [0, 0, 0], 0.2))
  }

  localStorage.setItem('wb_theme_color', value)
  return value
}
