import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorView, placeholder } from '@codemirror/view'
import { EditorState, Compartment, Transaction } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { undo, redo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { useSession } from '@/session'

export interface MarkdownEditorHandle {
  insertText: (text: string) => void
  wrapSelection: (prefix: string, suffix?: string) => void
  focus: () => void
  getSelection: () => string
  undo: () => void
  redo: () => void
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, {
  value: string
  onChange: (value: string) => void
  onPaste?: (event: ClipboardEvent) => boolean
  ariaLabel?: string
}>(function MarkdownEditor({
  value, onChange, onPaste, ariaLabel = '笔记正文',
}, ref) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const appearance = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onPasteRef = useRef(onPaste)
  const session = useSession()

  onChangeRef.current = onChange
  onPasteRef.current = onPaste

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      const view = editor.current
      if (!view) return
      const { from, to } = view.state.selection.main
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
      view.focus()
    },
    wrapSelection(prefix: string, suffix = prefix) {
      const view = editor.current
      if (!view) return
      const { from, to } = view.state.selection.main
      const selected = view.state.sliceDoc(from, to)
      const text = `${prefix}${selected || '文字'}${suffix}`
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + prefix.length, head: from + prefix.length + (selected || '文字').length } })
      view.focus()
    },
    focus() { editor.current?.focus() },
    getSelection() {
      const view = editor.current
      if (!view) return ''
      const { from, to } = view.state.selection.main
      return view.state.sliceDoc(from, to)
    },
    undo() { const view = editor.current; if (view) { undo(view); view.focus() } },
    redo() { const view = editor.current; if (view) { redo(view); view.focus() } },
  }), [])

  useEffect(() => {
    if (!host.current) return
    editor.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          appearance.current.of(session.theme === 'dark' ? oneDark : []),
          placeholder('直接写内容，支持 Markdown 排版；Ctrl / Command + F 查找'),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          EditorView.domEventHandlers({
            paste: (event) => {
              const handled = onPasteRef.current?.(event) ?? false
              return handled
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    return () => editor.current?.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = editor.current
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) })
    }
  }, [value])

  useEffect(() => {
    editor.current?.dispatch({ effects: appearance.current.reconfigure(session.theme === 'dark' ? oneDark : []) })
  }, [session.theme])

  return <div ref={host} className="markdown-editor" style={{ height: '100%', minHeight: 160, minWidth: 0 }} />
})

export default MarkdownEditor
