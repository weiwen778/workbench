import { useEffect } from 'react'

/** Warn before a tab close/refresh when an in-memory document exists. */
export function useUnloadWarning(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [enabled])
}
