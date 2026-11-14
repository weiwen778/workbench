import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Menu, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import {
  Check, CopyDocument, Delete, Download, Edit, Picture, Plus, Search, Upload,
} from '@/icons'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { apiError, copyText } from '@/api/client'
import { toast } from '@/ui/feedback'
import { downloadBlob, baseName } from '@/convert/files'
import { exportNote } from '@/utils/note-export'
import MarkdownEditor, { type MarkdownEditorHandle } from '@/components/MarkdownEditor'
import ProjectActions from '@/docs/ProjectActions'
import { useUnloadWarning } from '@/docs/useUnloadWarning'
import { uploadProjectFile, type ProjectDetail } from '@/docs/api'
import '@/docs/doc/doc.css'

const ACCEPT = '.docx,.txt,.md,.markdown,.html,.htm'
const MAX_BYTES = 20 * 1024 * 1024
const DRAFT_KEY = 'wb_docs_document_draft_v1'
const DRAFT_MAX_BYTES = 4 * 1024 * 1024

function isSafeResourceUrl(value: string) {
  const raw = value.trim()
  if (!raw) return false
  if (/^(data|blob):/i.test(raw)) return true
  if (raw.startsWith('//')) return false
  try {
    const url = new URL(raw, location.href)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === location.origin
  } catch { return false }
}

function cleanHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'style', 'link', 'meta', 'base'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'formaction'],
  })
  const doc = new DOMParser().parseFromString(sanitized, 'text/html')
  doc.querySelectorAll('[style]').forEach((element) => element.removeAttribute('style'))
  doc.querySelectorAll('*').forEach((element) => {
    element.removeAttribute('srcset')
    for (const attribute of ['src', 'poster', 'background']) {
      const value = element.getAttribute(attribute)
      if (value !== null && !isSafeResourceUrl(value)) element.removeAttribute(attribute)
    }
  })
  doc.querySelectorAll('img').forEach((element) => {
    if (!element.getAttribute('src')) element.replaceWith(doc.createTextNode(element.getAttribute('alt') || ''))
  })
  doc.querySelectorAll('a').forEach((element) => {
    element.setAttribute('target', '_blank')
    element.setAttribute('rel', 'noopener noreferrer')
  })
  return doc.body.innerHTML
}

async function htmlToMarkdown(html: string): Promise<string> {
  const safe = cleanHtml(html)
  const turndownModule: any = await import('turndown')
  const gfmModule: any = await import('turndown-plugin-gfm')
  const TurndownService = turndownModule.default || turndownModule
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' })
  td.use(gfmModule.gfm)
  return td.turndown(safe)
}

async function prepareImport(file: File): Promise<{ markdown: string; warnings: string[]; format: string }> {
  if (file.size > MAX_BYTES) throw new Error(`文件超过 ${MAX_BYTES / 1024 / 1024} MB 上限`)
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    return { markdown: await file.text(), warnings: ext === 'txt' ? ['TXT 作为纯文本导入；换行和空格原样保留'] : [], format: ext === 'txt' ? 'text' : 'markdown' }
  }
  if (ext === 'html' || ext === 'htm') {
    const text = await file.text()
    return { markdown: await htmlToMarkdown(text), warnings: ['HTML 已安全清理：脚本、样式、内嵌框架和远程图片已移除，链接保留'], format: 'html' }
  }
  if (ext === 'docx') {
    const module: any = await import('mammoth')
    const mammoth = module.default || module
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
    return {
      markdown: await htmlToMarkdown(result.value || ''),
      warnings: ['DOCX 已转为可编辑内容；页眉页脚、分页、复杂表格、浮动对象和修订记录可能与 Word 显示不同。导出为新的 DOCX。'],
      format: 'docx',
    }
  }
  throw new Error('仅支持 DOCX、TXT、Markdown、HTML；DOC/RTF/ODT 暂未开放')
}

