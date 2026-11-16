import * as Comlink from 'comlink'
import { computeAnalysis, type AnalysisInput, type AnalysisOutput } from './pivot'
import type { AnalysisWorkerApi } from './worker'

export type AnalysisErrorCode = 'CANCELLED' | 'STALE' | 'TIMEOUT'

export class AnalysisError extends Error {
  code: AnalysisErrorCode

  constructor(code: AnalysisErrorCode, message: string) {
    super(message)
    this.name = 'AnalysisError'
    this.code = code
  }
}

const DEFAULT_TIMEOUT = 15_000

let worker: Worker | null = null
let proxy: Comlink.Remote<AnalysisWorkerApi> | null = null
let unavailable = false
let generation = 0
const cancellations = new Set<() => void>()

function getProxy(): Comlink.Remote<AnalysisWorkerApi> | null {
  if (unavailable) return null
  if (proxy) return proxy
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    proxy = Comlink.wrap<AnalysisWorkerApi>(worker)
    return proxy
  } catch {
    unavailable = true
    worker = null
    proxy = null
    return null
  }
}

function recycleWorker() {
  worker?.terminate()
  worker = null
  proxy = null
}

/**
 * Runs one grouping/pivot computation off the main thread. A newer request or
 * an explicit cancel invalidates earlier results; timeouts terminate the worker
 * so a runaway computation cannot keep a core busy forever.
 */
export async function runAnalysis(input: AnalysisInput, options: { timeoutMs?: number } = {}): Promise<AnalysisOutput> {
  const token = ++generation
  const api = getProxy()
  if (!api) return computeAnalysis(input)

  let cancel = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new AnalysisError('CANCELLED', '分析已取消'))
  })
  cancellations.add(cancel)

  let timer = 0
  try {
    const result = await Promise.race([
      api.run(input),
      cancelled,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          if (token === generation) recycleWorker()
          reject(new AnalysisError('TIMEOUT', '分析耗时过长，已取消；请减少分组或缩小数据范围后重试'))
        }, options.timeoutMs ?? DEFAULT_TIMEOUT)
      }),
    ])
    if (token !== generation) throw new AnalysisError('STALE', '分析结果已过期')
    return result
  } catch (error) {
    if (error instanceof AnalysisError) throw error
    if (token !== generation) throw new AnalysisError('STALE', '分析结果已过期')
    // A worker that cannot load or serialize falls back to the same pure
    // computation on the main thread instead of breaking the dialog.
    unavailable = true
    recycleWorker()
    return computeAnalysis(input)
  } finally {
    window.clearTimeout(timer)
    cancellations.delete(cancel)
  }
}

/** Invalidates in-flight requests without destroying the worker. */
export function cancelAnalysis() {
  generation += 1
  const pending = [...cancellations]
  cancellations.clear()
  for (const cancel of pending) cancel()
}
