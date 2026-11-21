import axios from 'axios'
import { reportClientError } from '@/logging/client-errors'

export const http = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 60000,
})

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : ''
}

/** 供 keepalive fetch 等需要手动构造请求的地方读取 CSRF 令牌。 */
export function readCsrfToken(): string {
  return readCookie('wb_csrf')
}

http.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase()
  if (['post', 'put', 'patch', 'delete'].includes(method)) {
    const token = readCookie('wb_csrf')
    if (token) config.headers.set('X-CSRF-Token', token)
  }
  return config
})

let unauthorizedHandler: (() => void) | null = null
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler
}

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = Number(error?.response?.status) || 0
    if (status === 401) unauthorizedHandler?.()
    const url = String(error?.config?.url || '')
    const isLogRequest = url.includes('/logs')
    if (!isLogRequest && status !== 401 && (status >= 500 || status === 0)) {
      reportClientError({
        message: status >= 500 ? `接口返回 ${status}：${url}` : `接口请求失败：${url}`,
        stack: error?.stack,
        context: {
          url,
          method: String(error?.config?.method || 'get').toUpperCase(),
          status,
          code: error?.code || '',
        },
      })
    }
    return Promise.reject(error)
  },
)

export interface ApiErrorShape {
  code: string
  message: string
  details?: Record<string, any>
}

export function apiError(error: any): ApiErrorShape {
  const body = error?.response?.data
  if (body && typeof body === 'object' && body.message) {
    return { code: body.code || 'ERROR', message: body.message, details: body.details || {} }
  }
  if (error?.code === 'ECONNABORTED') {
    return { code: 'TIMEOUT', message: '请求超时，请稍后重试；已保存的内容不会丢失' }
  }
  if (error?.message === 'Network Error') {
    return { code: 'NETWORK', message: '网络连接失败，请检查网络后重试' }
  }
  return { code: 'ERROR', message: error?.message || '操作失败，请重试' }
}

export function fieldError(error: any): Record<string, string> {
  return (apiError(error).details?.fields as Record<string, string>) || {}
}

export async function copyText(text: string): Promise<boolean> {
  // 先走同步的 execCommand，确保仍在用户点击手势内完成复制；
  // 某些浏览器会在 navigator.clipboard 的 await 之后拒绝回退方案。
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-9999px'
    area.style.left = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.focus({ preventScroll: true })
    area.select()
    area.setSelectionRange(0, area.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    if (ok) return true
  } catch {
    /* 继续尝试 Clipboard API */
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 浏览器拒绝时返回失败，由调用方提示手动复制 */
  }
  return false
}