function blobFromDataUrl(dataUrl: string): Blob {
  const [meta, content] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/png'
  const binary = atob(content)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

const UPLOAD_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

async function uploadableImage(dataUrl: string): Promise<{ blob: Blob; extension: string }> {
  const source = blobFromDataUrl(dataUrl)
  if (UPLOAD_IMAGE_TYPES.has(source.type)) {
    return { blob: source, extension: source.type.split('/')[1].replace('jpeg', 'jpg') }
  }
  const url = URL.createObjectURL(source)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context || !canvas.width || !canvas.height) throw new Error('图片无法转换为 PNG')
    context.drawImage(image, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('图片无法转换为 PNG')), 'image/png',
    ))
    return { blob, extension: 'png' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function DocEditor() {
  const [markdown, setMarkdown] = useState('')
  const [title, setTitle] = useState('未命名文档')
  const [format, setFormat] = useState('markdown')
  const [current, setCurrent] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [draft, setDraft] = useState<{ title: string; markdown: string; format: string; savedAt: string } | null>(null)
  const [draftError, setDraftError] = useState('')
  const [savedBaseline, setSavedBaseline] = useState<{ title: string; markdown: string; format: string } | null>(null)
  const hasContentRef = useRef(false)
  const pendingSaveRef = useRef<{ title: string; markdown: string; format: string } | null>(null)
  const dirty = Boolean(markdown.trim()) && (!savedBaseline
    || savedBaseline.title !== title
    || savedBaseline.markdown !== markdown
    || savedBaseline.format !== format)
  useUnloadWarning(dirty)
  const [view, setView] = useState<'split' | 'edit' | 'preview'>('split')
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const previewHtml = useMemo(() => {
    try {
      const raw = marked.parse(markdown || '*空白文档*', { gfm: true, breaks: false })
      return cleanHtml(typeof raw === 'string' ? raw : '')
    } catch { return '<p>Markdown 暂时无法渲染</p>' }
  }, [markdown])
  const markdownBytes = useMemo(() => new Blob([markdown]).size, [markdown])

  const plainText = useMemo(() => new DOMParser().parseFromString(previewHtml, 'text/html').body.textContent || '', [previewHtml])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.markdown === 'string' && parsed.markdown.trim()) setDraft(parsed)
    } catch { /* ignore malformed local draft */ }
  }, [])

  useEffect(() => {
    if (!markdown.trim()) {
      if (hasContentRef.current) {
        hasContentRef.current = false
        try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
        setDraft(null)
        setDraftError('')
      }
      return
    }
    hasContentRef.current = true
    const timer = window.setTimeout(() => {
      try {
        if (new Blob([markdown]).size > DRAFT_MAX_BYTES) {
          setDraftError('内容超过 4 MB，未写入浏览器本地草稿；请保存项目或导出')
          return
        }
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          title, markdown, format, savedAt: new Date().toISOString(),
        }))
        setDraftError('')
      } catch {
        setDraftError('浏览器本地草稿写入失败（可能空间不足），请保存项目或导出')
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [markdown, title, format])

  const restoreDraft = () => {
    if (!draft) return
    setMarkdown(draft.markdown); setTitle(draft.title || '未命名文档'); setFormat(draft.format || 'markdown')
    setCurrent(null); setWarnings([]); setError(''); setDraft(null); setSavedBaseline(null)
    hasContentRef.current = Boolean(draft.markdown.trim())
    toast.success('已恢复浏览器本地草稿')
  }

  const discardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
    setDraft(null); setDraftError('')
  }

  const importFile = async (file: File) => {
    setLoading(true); setError(''); setWarnings([])
    try {
      const result = await prepareImport(file)
      setMarkdown(result.markdown)
      setTitle(baseName(file.name))
      setFormat(result.format)
      setCurrent(null)
      setWarnings(result.warnings)
      setSavedBaseline(null)
      pendingSaveRef.current = null
      discardDraft()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文档无法打开')
    } finally { setLoading(false) }
  }

  const openProject = async (detail: ProjectDetail) => {
    const state = detail.state || {}
    if (typeof state.markdown !== 'string') throw new Error('项目缺少可恢复的文档内容')
    setMarkdown(state.markdown)
    setTitle(detail.title)
    setFormat(state.sourceFormat || 'markdown')
    setCurrent(detail)
    setError(''); setWarnings([]); setDraft(null)
    setSavedBaseline({ title: detail.title, markdown: state.markdown, format: state.sourceFormat || 'markdown' })
    pendingSaveRef.current = null
    discardDraft()
  }

  const buildSave = async () => {
    let text = markdown
    const pattern = /!\[([^\]]*)\]\((data:image\/([a-zA-Z0-9.+-]+);base64,([^)]+))\)/g
    const matches = [...markdown.matchAll(pattern)]
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]
      const dataUrl = match[2]
      const image = await uploadableImage(dataUrl)
      const attachment = await uploadProjectFile(new File([image.blob], `image-${index + 1}.${image.extension}`, { type: image.blob.type }))
      text = text.split(dataUrl).join(attachment.url)
    }
    if (text !== markdown) setMarkdown(text)
    const referenced = new Set<number>()
    for (const match of text.matchAll(/\/api\/v1\/files\/(\d+)\/content/g)) referenced.add(Number(match[1]))
    pendingSaveRef.current = { title, markdown: text, format }
    return {
      state: { markdown: text, sourceFormat: format },
      attachmentIds: [...referenced],
    }
  }

  const insert = (text: string) => editorRef.current?.insertText(text)
  const wrap = (prefix: string, suffix = prefix) => editorRef.current?.wrapSelection(prefix, suffix)

  const chooseImage = () => imageInput.current?.click()

  const addImage = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => insert(`\n![${file.name}](${String(reader.result || '')})\n`)
    reader.readAsDataURL(file)
  }

  const applyReplace = () => {
    if (!findText) return
    const count = markdown.split(findText).length - 1
    if (!count) { toast.warning('没有找到匹配内容'); return }
    setMarkdown(markdown.split(findText).join(replaceText))
    setFindOpen(false)
    toast.success(`已替换 ${count} 处`)
  }

  const exportAs = async (kind: 'docx' | 'html' | 'pdf' | 'md' | 'txt') => {
    setExportAnchor(null)
    try {
      if (kind === 'md') { downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${baseName(title)}.md`); return }
      if (kind === 'txt') { downloadBlob(new Blob([plainText], { type: 'text/plain;charset=utf-8' }), `${baseName(title)}.txt`); return }
      setLoading(true)
      await exportNote(title, previewHtml, kind)
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '导出失败') }
    finally { setLoading(false) }
  }

  const printDocument = () => {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;height:1123px;border:0'
    document.body.append(frame)
    const doc = frame.contentDocument
    if (!doc) { frame.remove(); return }
    const style = `
      body{font-family:"Microsoft YaHei","Noto Sans SC",sans-serif;color:#202630;line-height:1.75;font-size:14px;padding:32px}
      h1{font-size:26px} h2{font-size:21px} h3{font-size:17px}
      table{border-collapse:collapse;width:100%} td,th{border:1px solid #bac2cd;padding:6px}
      img{max-width:100%;height:auto} pre{white-space:pre-wrap;background:#f1f3f5;padding:12px}
      @page{margin:16mm}`
    doc.open()
    doc.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, '')}</title><style>${style}</style></head><body><h1>${title.replace(/[<>&"]/g, '')}</h1>${previewHtml}</body></html>`)
    doc.close()
    setTimeout(() => {
      try { frame.contentWindow?.focus(); frame.contentWindow?.print() } finally { setTimeout(() => frame.remove(), 3000) }
    }, 300)
    setPrintOpen(false)
  }

  const newDocument = () => {
    setMarkdown(''); setTitle('未命名文档'); setCurrent(null); setFormat('markdown'); setWarnings([]); setError('')
    setSavedBaseline(null)
    pendingSaveRef.current = null
    discardDraft()
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) addImage(file) }} />
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.25, py: 0.6, borderBottom: 1, borderColor: 'divider' }}>
        <TextField size="small" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="文档标题" inputProps={{ maxLength: 200, 'aria-label': '文档标题' }} sx={{ width: { xs: 130, sm: 220 }, '& .MuiInputBase-input': { fontSize: 13, fontWeight: 600, py: 0.5 } }} />
        <Chip size="small" variant="outlined" label={format.toUpperCase()} />
        <Box sx={{ flex: 1 }} />
        <ProjectActions kind="document" kindLabel="文档" title={title} onTitleChange={setTitle} current={current} onCurrentChange={(project) => { setCurrent(project); if (project) discardDraft() }} onSaved={() => { const saved = pendingSaveRef.current; if (saved) { setSavedBaseline(saved); pendingSaveRef.current = null } }} buildSave={buildSave} onOpen={openProject} />
        <Button size="small" startIcon={<Upload fontSize="small" />} onClick={() => inputRef.current?.click()}>导入</Button>
        <Button size="small" onClick={newDocument}>新建</Button>
        <Button size="small" startIcon={<Download fontSize="small" />} onClick={(event) => setExportAnchor(event.currentTarget)}>导出</Button>
        <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
          <MenuItem onClick={() => void exportAs('docx')}>导出 DOCX</MenuItem>
          <MenuItem onClick={() => void exportAs('html')}>导出 HTML</MenuItem>
          <MenuItem onClick={() => void exportAs('md')}>导出 Markdown</MenuItem>
          <MenuItem onClick={() => void exportAs('txt')}>导出 TXT</MenuItem>
          <MenuItem onClick={() => void exportAs('pdf')}>导出 PDF</MenuItem>
          <MenuItem onClick={() => { setExportAnchor(null); setPrintOpen(true) }}>打印预览</MenuItem>
        </Menu>
      </Stack>

      <Stack direction="row" spacing={0.4} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.25, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Tooltip title="一级标题"><IconButton size="small" onClick={() => insert('\n# 标题\n')}><Typography sx={{ fontSize: 13, fontWeight: 700 }}>H1</Typography></IconButton></Tooltip>
        <Tooltip title="二级标题"><IconButton size="small" onClick={() => insert('\n## 标题\n')}><Typography sx={{ fontSize: 12, fontWeight: 700 }}>H2</Typography></IconButton></Tooltip>
        <Button size="small" onClick={() => wrap('**')}><strong>B</strong></Button>
        <Button size="small" onClick={() => wrap('*')}><em>I</em></Button>
        <Button size="small" onClick={() => insert('\n- 列表项\n')}>列表</Button>
        <Button size="small" onClick={() => insert('\n1. 列表项\n')}>编号</Button>
        <Button size="small" onClick={() => insert('\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n')}>表格</Button>
        <Button size="small" startIcon={<Picture fontSize="small" />} onClick={chooseImage}>图片</Button>
        <Button size="small" startIcon={<Search fontSize="small" />} onClick={() => setFindOpen(true)}>查找替换</Button>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.4 }} />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, value) => value && setView(value)}>
          <ToggleButton value="edit">编辑</ToggleButton>
          <ToggleButton value="split">分栏</ToggleButton>
          <ToggleButton value="preview">预览</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<CopyDocument fontSize="small" />} onClick={async () => { if (await copyText(markdown)) toast.success('已复制 Markdown'); else toast.warning('浏览器不允许自动复制') }}>复制 Markdown</Button>
        <Button size="small" onClick={() => editorRef.current?.undo()}>撤销</Button>
        <Button size="small" onClick={() => editorRef.current?.redo()}>重做</Button>
      </Stack>

      {loading ? <CircularProgress size={16} sx={{ position: 'absolute', right: 24, top: 18 }} /> : null}
      {!markdown ? <Alert severity="info" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }}>支持导入 DOCX、TXT、Markdown、HTML，并导出 DOCX / HTML / Markdown / TXT / PDF。DOC/RTF/ODT 暂未开放；DOCX 页眉页脚、分页、复杂表格、修订记录可能与 Word 有差异。</Alert> : null}
      {error ? <Alert severity="error" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 12 }} onClose={() => setError('')}>{error}</Alert> : null}
      {warnings.length ? <Alert severity="warning" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }}>{warnings.join('；')}</Alert> : null}
      {draft ? (
        <Alert severity="info" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }}
          action={<Stack direction="row" spacing={0.5}><Button size="small" onClick={restoreDraft}>恢复</Button><Button size="small" onClick={discardDraft}>丢弃</Button></Stack>}>
          发现浏览器本地草稿「{draft.title || '未命名文档'}」{draft.savedAt ? `（${new Date(draft.savedAt).toLocaleString('zh-CN', { hour12: false })}）` : ''}
        </Alert>
      ) : null}
      {draftError ? <Alert severity="warning" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }} onClose={() => setDraftError('')}>{draftError}</Alert> : null}
      {markdownBytes > 4.5 * 1024 * 1024 ? <Alert severity="warning" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }}>当前正文约 {(markdownBytes / 1024 / 1024).toFixed(1)} MB，项目状态上限为 5 MB；请先导出或拆分内容，保存可能失败。</Alert> : null}

      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: view === 'split' ? '1fr 1fr' : '1fr' }, overflow: 'hidden' }}>
        {(view === 'edit' || view === 'split') ? (
          <Box sx={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: { md: view === 'split' ? 1 : 0 }, borderColor: 'divider' }}>
            <Box sx={{ px: 1.25, py: 0.35, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
              <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>Markdown 编辑 · Ctrl/⌘ Z 撤销 · Ctrl/⌘ F 查找（编辑器内）</Typography>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0 }}>
              <MarkdownEditor ref={editorRef} value={markdown} onChange={setMarkdown} ariaLabel="文档 Markdown 正文" />
            </Box>
          </Box>
        ) : null}
        {(view === 'preview' || view === 'split') ? (
          <Box className="scroll-area" sx={{ minWidth: 0, minHeight: 0, overflow: 'auto', bgcolor: (theme) => theme.palette.mode === 'dark' ? '#11181B' : '#E9EEEC' }}>
            <Box className="doc-preview" sx={{ maxWidth: 900, margin: '0 auto', my: 1.5, boxShadow: '0 2px 14px rgba(0,0,0,0.08)' }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </Box>
        ) : null}
      </Box>

      <Dialog open={findOpen} onClose={() => setFindOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>查找与替换</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField autoFocus fullWidth size="small" label="查找" value={findText} onChange={(event) => setFindText(event.target.value)} sx={{ mb: 1.25 }} />
          <TextField fullWidth size="small" label="替换为" value={replaceText} onChange={(event) => setReplaceText(event.target.value)} />
        </DialogContent>
        <DialogActions><Button size="small" onClick={() => setFindOpen(false)}>取消</Button><Button size="small" variant="contained" disabled={!findText} onClick={applyReplace}>全部替换</Button></DialogActions>
      </Dialog>

      <Dialog open={printOpen} onClose={() => setPrintOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>打印预览</DialogTitle>
        <DialogContent sx={{ p: 0, bgcolor: '#E9EEEC', maxHeight: '70vh', overflow: 'auto' }}>
          <Box className="doc-preview" sx={{ maxWidth: 760, margin: '16px auto', boxShadow: '0 2px 14px rgba(0,0,0,0.12)' }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setPrintOpen(false)}>关闭</Button>
          <Button size="small" startIcon={<Download fontSize="small" />} onClick={() => void exportAs('pdf')}>导出 PDF</Button>
          <Button size="small" variant="contained" onClick={printDocument}>浏览器打印</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
