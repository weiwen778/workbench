export const key = 'wb_translation_preferences'

export interface TranslationPreferences {
  provider: string
  autoSize: boolean
  shortSize: number
  mediumSize: number
  longSize: number
}

export function readTranslationPreferences(): TranslationPreferences {
  try {
    return { provider: 'baidu', autoSize: true, shortSize: 28, mediumSize: 21, longSize: 16, ...JSON.parse(localStorage.getItem(key) || '{}') }
  } catch {
    return { provider: 'baidu', autoSize: true, shortSize: 28, mediumSize: 21, longSize: 16 }
  }
}

export function translationFont(text: string, preferences: TranslationPreferences) {
  const size = preferences.autoSize
    ? text.length <= 100 ? preferences.shortSize : text.length <= 500 ? preferences.mediumSize : preferences.longSize
    : preferences.longSize
  return `${size}px`
}
