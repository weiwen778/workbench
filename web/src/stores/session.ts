import { reactive } from 'vue'
import { http } from '@/api/client'
import { applyThemeColor, DEFAULT_THEME_COLOR } from '@/theme-color'

export interface SessionUser {
  id: number
  username: string
  theme: 'light' | 'dark'
  theme_color?: string
}

export const session = reactive({
  user: null as SessionUser | null,
  loaded: false,
  theme: 'light' as 'light' | 'dark',
  themeColor: DEFAULT_THEME_COLOR,
})

function rememberColor(color?: string) {
  session.themeColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_THEME_COLOR
}

export function applyTheme(theme: 'light' | 'dark') {
  session.theme = theme
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
