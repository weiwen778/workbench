/**
 * 浏览器端异常上报：尽量自包含，只依赖 fetch，避免和 axios 拦截器形成循环。
 * 相同签名 5 分钟内只报一次，每分钟最多 20 条，接口本身失败时静默忽略。
 */
const DEDUPE_MS = 5 * 60 * 1000
const PER_MINUTE = 20

const recent = new Map<string, number>()
let windowStarted = 0
let windowCount = 0
let installed = false

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : ''
}

function currentRoute(): string {
  return `${window.location.pathname}${window.location.search}`.slice(0, 500)
}

function allow(key: string): boolean {
  const now = Date.now()
  const last = recent.get(key)
  if (last && now - last < DEDUPE_MS) return false
  if (now - windowStarted > 60_000) {
    windowStarted = now
    windowCount = 0
  }
  if (windowCount >= PER_MINUTE) return false
  recent.set(key, now)
  if (recent.size > 200) {
    for (const [entry, stamp] of recent) {
      if (now - stamp > DEDUPE_MS) recent.delete(entry)
    }
  }
  windowCount += 1
  return true
}

export interface ClientErrorInput {
  level?: 'debug' | 'info' | 'warning' | 'error'
  message: string
  stack?: string
  route?: string
  context?: Record<string, unknown>
}

export function reportClientError(input: ClientErrorInput): void {
  const message = (input.message || '').trim().slice(0, 4000)
  if (!message) return
  const route = (input.route || currentRoute()).slice(0, 500)
  const key = `${input.level || 'error'}|${message}|${route}`
  if (!allow(key)) return

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const csrf = readCookie('wb_csrf')
  if (csrf) headers['X-CSRF-Token'] = csrf

  void fetch('/api/v1/logs/client', {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers,
    body: JSON.stringify({
      level: input.level || 'error',
      message,
      stack: input.stack?.slice(0, 12000),
      route,
      context: input.context,
    }),
  }).catch(() => { /* 日志上报失败不再制造新的错误 */ })
}

function rejectionMessage(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message || reason.name, stack: reason.stack }
  if (typeof reason === 'string') return { message: reason }
  try {
    return { message: JSON.stringify(reason).slice(0, 2000) }
  } catch {
    return { message: String(reason) }
  }
}

export function installGlobalErrorReporting(): void {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    // 资源加载失败没有 error 对象，消息里通常只有资源地址
    const target = event.target
    if (target instanceof HTMLElement) {
      const source = (target as HTMLImageElement).src || (target as HTMLAnchorElement).href || ''
      reportClientError({
        level: 'warning',
        message: `资源加载失败：${target.tagName.toLowerCase()}`,
        context: { source: source.slice(0, 500) },
      })
      return
    }
    reportClientError({
      message: event.message || '未捕获的脚本错误',
      stack: event.error instanceof Error ? event.error.stack : undefined,
      context: { filename: event.filename, line: event.lineno, column: event.colno },
    })
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    const reason = rejectionMessage(event.reason)
    reportClientError({ message: `未处理的 Promise 异常：${reason.message}`, stack: reason.stack })
  })
}
