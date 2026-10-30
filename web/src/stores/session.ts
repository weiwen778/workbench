import { computed, reactive } from 'vue'
import { http } from '@/api/client'
import { applyThemeColor, DEFAULT_THEME_COLOR } from '@/theme-color'

export interface SessionUser {
  id: number
  username: string
  theme: 'light' | 'dark'
  theme_color?: string
  checkin_shop_label?: string
  checkin_social_label?: string
}

export const session = reactive({
  user: null as SessionUser | null,
  loaded: false,
  theme: 'light' as 'light' | 'dark',
  themeColor: DEFAULT_THEME_COLOR,
})

function rememberColor(color?: string) {
  session.themeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? (color.toLowerCase() === '#39776f' ? DEFAULT_THEME_COLOR : color.toLowerCase()) : DEFAULT_THEME_COLOR
}

export function applyTheme(theme: 'light' | 'dark') {
  session.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#191919' : '#ffffff')
  document.documentElement.classList.toggle('dark', theme === 'dark')
  applyThemeColor(session.themeColor, theme)
}

export async function loadSession(): Promise<boolean> {
  try {
    const { data } = await http.get('/auth/me')
    session.user = data.user
    rememberColor(data.user.theme_color)
    applyTheme(data.user.theme === 'dark' ? 'dark' : 'light')
    session.loaded = true
    return true
  } catch {
    session.user = null
    session.loaded = true
    return false
  }
}

export async function login(username: string, password: string) {
  const { data } = await http.post('/auth/login', { username, password })
  session.user = data.user
  rememberColor(data.user.theme_color)
  applyTheme(data.user.theme === 'dark' ? 'dark' : 'light')
  session.loaded = true
  return data.user as SessionUser
}

export async function logout() {
  try {
    await http.post('/auth/logout')
  } finally {
    session.user = null
  }
}

export async function toggleTheme() {
  const next = session.theme === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  await http.put('/preferences', { theme: next })
}

export async function setThemeColor(color: string) {
  session.themeColor = applyThemeColor(color, session.theme)
  await http.put('/preferences', { theme_color: session.themeColor })
}

export type CheckinNavKey = 'shops' | 'social'
export const checkinItems = computed(() => [
  { key: 'shops' as const, label: session.user?.checkin_shop_label || '店铺打卡', path: '/checkins/shops' },
  { key: 'social' as const, label: session.user?.checkin_social_label || '社媒打卡', path: '/checkins/social' },
])
export async function setCheckinLabel(key: CheckinNavKey, label: string) {
  const field = key === 'shops' ? 'checkin_shop_label' : 'checkin_social_label'
  const { data } = await http.put('/preferences', { [field]: label.trim() })
  if (session.user) {
    session.user.checkin_shop_label = data.checkin_shop_label
    session.user.checkin_social_label = data.checkin_social_label
  }
}
