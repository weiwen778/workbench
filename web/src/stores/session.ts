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
  appearanceSaving: false,
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
  await http.post('/auth/logout')
  session.user = null
}

export async function setTheme(theme:'light'|'dark') {
  if(session.appearanceSaving)return
  const previous=session.theme
  session.appearanceSaving=true
  applyTheme(theme)
  try{const {data}=await http.put('/preferences',{theme});applyTheme(data.theme||theme);if(session.user)session.user.theme=session.theme}
  catch(error){applyTheme(previous);throw error}
  finally{session.appearanceSaving=false}
}
export async function toggleTheme(){return setTheme(session.theme==='dark'?'light':'dark')}

export async function setThemeColor(color:string) {
  if(session.appearanceSaving)return
  const previous=session.themeColor
  session.appearanceSaving=true
  session.themeColor=applyThemeColor(color,session.theme)
  try{const {data}=await http.put('/preferences',{theme_color:session.themeColor});session.themeColor=applyThemeColor(data.theme_color||session.themeColor,session.theme);if(session.user)session.user.theme_color=session.themeColor}
  catch(error){session.themeColor=applyThemeColor(previous,session.theme);throw error}
  finally{session.appearanceSaving=false}
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
