import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material'
import PopDialog from '@/motion/components/PopDialog'
import ToastStack from '@/motion/components/ToastStack'

/* ------------------------------- Toasts ------------------------------- */

type ToastType = 'success' | 'error' | 'warning' | 'info'
interface ToastItem { id: number; type: ToastType; text: string }

let toastSeq = 0
let toasts: ToastItem[] = []
const toastListeners = new Set<() => void>()
function emitToasts() { toastListeners.forEach((fn) => fn()) }

function pushToast(type: ToastType, text: string) {
  const id = ++toastSeq
  toasts = [...toasts, { id, type, text }].slice(-4)
  emitToasts()
  window.setTimeout(() => dismissToast(id), type === 'error' ? 6000 : 3600)
}

function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emitToasts()
}

export const toast = {
  success: (text: string) => pushToast('success', text),
  error: (text: string) => pushToast('error', text),
  warning: (text: string) => pushToast('warning', text),
  info: (text: string) => pushToast('info', text),
}

export function Toaster() {
  const items = useSyncExternalStore(
    (fn) => { toastListeners.add(fn); return () => toastListeners.delete(fn) },
    () => toasts,
    () => toasts,
  )
  return <ToastStack items={items} onDismiss={dismissToast} />
}

/* ------------------------------- Dialogs ------------------------------ */

export interface ConfirmOptions {
  title?: string
  message: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export interface PromptOptions {
  title?: string
  message?: ReactNode
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  maxLength?: number
  validate?: (value: string) => string | true
}

type DialogItem =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

let dialogs: DialogItem[] = []
const dialogListeners = new Set<() => void>()
function emitDialogs() { dialogListeners.forEach((fn) => fn()) }

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { kind: 'confirm', options, resolve }]
    emitDialogs()
  })
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { kind: 'prompt', options, resolve }]
    emitDialogs()
  })
}

function closeDialog(result: boolean | string | null) {
  const [current, ...rest] = dialogs
  if (!current) return
  dialogs = rest
  emitDialogs()
  if (current.kind === 'confirm') current.resolve(Boolean(result))
  else current.resolve(typeof result === 'string' ? result : null)
}

export function DialogHost() {
  const queue = useSyncExternalStore(
    (fn) => { dialogListeners.add(fn); return () => dialogListeners.delete(fn) },
    () => dialogs,
    () => dialogs,
  )
  const current = queue[0]
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isPrompt = current?.kind === 'prompt'

  useEffect(() => {
    if (!current) return
    if (current.kind === 'prompt') {
      setValue(current.options.defaultValue ?? '')
      setError('')
      window.setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [current])

  if (!current) return null
  const options = current.options
  const promptOptions = current.kind === 'prompt' ? current.options : null

  const submit = () => {
    if (current.kind === 'confirm') {
      closeDialog(true)
      return
    }
    const text = value.trim()
    if (!text) { setError('请填写内容'); return }
    if (promptOptions?.maxLength && text.length > promptOptions.maxLength) { setError(`最多 ${promptOptions.maxLength} 个字`); return }
    const check = promptOptions?.validate?.(text)
    if (check && check !== true) { setError(check); return }
    closeDialog(text)
  }

  return (
    <PopDialog open maxWidth="xs" fullWidth onClose={() => closeDialog(current.kind === 'confirm' ? false : null)}>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{options.title || (isPrompt ? '请输入' : '确认操作')}</DialogTitle>
      <DialogContent>
        {options.message ? (
          <DialogContentText component="div" sx={{ fontSize: 13.5, color: 'text.secondary', whiteSpace: 'pre-wrap' }}>
            {options.message}
          </DialogContentText>
        ) : null}
        {current.kind === 'prompt' ? (
          <TextField
            inputRef={inputRef}
            sx={{ mt: options.message ? 1.5 : 0 }}
            fullWidth
            size="small"
            label={promptOptions?.label}
            placeholder={promptOptions?.placeholder}
            value={value}
            error={Boolean(error)}
            helperText={error || undefined}
            inputProps={{ maxLength: promptOptions?.maxLength }}
            onChange={(event) => { setValue(event.target.value); setError('') }}
            onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
          />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={() => closeDialog(current.kind === 'confirm' ? false : null)}>
          {options.cancelText || '取消'}
        </Button>
        <Button
          size="small"
          variant="contained"
          color={current.kind === 'confirm' && current.options.danger ? 'error' : 'primary'}
          onClick={submit}
        >
          {options.confirmText || '确定'}
        </Button>
      </DialogActions>
    </PopDialog>
  )
}

/* --------------------------- Promise helpers --------------------------- */

export async function withErrorToast<T>(task: () => Promise<T>, fallback = '操作失败'): Promise<T | undefined> {
  try {
    return await task()
  } catch (error: any) {
    const message = error?.response?.data?.message || error?.message || fallback
    toast.error(message)
    return undefined
  }
}

export function ErrorBlock({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <Stack sx={{ py: 1 }}>
      <Alert severity="error" variant="outlined">{String((error as any)?.message || error)}</Alert>
    </Stack>
  )
}
