export interface WifiData {
  ssid: string
  auth: 'WPA' | 'WEP' | 'nopass'
  password: string
  hidden: boolean
}

const escapeWifi = (value: string) => value.replace(/([\\;,":])/g, '\\$1')

export function wifiPayload(data: WifiData) {
  const parts = [`T:${data.auth}`, `S:${escapeWifi(data.ssid)}`]
  if (data.auth !== 'nopass') parts.push(`P:${escapeWifi(data.password)}`)
  if (data.hidden) parts.push('H:true')
  return `WIFI:${parts.join(';')};;`
}

export function parseWifi(text: string): WifiData | null {
  if (!/^WIFI:/i.test(text)) return null
  const body = text.slice(5)
  const fields: Record<string, string> = {}
  let key = ''
  let value = ''
  let escaped = false
  let readingKey = true
  const flush = () => {
    if (key) fields[key.toUpperCase()] = value
    key = ''
    value = ''
    readingKey = true
  }
  for (const char of body) {
    if (escaped) { value += char; escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === ';') { flush(); continue }
    if (char === ':' && readingKey) { readingKey = false; continue }
    if (readingKey) key += char
    else value += char
  }
  flush()
  if (!fields.S) return null
  const auth = (fields.T || 'nopass').toUpperCase()
  return {
    ssid: fields.S,
    auth: auth === 'WEP' ? 'WEP' : auth === 'NOPASS' ? 'nopass' : 'WPA',
    password: fields.P || '',
    hidden: fields.H === 'true',
  }
}

export function ean13CheckDigit(firstTwelve: string) {
  if (!/^\d{12}$/.test(firstTwelve)) throw new Error('EAN-13 需要 12 位数字（或输入 13 位并校验最后一位）')
  let sum = 0
  for (let index = 0; index < 12; index += 1) sum += Number(firstTwelve[index]) * (index % 2 === 0 ? 1 : 3)
  return String((10 - (sum % 10)) % 10)
}

export function normalizeEan13(input: string): { value: string; checkDigit: string; computed: boolean } {
  const digits = input.trim().replace(/\s+/g, '')
  if (!/^\d+$/.test(digits)) throw new Error('EAN-13 只能包含数字')
  if (digits.length !== 12 && digits.length !== 13) throw new Error('EAN-13 需要 12 位数字，或 13 位含校验位')
  const firstTwelve = digits.slice(0, 12)
  const checkDigit = ean13CheckDigit(firstTwelve)
  if (digits.length === 13 && digits[12] !== checkDigit) {
    throw new Error(`校验位不正确：按前 12 位计算应为 ${checkDigit}，当前是 ${digits[12]}`)
  }
  return { value: firstTwelve + checkDigit, checkDigit, computed: digits.length === 12 }
}

export function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch { return false }
}
