import { useSyncExternalStore } from 'react'
import { http, onUnauthorized } from '@/api/client'
import { applyThemeColor, DEFAULT_THEME_COLOR } from '@/theme-color'
import { clearDocumentDraft } from '@/storage/document-drafts'
import { clearNoteDrafts } from '@/storage/note-drafts'

export interface SessionUser {
  id: number
  username: string
  theme: 'light' | 'dark'
  theme_color?: string
  checkin_shop_label?: string
  checkin_social_label?: string
}

export interface SessionState {
  user: SessionUser | null
  loaded: boolean
  appearanceSaving: boolean
  theme: 'light' | 'dark'
  themeColor: string
}

let state: SessionState = {
  user: null,
  loaded: false,
  appearanceSaving: false,
  theme: 'light',
  themeColor: DEFAULT_THEME_COLOR,
}
const listeners = new Set<() => void>()

function setState(patch: Partial<SessionState>) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

export function getSession(): SessionState {
  return state
}

function rememberColor(color?: string) {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return DEFAULT_THEME_COLOR
  const value = color.toLowerCase()
  // 旧版默认色统一迁移到新的工作台账主色。
  return ['#39776f', '#2383e2', '#1976d2'].includes(value) ? DEFAULT_THEME_COLOR : value
}

export function applyTheme(theme: 'light' | 'dark') {
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', theme === 'dark' ? '#191919' : '#ffffff')
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.dataset.theme = theme
  applyThemeColor(state.themeColor)
  setState({ theme })
}

export async function loadSession(): Promise<boolean> {
  try {
    const { data } = await http.get('/auth/me')
    const color = rememberColor(data.user.theme_color)
    setState({ user: data.user, loaded: true, themeColor: color })
    applyTheme(data.user.theme === 'dark' ? 'dark' : 'light')
    return true
  } catch {
    setState({ user: null, loaded: true })
    return false
  }
}

export async function login(username: string, password: string) {
  const { data } = await http.post('/auth/login', { username, password })
  const color = rememberColor(data.user.theme_color)
  setState({ user: data.user, loaded: true, themeColor: color })
  applyTheme(data.user.theme === 'dark' ? 'dark' : 'light')
  return data.user as SessionUser
}

export async function logout() {
  const userId = state.user?.id
  await http.post('/auth/logout')
  if (userId) {
    await clearDocumentDraft(userId)
    clearNoteDrafts(userId)
  }
  setState({ user: null })
}

export async function setTheme(theme: 'light' | 'dark') {
  if (state.appearanceSaving) return
  const previous = state.theme
  setState({ appearanceSaving: true })
  applyTheme(theme)
  try {
    const { data } = await http.put('/preferences', { theme })
    applyTheme(data.theme || theme)
    if (state.user) setState({ user: { ...state.user, theme: state.theme } })
  } catch (error) {
    applyTheme(previous)
    throw error
  } finally {
    setState({ appearanceSaving: false })
  }
}

export async function toggleTheme() {
  return setTheme(state.theme === 'dark' ? 'light' : 'dark')
}

export async function setThemeColor(color: string) {
  if (state.appearanceSaving) return
  const previous = state.themeColor
  setState({ appearanceSaving: true })
  const next = applyThemeColor(color)
  setState({ themeColor: next })
  try {
    const { data } = await http.put('/preferences', { theme_color: state.themeColor })
    const applied = applyThemeColor(data.theme_color || state.themeColor)
    setState({ themeColor: applied })
    if (state.user) setState({ user: { ...state.user, theme_color: applied } })
  } catch (error) {
    applyThemeColor(previous)
    setState({ themeColor: previous })
    throw error
  } finally {
    setState({ appearanceSaving: false })
  }
}

export type CheckinNavKey = 'shops' | 'social'

export function checkinLabels() {
  return [
    { key: 'shops' as const, label: state.user?.checkin_shop_label || '店铺打卡', path: '/checkins/shops' },
    { key: 'social' as const, label: state.user?.checkin_social_label || '社媒打卡', path: '/checkins/social' },
  ]
}

export async function setCheckinLabel(key: CheckinNavKey, label: string) {
  const field = key === 'shops' ? 'checkin_shop_label' : 'checkin_social_label'
  const { data } = await http.put('/preferences', { [field]: label.trim() })
  if (state.user) {
    setState({
      user: {
        ...state.user,
        checkin_shop_label: data.checkin_shop_label,
        checkin_social_label: data.checkin_social_label,
      },
    })
  }
}

onUnauthorized(() => setState({ user: null }))
