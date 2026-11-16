import axios from 'axios'

export const http = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 60000,
})

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : ''
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
    if (error?.response?.status === 401) unauthorizedHandler?.()
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
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 继续走回退方案 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
