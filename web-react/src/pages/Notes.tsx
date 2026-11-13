import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Drawer, FormControl, IconButton, InputLabel, Menu, MenuItem, Popover, Select, Stack, TextField, Typography,
} from '@mui/material'
import { Divider } from '@mui/material'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Clock, MoreFilled, Picture, Plus, Search, View } from '@/icons'
import { apiError, http } from '@/api/client'
import { EmptyHint, Page } from '@/ui/common'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import MarkdownEditor from '@/components/MarkdownEditor'
import { exportNote } from '@/utils/note-export'

type Mode = 'split' | 'edit' | 'preview'

export default function NotesPage() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const routeFolder = String(params.folderKey || '')

  const [folders, setFolders] = useState<any[]>([])
  const [uncategorized, setUncategorized] = useState(0)
  const [tags, setTags] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [notePage, setNotePage] = useState(1)
  const [noteTotal, setNoteTotal] = useState(0)
  const [current, setCurrent] = useState<any | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [folderId, setFolderId] = useState<number | null>(null)
  const [tagNames, setTagNames] = useState<string[]>([])
  const [version, setVersion] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [filterTag, setFilterTag] = useState<number | null>(null)
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null)
  const [folderMenu, setFolderMenu] = useState<HTMLElement | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [mode, setMode] = useState<Mode>(window.innerWidth < 1024 ? 'edit' : 'split')
  const [missingFolder, setMissingFolder] = useState(false)
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  const [revisions, setRevisions] = useState<any[]>([])
  const [previewing, setPreviewing] = useState<any | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null)
  const [exporting, setExporting] = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(false)

  const suppress = useRef(true)
  const saveTimer = useRef<number | null>(null)
  const searchTimer = useRef<number | null>(null)
  const saveInFlight = useRef<Promise<boolean> | null>(null)
  const noteRequest = useRef(0)
  const imageInput = useRef<HTMLInputElement>(null)
  const stateRef = useRef({ current, title, content, folderId, tagNames, version })
  stateRef.current = { current, title, content, folderId, tagNames, version }

  const folderFilter = /^\d+$/.test(routeFolder) ? Number(routeFolder) : null
  const uncategorizedFilter = routeFolder === 'uncategorized'
  const selectedFolder = folders.find((folder) => folder.id === folderFilter)
  const selectedTag = tags.find((tag) => tag.id === filterTag)

  const rendered = marked.parse(content || '', { async: false }) as string
  const previewHtml = DOMPurify.sanitize(rendered, { FORBID_TAGS: ['script', 'iframe', 'style', 'form'], FORBID_ATTR: ['onerror', 'onclick'] })

  const formatDate = (value: string) => value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''

  const reasonText = (reason: string) => ({ auto: '首次保存', interval: '自动保存', manual: '手动保存', restore: '恢复前备份' } as Record<string, string>)[reason] || reason

  const loadFolders = useCallback(async () => {
    const { data } = await http.get('/note-folders')
    setFolders(data.folders); setUncategorized(data.uncategorized)
    setTags((await http.get('/note-tags')).data)
    window.dispatchEvent(new Event('wb:notes-changed'))
  }, [])

  const loadNotes = useCallback(async () => {
    const request = ++noteRequest.current
    setLoadingNotes(true)
    try {
      const reqParams: Record<string, any> = { summary: true, page: notePage, page_size: 50 }
      if (folderFilter) reqParams.folder_id = folderFilter
      if (uncategorizedFilter) reqParams.uncategorized = true
      if (filterTag) reqParams.tag_id = filterTag
      if (keyword.trim()) reqParams.q = keyword.trim()
      const { data } = await http.get('/notes', { params: reqParams })
      if (request !== noteRequest.current) return
      setNotes(data.items); setNotePage(data.page); setNoteTotal(data.total)
    } catch (error) { toast.error(apiError(error).message) }
    finally { setLoadingNotes(false) }
  }, [notePage, folderFilter, uncategorizedFilter, filterTag, keyword])

  const hasUnsaved = useCallback(() => {
    const snapshot = stateRef.current
    if (!snapshot.current) return false
    return snapshot.title !== (snapshot.current.raw_title || '')
      || snapshot.content !== snapshot.current.content
      || snapshot.folderId !== snapshot.current.folder_id
      || JSON.stringify(snapshot.tagNames) !== JSON.stringify(snapshot.current.tags)
  }, [])

  const performSave = useCallback(async (saveMode: 'auto' | 'manual'): Promise<boolean> => {
    const snapshot = stateRef.current
    if (!snapshot.current) return true
    setSaving(true); setSaveState('saving')
    try {
      const { data } = await http.put(`/notes/${snapshot.current.id}`, {
        title: snapshot.title, content: snapshot.content,
        folder_id: snapshot.folderId ?? null, tags: snapshot.tagNames,
        version: snapshot.version, mode: saveMode,
      })
      setVersion(data.version); setCurrent(data); setSaveState('saved'); setConflict(false)
      await Promise.all([loadNotes(), loadFolders()])
      return true
    } catch (error: any) {
      setSaveState('error')
      if (error?.response?.status === 409) { setConflict(true); toast.warning('这篇笔记在别处被改过，你的内容没有覆盖它') }
      else toast.error(apiError(error).message)
      return false
    } finally { setSaving(false) }
  }, [loadNotes, loadFolders])

  const save = useCallback(async (saveMode: 'auto' | 'manual'): Promise<boolean> => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    while (saveInFlight.current) { if (!await saveInFlight.current) return false }
    if (!stateRef.current.current || !hasUnsaved()) return true
    const request = performSave(saveMode)
    saveInFlight.current = request
    try { return await request } finally { if (saveInFlight.current === request) saveInFlight.current = null }
  }, [hasUnsaved, performSave])

  const openNote = useCallback(async (id: number, skipGuard = false) => {
    if (!skipGuard && (hasUnsaved() || saveInFlight.current)) {
      if (!await save('manual')) return
    }
    try {
      const { data } = await http.get(`/notes/${id}`)
      suppress.current = true
      setCurrent(data)
      setTitle(data.raw_title ?? data.title)
      setContent(data.content)
      setFolderId(data.folder_id)
      setTagNames([...data.tags])
      setVersion(data.version)
      setSaveState('idle'); setConflict(false)
      window.setTimeout(() => { suppress.current = false }, 0)
    } catch (error) { toast.error(apiError(error).message) }
  }, [hasUnsaved, save])

  useEffect(() => {
    if (suppress.current || !stateRef.current.current) return
    setSaveState('idle')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void save('auto'), 1500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, folderId, tagNames])

  useEffect(() => {
    void (async () => {
      try {
        await loadFolders()
        const missing = Boolean(routeFolder) && routeFolder !== 'uncategorized' && !folders.some((folder) => String(folder.id) === routeFolder)
        setMissingFolder(missing)
        if (!missing) await loadNotes()
        const noteParam = searchParams.get('note')
        if (noteParam) await openNote(Number(noteParam), true)
        else if (notes.length && window.innerWidth > 700) await openNote(notes[0].id, true)
      } catch (error) { toast.error(apiError(error).message) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeFolder])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsaved()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [hasUnsaved])

  const onSearchChange = (value: string) => {
    setKeyword(value); setNotePage(1)
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => void loadNotes(), 300)
  }

  const createNote = async () => {
    if (!await save('manual')) return
    try {
      const { data } = await http.post('/notes', { title: '', content: '', folder_id: folderFilter, tags: [] })
      await Promise.all([loadNotes(), loadFolders()])
      await openNote(data.id, true)
      window.setTimeout(() => document.querySelector<HTMLInputElement>('.title-input input')?.focus(), 100)
    } catch (error) { toast.error(apiError(error).message) }
  }

  const removeFolder = async (folder: any) => {
    if (!await save('manual')) return
    const ok = await confirmDialog({ title: '删除文件夹', danger: true, confirmText: '删除', message: `删除文件夹「${folder.name}」？里面的笔记会移到「未分类」，笔记本身不会删。` })
    if (!ok) return
    try {
      await http.delete(`/note-folders/${folder.id}`)
      setCurrent(null)
      await loadFolders()
      navigate('/notes/uncategorized', { replace: true })
    } catch (error) { toast.error(apiError(error).message) }
  }

  const folderCommand = async (command: string) => {
    setFolderMenu(null)
    if (!selectedFolder) return
    if (command === 'delete') { await removeFolder(selectedFolder); return }
    const value = await promptDialog({ title: '重命名文件夹', label: '文件夹名称', defaultValue: selectedFolder.name, maxLength: 100, confirmText: '保存' })
    if (!value) return
    try { await http.patch(`/note-folders/${selectedFolder.id}`, { name: value }); await loadFolders() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const removeTag = async (tag: any) => {
    try {
      await http.delete(`/note-tags/${tag.id}`)
      if (filterTag === tag.id) setFilterTag(null)
      await Promise.all([loadFolders(), loadNotes()])
    } catch (error) { toast.error(apiError(error).message) }
  }

  const forceSave = async () => {
    if (!current) return
    try {
      const { data: latest } = await http.get(`/notes/${current.id}`)
      setVersion(latest.version); setConflict(false)
      stateRef.current = { ...stateRef.current, version: latest.version }
      if (await save('manual')) toast.success('已用当前内容覆盖')
    } catch (error) { toast.error(apiError(error).message) }
  }

  const reloadServer = async () => {
    if (!current) return
    await openNote(current.id, true)
    toast.success('已载入最新内容')
  }

  const uploadImage = async (file: File) => {
    const form = new FormData(); form.append('file', file)
    try {
      const { data } = await http.post('/files', form)
      setContent((prev) => `${prev}\n![${data.name}](/api/v1/files/${data.id}/content)\n`)
      toast.success('图片已插入正文，保存后生效')
    } catch (error) { toast.error(apiError(error).message) }
  }

  const onPaste = (event: ClipboardEvent) => {
    const items = event.clipboardData?.items
    if (!items) return false
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) { event.preventDefault(); void uploadImage(file); return true }
      }
    }
    return false
  }

  const cycleMode = () => {
    const order: Mode[] = window.innerWidth < 1024 ? ['edit', 'preview'] : ['split', 'edit', 'preview']
    setMode(order[(order.indexOf(mode) + 1) % order.length])
  }

  const openRevisions = async () => {
    if (!current) return
    setRevisionsOpen(true)
    try { setRevisions((await http.get(`/notes/${current.id}/revisions`)).data) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const previewRevision = async (rev: any) => {
    try {
      const { data } = await http.get(`/notes/${current.id}/revisions/${rev.id}`)
      setPreviewing(data); setPreviewOpen(true)
    } catch (error) { toast.error(apiError(error).message) }
  }

  const restoreRevision = async (rev: any) => {
    const ok = await confirmDialog({ title: '恢复历史版本', danger: true, confirmText: '恢复', message: '恢复后会用这个旧版本盖掉现在的标题和正文（现在的内容会先存成一个历史版本）。' })
    if (!ok) return
    try {
      const { data } = await http.post(`/notes/${current.id}/revisions/${rev.id}/restore`)
      setPreviewOpen(false); setRevisionsOpen(false)
      suppress.current = true
      setTitle(data.raw_title ?? data.title); setContent(data.content); setVersion(data.version); setCurrent(data)
      setSaveState('saved')
      window.setTimeout(() => { suppress.current = false }, 0)
      await Promise.all([loadNotes(), loadFolders()])
      toast.success('已恢复')
    } catch (error) { toast.error(apiError(error).message) }
  }

  const doExport = async (format: string) => {
    setExportMenu(null)
    if (exporting) return
    setExporting(true)
    try { await exportNote(title || '未命名笔记', previewHtml, format); toast.success('已导出') }
    catch (error) { toast.error(error instanceof Error ? error.message : '导出失败') }
    finally { setExporting(false) }
  }

  const saveLabel = saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : saveState === 'saved' ? '已保存' : '未修改'
  const modeLabel = ({ split: '单栏', edit: '只看编辑', preview: '只看预览' } as Record<Mode, string>)[mode]

  return (
    <Box className={`notes-layout${current ? ' has-current' : ''}`} sx={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Box className="note-list-pane" sx={{ width: { xs: '100%', md: 232 }, flex: { xs: 1, md: '0 0 232px' }, borderRight: { md: (theme) => `1px solid ${theme.palette.divider}` }, borderColor: { md: 'divider' }, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box className="list-toolbar" sx={{ p: '6px 8px', borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.6 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>
              {selectedFolder?.name || (uncategorizedFilter ? '未分类' : missingFolder ? '文件夹不存在' : '全部笔记')}
            </Typography>
            {selectedFolder ? <IconButton size="small" aria-label="文件夹操作" onClick={(event) => setFolderMenu(event.currentTarget)}><MoreFilled fontSize="small" /></IconButton> : null}
            <Menu anchorEl={folderMenu} open={Boolean(folderMenu)} onClose={() => setFolderMenu(null)}>
              <MenuItem onClick={() => void folderCommand('rename')}>重命名文件夹</MenuItem>
              <MenuItem onClick={() => void folderCommand('delete')}>删除文件夹</MenuItem>
            </Menu>
          </Stack>
          {missingFolder ? <Alert severity="error" sx={{ mb: 1, fontSize: 12 }}>文件夹不存在或已删除</Alert> : null}
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1 }}>
            <Button size="small" onClick={(event) => setTagAnchor(event.currentTarget)} sx={{ fontSize: 12 }}>
              {selectedTag ? `标签：${selectedTag.name}` : '标签筛选'}
            </Button>
            <Popover open={Boolean(tagAnchor)} anchorEl={tagAnchor} onClose={() => setTagAnchor(null)}>
              <Box sx={{ p: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 290 }}>
                {tags.map((tag) => (
                  <Chip
                    key={tag.id} size="small" label={`${tag.name} ${tag.note_count}`}
                    color={filterTag === tag.id ? 'primary' : 'default'}
                    variant={filterTag === tag.id ? 'filled' : 'outlined'}
                    onClick={() => { setFilterTag(filterTag === tag.id ? null : tag.id); setNotePage(1) }}
                    onDelete={() => void removeTag(tag)}
                  />
                ))}
                {!tags.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary', p: 0.5 }}>还没有标签</Typography> : null}
              </Box>
            </Popover>
          </Stack>
          <TextField
            fullWidth size="small" placeholder="搜索标题或正文" value={keyword}
            onChange={(event) => onSearchChange(event.target.value)}
            InputProps={{ startAdornment: <Search sx={{ fontSize: 17, mr: 0.5, color: 'text.secondary' }} /> }}
            sx={{ mb: 0.75, '& .MuiOutlinedInput-root': { fontSize: 12.5 } }}
          />
          <Button fullWidth size="small" variant="contained" startIcon={<Plus fontSize="small" />} disabled={missingFolder} onClick={createNote}>新建笔记</Button>
        </Box>
        <Box className="note-list" sx={{ flex: 1, overflow: 'auto' }}>
          {notes.map((item) => (
            <Box
              key={item.id}
              onClick={() => void openNote(item.id)}
              sx={{
                p: '6px 8px', borderBottom: 1, borderColor: 'divider', cursor: 'pointer',
                bgcolor: item.id === current?.id ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }} noWrap>{item.title}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>
                {item.excerpt || '空白笔记'}
              </Typography>
              <Stack direction="row" justifyContent="space-between" sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.5 }}>
                <span>{formatDate(item.updated_at)}</span>
                <span>{item.tags?.length ? item.tags.join(' · ') : ''}</span>
              </Stack>
            </Box>
          ))}
          {!notes.length && !loadingNotes ? <EmptyHint>{keyword ? '没有匹配的笔记' : '还没有笔记'}</EmptyHint> : null}
          {noteTotal > 50 ? (
            <Stack direction="row" justifyContent="center" sx={{ p: 1 }}>
              <Button size="small" disabled={notePage <= 1} onClick={() => setNotePage(notePage - 1)}>上一页</Button>
              <Typography sx={{ fontSize: 12, alignSelf: 'center', px: 1 }}>{notePage} / {Math.ceil(noteTotal / 50)}</Typography>
              <Button size="small" disabled={notePage >= Math.ceil(noteTotal / 50)} onClick={() => setNotePage(notePage + 1)}>下一页</Button>
            </Stack>
          ) : null}
        </Box>
      </Box>

      <Box className="editor-pane" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', minHeight: 0 }}>
        {current ? <Button size="small" onClick={() => setCurrent(null)} sx={{ display: { xs: 'inline-flex', md: 'none' }, alignSelf: 'flex-start', m: 0.75 }}>返回笔记列表</Button> : null}
        {current ? (
          <>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ p: '12px 12px 8px', borderBottom: 1, borderColor: 'divider' }}>
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ width: 140 }}>
                  <InputLabel shrink>文件夹</InputLabel>
                  <Select
                    label="文件夹" displayEmpty value={folderId ?? ''} onChange={(event) => setFolderId(event.target.value === '' ? null : Number(event.target.value))}
                  >
                    <MenuItem value="">未分类</MenuItem>
                    {folders.map((folder) => <MenuItem key={folder.id} value={folder.id}>{folder.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Autocomplete
                  multiple freeSolo size="small" options={tags.map((tag) => tag.name)}
                  value={tagNames} onChange={(_, value) => setTagNames(value)}
                  renderInput={(inputParams) => <TextField {...inputParams} label="标签" placeholder="添加标签" />}
                  sx={{ width: 260, maxWidth: '100%' }}
                />
              </Stack>
              <div className="spacer" />
              <Box className={`save-state ${saveState}`} role="status" aria-live="polite" sx={{ fontSize: 12, color: saveState === 'error' ? 'error.main' : saveState === 'saved' ? 'success.main' : 'text.secondary' }}>{saveLabel}</Box>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button size="small" startIcon={<Picture fontSize="small" />} onClick={() => imageInput.current?.click()}>插入图片</Button>
                <input ref={imageInput} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.target.value = '' }} />
                <Button size="small" disabled={exporting} onClick={(event) => setExportMenu(event.currentTarget)}>导出</Button>
                <Menu anchorEl={exportMenu} open={Boolean(exportMenu)} onClose={() => setExportMenu(null)}>
                  <MenuItem onClick={() => void doExport('html')}>HTML 网页</MenuItem>
                  <MenuItem onClick={() => void doExport('pdf')}>PDF 文档</MenuItem>
                  <MenuItem onClick={() => void doExport('png')}>PNG 图片</MenuItem>
                  <MenuItem onClick={() => void doExport('docx')}>Word 文档</MenuItem>
                </Menu>
                <Button size="small" startIcon={<Clock fontSize="small" />} onClick={() => void openRevisions()}>历史版本</Button>
                <Button size="small" startIcon={<View fontSize="small" />} onClick={cycleMode}>{modeLabel}</Button>
              </Stack>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
              <Button size="small" variant="contained" disabled={saving} onClick={() => void save('manual')}>保存</Button>
            </Stack>

            {conflict ? (
              <Alert severity="warning" sx={{ m: '8px 12px 0', fontSize: 12.5 }} action={
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" onClick={() => void reloadServer()}>换成最新的</Button>
                  <Button size="small" color="warning" onClick={() => void forceSave()}>按我写的保存</Button>
                </Stack>
              }>笔记已在别处更新，当前内容保留。</Alert>
            ) : null}

            <Box className="title-input" sx={{ px: 1.5, pt: 1.25, pb: 0.5 }}>
              <TextField
                fullWidth variant="standard" placeholder="未命名笔记" value={title} inputProps={{ maxLength: 200 }}
                onChange={(event) => setTitle(event.target.value)}
                InputProps={{ disableUnderline: true }}
                sx={{ '& input': { fontSize: 16, fontWeight: 600 } }}
              />
            </Box>

            <Box className="editor-body" sx={{ flex: 1, minHeight: 0, display: 'flex', bgcolor: 'divider', mt: 0.75 }}>
              {mode !== 'preview' ? (
                <Box className="editor-col" sx={{ height: '100%', boxSizing: 'border-box', bgcolor: 'background.paper', minHeight: 0, overflow: 'auto', p: '8px 12px', flex: mode === 'split' ? '0 0 50%' : 1 }}>
                  <MarkdownEditor value={content} onChange={setContent} onPaste={onPaste} />
                </Box>
              ) : null}
              {mode !== 'edit' ? (
                <Box className="preview-col markdown-body" sx={{ height: '100%', boxSizing: 'border-box', bgcolor: 'background.paper', minHeight: 0, overflow: 'auto', p: '8px 12px', flex: 1 }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : null}
            </Box>
          </>
        ) : <EmptyHint>选择左侧笔记开始编辑</EmptyHint>}
      </Box>

      <Drawer anchor="right" open={revisionsOpen} onClose={() => setRevisionsOpen(false)} slotProps={{ paper: { sx: { width: 'min(460px, 100vw)', p: 2.5 } } }}>
        <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 1.5 }}>历史版本</Typography>
        {revisions.length ? revisions.map((rev) => (
          <Box key={rev.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 13 }}><b>{rev.title}</b></Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{formatDate(rev.created_at)} · {reasonText(rev.reason)}</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>{rev.excerpt}</Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => void previewRevision(rev)}>查看</Button>
              <Button size="small" onClick={() => void restoreRevision(rev)}>恢复此版本</Button>
            </Stack>
          </Box>
        )) : <EmptyHint>还没有历史版本</EmptyHint>}
      </Drawer>

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{previewing?.title || '历史版本'}</DialogTitle>
        <DialogContent>
          <Box className="markdown-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(previewing?.content || '', { async: false }) as string) }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setPreviewOpen(false)}>关闭</Button>
          <Button size="small" variant="contained" onClick={() => previewing && void restoreRevision(previewing)}>恢复此版本</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
