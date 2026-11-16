import { DEFAULT_LIMITS, DEFAULT_SETTINGS, type ConvertLimits, type ConvertPreset, type ConvertSettings } from './types'

const PRESET_KEY = 'wb_convert_presets'
const LIMIT_KEY = 'wb_convert_limits'

export function loadPresets(): ConvertPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((item) => item && typeof item.name === 'string' && typeof item.target === 'string')
  } catch { return [] }
}

export function savePresets(presets: ConvertPreset[]) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets))
}

export function loadLimits(): ConvertLimits {
  try {
    const raw = JSON.parse(localStorage.getItem(LIMIT_KEY) || '{}')
    return {
      imageMB: positive(raw.imageMB, DEFAULT_LIMITS.imageMB),
      pdfMB: positive(raw.pdfMB, DEFAULT_LIMITS.pdfMB),
      tableMB: positive(raw.tableMB, DEFAULT_LIMITS.tableMB),
      maxItems: positive(raw.maxItems, DEFAULT_LIMITS.maxItems),
      concurrency: Math.min(4, positive(raw.concurrency, DEFAULT_LIMITS.concurrency)),
      timeoutMin: positive(raw.timeoutMin, DEFAULT_LIMITS.timeoutMin),
    }
  } catch { return { ...DEFAULT_LIMITS } }
}

export function saveLimits(limits: ConvertLimits) {
  localStorage.setItem(LIMIT_KEY, JSON.stringify(limits))
}

function positive(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

export function mergeSettings(input: Partial<ConvertSettings> | undefined): ConvertSettings {
  return { ...DEFAULT_SETTINGS, ...(input || {}) }
}
