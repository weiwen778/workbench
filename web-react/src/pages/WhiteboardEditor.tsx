import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, Menu, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import { Excalidraw, convertToExcalidrawElements, exportToBlob, exportToClipboard, getNonDeletedElements, restore } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { ArrowLeft, Check, Download, MoreFilled } from '@/icons'
import { apiError } from '@/api/client'
import { useSession } from '@/session'
import { LoadingBlock, LoadingBar } from '@/ui/common'
import { confirmDialog, toast } from '@/ui/feedback'
import { downloadBlob } from '@/convert/files'
import {
  blobToDataURL, createWhiteboard, dataURLToBlob, deleteWhiteboard, getWhiteboard, getWhiteboardAsset,
  renameWhiteboard, saveWhiteboard, uploadWhiteboardAsset, type WhiteboardDetail,
} from '@/whiteboard/api'
import { deleteDraft, draftKey, loadDraft, saveDraft, type DraftFile } from '@/whiteboard/db'
import { takeInsert, discardInsert, type InsertItem } from '@/whiteboard/insert'
import {
  appStateForSave, elementHash, filesRecord, insertFileId, isOnline, referencedFileIds, safeFileStem, serializeFiles, styleHash,
} from '@/whiteboard/scene'

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'pending' | 'conflict'

const AUTO_SAVE_DELAY = 2000
const DRAFT_DELAY = 500

const STATUS: Record<SaveStatus, { label: string; color: 'success' | 'warning' | 'info' | 'error' }> = {
  saved: { label: '已保存', color: 'success' },
  dirty: { label: '有未保存更改', color: 'warning' },
  saving: { label: '保存中', color: 'info' },
  pending: { label: '待同步', color: 'warning' },
  conflict: { label: '版本冲突', color: 'error' },
}

export default function WhiteboardEditorPage() {
  const { boardId } = useParams()
  const navigate = useNavigate()
  const session = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const id = Number(boardId)
  const userId = session.user?.id || 0

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [title, setTitle] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState(false)
  const [conflictVersion, setConflictVersion] = useState<number | null>(null)
  const [draftWarning, setDraftWarning] = useState('')
  const [initial, setInitial] = useState<any>(null)
  const [instanceKey, setInstanceKey] = useState(0)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const elementsRef = useRef<readonly ExcalidrawElement[]>([])
  const appStateRef = useRef<Record<string, unknown>>({})
  const filesRef = useRef<BinaryFiles>({})
  const hashRef = useRef('')
  const changeSeq = useRef(0)
  const dirty = useRef(false)
  const saving = useRef(false)
  const pendingSave = useRef(false)
  const baseVersion = useRef(1)
  const uploaded = useRef<Set<string>>(new Set())
  const autoTimer = useRef<number | null>(null)
  const draftTimer = useRef<number | null>(null)
  const firstChange = useRef(true)
  const restoredDirty = useRef(false)
  const conflictRef = useRef(false)
  const mounted = useRef(true)
  const loadSeq = useRef(0)
  const draftWarned = useRef(false)
  const retryDelay = useRef(2000)
  const insertToken = useRef<string | null>(searchParams.get('insert'))

  if (searchParams.get('insert')) insertToken.current = searchParams.get('insert')

  const setStatusSafe = useCallback((next: SaveStatus) => {
    if (!mounted.current) return
    setStatus(next)
  }, [])

  const writeDraftNow = useCallback(async (): Promise<boolean> => {
    if (!userId || !Number.isFinite(id) || id <= 0) return false
    const result = await saveDraft({
      key: draftKey(userId, id),
      userId,
      boardId: id,
      elements: [...elementsRef.current],
      appState: appStateForSave(appStateRef.current),
      files: serializeFiles(filesRef.current),
      baseVersion: baseVersion.current,
      dirty: dirty.current,
      updatedAt: Date.now(),
    })
    if (result.ok) {
      if (draftWarned.current) { draftWarned.current = false; setDraftWarning('') }
      return true
    }
    setDraftWarning(`${result.message}。当前编辑仍保留在内存中，请及时保存或导出。`)
    if (!draftWarned.current) {
      draftWarned.current = true
      toast.warning(result.message)
    }
    return false
  }, [id, userId])

  const scheduleDraftWrite = useCallback(() => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null
      void writeDraftNow()
    }, DRAFT_DELAY)
  }, [writeDraftNow])

  const clearAutoTimer = useCallback(() => {
    if (autoTimer.current) { window.clearTimeout(autoTimer.current); autoTimer.current = null }
  }, [])

  const saveRef = useRef<(manual?: boolean) => Promise<void>>(async () => {})

  const scheduleAutoSave = useCallback((delay = AUTO_SAVE_DELAY) => {
    clearAutoTimer()
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = null
      const cursor = (appStateRef.current as { cursorButton?: string }).cursorButton
      if (cursor === 'down') { scheduleAutoSave(800); return }
      void saveRef.current(false)
    }, delay)
  }, [clearAutoTimer])

  const ensureAssets = useCallback(async (elements: readonly unknown[], files: BinaryFiles) => {
    const ids = referencedFileIds(elements)
    for (const fileId of ids) {
      if (uploaded.current.has(fileId)) continue
      const file = files[fileId]
      if (!file?.dataURL) throw new Error(`图片 ${fileId} 尚未准备好，请稍后重试`)
      await uploadWhiteboardAsset(fileId, dataURLToBlob(file.dataURL), file.mimeType || 'image/png')
      uploaded.current.add(fileId)
    }
  }, [])

  const saveNow = useCallback(async (manual = false) => {
    if (saving.current) {
      pendingSave.current = true
      if (manual) toast.info('正在保存，完成后会继续保存最新修改')
      return
    }
    if (conflictRef.current) {
      if (manual) toast.warning('存在版本冲突，请先另存为副本或载入服务器版本')
      return
    }
    if (!dirty.current) {
      if (manual) toast.info('没有需要保存的更改')
      return
    }
    const seq = changeSeq.current
    const elements = [...elementsRef.current]
    const appState = appStateForSave(appStateRef.current)
    const files = filesRef.current
    saving.current = true
    setStatusSafe('saving')
    try {
      await ensureAssets(elements, files)
      const saved = await saveWhiteboard(id, { elements, app_state: appState, version: baseVersion.current })
      baseVersion.current = saved.version
      retryDelay.current = 2000
      const stillCurrent = seq === changeSeq.current
      if (stillCurrent) {
        dirty.current = false
        setStatusSafe('saved')
        void writeDraftNow()
      } else {
        setStatusSafe(isOnline() ? 'dirty' : 'pending')
        scheduleAutoSave()
      }
      if (manual) toast.success(stillCurrent ? '白板已保存' : '已保存当前快照，仍有新的更改待保存')
    } catch (reason) {
      const error = apiError(reason)
      if (error.code === 'VERSION_CONFLICT') {
        conflictRef.current = true
        setConflict(true)
        setConflictVersion(Number(error.details?.current_version) || null)
        setStatusSafe('conflict')
        toast.warning('白板已在其他标签页更新，本地修改已保留，请另存为副本')
      } else {
        const retryable = error.code === 'NETWORK' || error.code === 'TIMEOUT'
          || Number((reason as { response?: { status?: number } } | null)?.response?.status || 0) >= 500
        setStatusSafe(retryable ? 'pending' : 'dirty')
        if (retryable && isOnline()) {
          scheduleAutoSave(retryDelay.current)
          retryDelay.current = Math.min(30000, retryDelay.current * 2)
        }
        toast.error(`${error.message}。草稿已保留，可重试保存`)
      }
    } finally {
      saving.current = false
      if (pendingSave.current) {
        pendingSave.current = false
        window.setTimeout(() => { void saveRef.current(false) }, 120)
      }
    }
  }, [ensureAssets, id, scheduleAutoSave, setStatusSafe, writeDraftNow])

  saveRef.current = saveNow

  const fetchAsset = async (fileId: string): Promise<DraftFile> => {
    const blob = await getWhiteboardAsset(fileId)
    return { id: fileId, dataURL: await blobToDataURL(blob), mimeType: blob.type || 'image/png', created: Date.now() }
  }

  const loadBoard = useCallback(async (opts: { ignoreDraft?: boolean } = {}) => {
    if (!Number.isFinite(id) || id <= 0) { setLoadError('白板地址不正确'); setLoading(false); return }
    const sequence = ++loadSeq.current
    setLoading(true)
    setLoadError('')
    try {
      const detail: WhiteboardDetail = await getWhiteboard(id)
      if (sequence !== loadSeq.current || !mounted.current) return
      const draft = !opts.ignoreDraft && userId ? await loadDraft(userId, id) : null
      if (sequence !== loadSeq.current || !mounted.current) return
      const useDraft = Boolean(draft && draft.dirty)
      const sceneElements = useDraft ? draft!.elements as readonly ExcalidrawElement[] : (detail.scene.elements || []) as readonly ExcalidrawElement[]
      const sceneAppState = useDraft ? draft!.appState : detail.scene.appState || {}
      const draftFiles = useDraft ? draft!.files : []
      const localIds = new Set(draftFiles.map((file) => file.id))
      const missing = referencedFileIds(sceneElements).filter((fileId) => !localIds.has(fileId))
      const results = await Promise.allSettled(missing.map((fileId) => fetchAsset(fileId)))
      if (sequence !== loadSeq.current || !mounted.current) return
      const serverFiles: DraftFile[] = []
      const missingIds = new Set<string>()
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') serverFiles.push(result.value)
        else missingIds.add(missing[index])
      })
      const allFiles = [...draftFiles, ...serverFiles]
      const usableElements = sceneElements.filter((element) => {
        const item = element as { type?: string; fileId?: string }
        return item.type !== 'image' || !item.fileId || !missingIds.has(item.fileId)
      })
      const restored = restore({
        elements: usableElements,
        appState: sceneAppState as any,
        files: filesRecord(allFiles),
      }, null, null)

      const draftConflict = useDraft && draft!.baseVersion !== detail.version
      elementsRef.current = restored.elements
      appStateRef.current = restored.appState as unknown as Record<string, unknown>
      filesRef.current = filesRecord(allFiles)
      hashRef.current = elementHash(restored.elements) + '|' + styleHash(restored.appState)
      dirty.current = useDraft
      baseVersion.current = useDraft ? draft!.baseVersion : detail.version
      conflictRef.current = draftConflict
      restoredDirty.current = useDraft
      uploaded.current = new Set(serverFiles.map((file) => file.id))
      firstChange.current = true
      changeSeq.current = 0

      setTitle(detail.title)
      setTitleDraft(detail.title)
      setConflict(draftConflict)
      setConflictVersion(draftConflict ? detail.version : null)
      setInitial({
        elements: restored.elements,
        appState: restored.appState,
        files: filesRecord(allFiles),
        scrollToContent: !useDraft,
      })
      setInstanceKey((value) => value + 1)
      setStatus(draftConflict ? 'conflict' : useDraft ? (isOnline() ? 'dirty' : 'pending') : 'saved')
      if (missingIds.size) toast.warning(`${missingIds.size} 张白板图片无法恢复，已从当前场景移除；其他内容可继续保存`)
    } catch (reason) {
      if (sequence !== loadSeq.current || !mounted.current) return
      setLoadError(apiError(reason).message)
    } finally {
      if (sequence === loadSeq.current) setLoading(false)
    }
  }, [id, userId])

  useEffect(() => {
    mounted.current = true
    void loadBoard()
    return () => {
      mounted.current = false
      loadSeq.current += 1
      clearAutoTimer()
      if (draftTimer.current) { window.clearTimeout(draftTimer.current); draftTimer.current = null }
      void writeDraftNow()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId])

  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') void writeDraftNow() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [writeDraftNow])

  useEffect(() => {
    const onOnline = () => {
      if (!dirty.current) return
      if (conflictRef.current) setStatusSafe('conflict')
      else { setStatusSafe('dirty'); scheduleAutoSave(200) }
    }
    const onOffline = () => { if (dirty.current && !conflictRef.current) setStatusSafe('pending') }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [scheduleAutoSave, setStatusSafe])

  const markChanged = useCallback(() => {
    changeSeq.current += 1
    dirty.current = true
    if (!conflictRef.current) setStatusSafe(isOnline() ? 'dirty' : 'pending')
    scheduleAutoSave()
    scheduleDraftWrite()
  }, [scheduleAutoSave, scheduleDraftWrite, setStatusSafe])

  const applyInsert = useCallback((api: ExcalidrawImperativeAPI) => {
    const token = insertToken.current
    if (!token) return
    const items: InsertItem[] | null = takeInsert(token)
    insertToken.current = null
    setSearchParams({}, { replace: true })
    if (!items?.length) return
    try {
      const appState = api.getAppState()
      const zoom = appState.zoom?.value || 1
      const viewCenterX = appState.width / 2 / zoom - appState.scrollX
      const viewCenterY = appState.height / 2 / zoom - appState.scrollY
      const existing = api.getSceneElementsIncludingDeleted().filter((element) => !element.isDeleted)
      let anchorX = viewCenterX
      let anchorY = viewCenterY
      if (existing.length) {
        anchorX = (Math.min(...existing.map((element) => element.x)) + Math.max(...existing.map((element) => element.x + element.width))) / 2
        anchorY = Math.max(...existing.map((element) => element.y + element.height)) + 80
      }
      const files: BinaryFiles = {}
      const skeletons: any[] = []
      let estimatedHeight = 0
      for (const item of items) {
        if (item.kind === 'text') {
          const text = item.title ? `${item.title}\n\n${item.text}` : item.text
          if (!text.trim()) continue
          skeletons.push({
            type: 'text', text, x: anchorX - 220, y: anchorY,
            fontSize: 20, strokeColor: item.color || '#1e2426', textAlign: 'left',
          })
          estimatedHeight += 120
        } else {
          const maxWidth = 440
          const scale = Math.min(1, maxWidth / Math.max(1, item.width))
          const width = Math.max(24, Math.round(item.width * scale))
          const height = Math.max(24, Math.round(item.height * scale))
          const fileId = item.id || insertFileId()
          files[fileId] = {
            id: fileId, dataURL: item.dataURL, mimeType: item.mimeType || 'image/png',
            created: Date.now(), lastRetrieved: Date.now(),
          } as BinaryFiles[string]
          skeletons.push({ type: 'image', fileId, x: anchorX - width / 2, y: anchorY, width, height })
          estimatedHeight += height + 24
        }
      }
      if (!skeletons.length) return
      const created = convertToExcalidrawElements(skeletons, { regenerateIds: true }) as Array<ExcalidrawElement & { x: number; y: number; width: number; height: number }>
      let offset = existing.length ? 0 : -estimatedHeight / 2
      for (const element of created) {
        element.y = anchorY + offset
        element.x = anchorX - element.width / 2
        offset += element.height + 24
      }
      api.addFiles(Object.values(files))
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...created] })
      api.scrollToContent(created, { fitToContent: false, animate: true })
      markChanged()
      toast.success(`已插入 ${items.length} 项内容，保存后写入白板`)
    } catch (reason) {
      discardInsert(token)
      toast.error(reason instanceof Error ? reason.message : '插入内容失败')
    }
  }, [markChanged, setSearchParams])

  const onApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
    window.setTimeout(() => {
      if (!mounted.current) return
      applyInsert(api)
      if (restoredDirty.current && !conflictRef.current && isOnline()) scheduleAutoSave(1500)
      restoredDirty.current = false
    }, 80)
  }, [applyInsert, scheduleAutoSave])

  const onChange = useCallback((elements: readonly ExcalidrawElement[], appState: any, files: BinaryFiles) => {
    elementsRef.current = elements
    appStateRef.current = appState
    filesRef.current = files
    const nextHash = elementHash(elements) + '|' + styleHash(appState)
    if (firstChange.current) {
      firstChange.current = false
      hashRef.current = nextHash
      scheduleDraftWrite()
      return
    }
    if (nextHash !== hashRef.current) {
      hashRef.current = nextHash
      changeSeq.current += 1
      dirty.current = true
      if (!conflictRef.current) setStatusSafe(isOnline() ? 'dirty' : 'pending')
      scheduleAutoSave()
    }
    scheduleDraftWrite()
  }, [scheduleAutoSave, scheduleDraftWrite, setStatusSafe])

  const commitTitle = async () => {
    const next = titleDraft.trim()
    if (!next || next === title) { setTitleDraft(title); return }
    try {
      const updated = await renameWhiteboard(id, next)
      setTitle(updated.title)
      setTitleDraft(updated.title)
      toast.success('白板名称已更新')
    } catch (reason) {
      setTitleDraft(title)
      toast.error(apiError(reason).message)
    }
  }

  const goBack = async () => {
    if (draftTimer.current) { window.clearTimeout(draftTimer.current); draftTimer.current = null }
    await writeDraftNow()
    if (dirty.current && !conflictRef.current && isOnline()) {
      clearAutoTimer()
      await saveNow(false)
    }
    navigate('/whiteboards')
  }

  const exportBoard = async () => {
    setMenuAnchor(null)
    const api = apiRef.current
    if (!api) return
    const elements = getNonDeletedElements(api.getSceneElements())
    if (!elements.length) { toast.warning('白板还没有内容，无法导出'); return }
    try {
      const appState = api.getAppState()
      const blob = await exportToBlob({
        elements,
        appState: { ...appState, exportBackground: true, viewBackgroundColor: appState.viewBackgroundColor || '#ffffff' },
        files: filesRef.current,
        mimeType: 'image/png',
        exportPadding: 24,
      })
      downloadBlob(blob, `${safeFileStem(title)}.png`)
      toast.success('已导出整板 PNG')
    } catch (reason) {
      toast.error(reason instanceof Error ? `导出失败：${reason.message}` : '导出失败，请重试')
    }
  }

  const copySelection = async () => {
    setMenuAnchor(null)
    const api = apiRef.current
    if (!api) return
    const appState = api.getAppState()
    const selectedIds = appState.selectedElementIds || {}
    const all = getNonDeletedElements(api.getSceneElements())
    if (!all.length) { toast.warning('白板还没有内容，无法复制'); return }
    const selected = all.filter((element) => selectedIds[element.id])
    if (!selected.length) { toast.warning('请先选择要复制为图片的对象'); return }
    try {
      await exportToClipboard({
        elements: selected,
        appState: { ...appState, exportBackground: true, viewBackgroundColor: appState.viewBackgroundColor || '#ffffff' },
        files: filesRef.current,
        type: 'png',
        mimeType: 'image/png',
        exportPadding: 16,
      })
      toast.success(`已将 ${selected.length} 个对象复制为图片`)
    } catch {
      try {
        const blob = await exportToBlob({
          elements: selected,
          appState: { ...appState, exportBackground: true, viewBackgroundColor: appState.viewBackgroundColor || '#ffffff' },
          files: filesRef.current,
          mimeType: 'image/png',
          exportPadding: 16,
        })
        downloadBlob(blob, `${safeFileStem(title)}-选区.png`)
        toast.info('浏览器不允许写入剪贴板，已下载选区 PNG')
      } catch (reason) {
        toast.error(reason instanceof Error ? `导出选区失败：${reason.message}` : '导出选区失败，请重试')
      }
    }
  }

  const saveAsCopy = async () => {
    if (busy) return
    setBusy(true)
    try {
      await ensureAssets(elementsRef.current, filesRef.current)
      const created = await createWhiteboard(`${title} 本地副本`.slice(0, 120))
      try {
        await saveWhiteboard(created.id, {
          elements: [...elementsRef.current],
          app_state: appStateForSave(appStateRef.current),
          version: created.version,
        })
      } catch (reason) {
        await deleteWhiteboard(created.id).catch(() => undefined)
        throw reason
      }
      if (userId) await deleteDraft(userId, id)
      dirty.current = false
      conflictRef.current = false
      toast.success(`本地修改已另存为「${created.title}」`)
      navigate(`/whiteboards/${created.id}`, { replace: true })
    } catch (reason) {
      toast.error(apiError(reason).message)
    } finally {
      setBusy(false)
    }
  }

  const useServerVersion = async () => {
    const ok = await confirmDialog({
      title: '载入服务器版本',
      message: '将丢弃当前设备上这份白板的未保存草稿并重新载入服务器内容。若想保留本地修改，请先选择「另存为副本」。',
      confirmText: '载入服务器版本',
      danger: true,
    })
    if (!ok) return
    if (userId) await deleteDraft(userId, id)
    dirty.current = false
    conflictRef.current = false
    setConflict(false)
    setConflictVersion(null)
    await loadBoard({ ignoreDraft: true })
  }

  const statusMeta = STATUS[status]

  if (loadError) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 3 }}>
        <Typography sx={{ fontSize: 14, color: 'error.main' }}>{loadError}</Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => navigate('/whiteboards')}>返回白板列表</Button>
          <Button size="small" variant="contained" onClick={() => void loadBoard()}>重试</Button>
        </Stack>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap
        sx={{ px: 1.25, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}
      >
        <Tooltip title="返回白板列表">
          <IconButton size="small" aria-label="返回白板列表" onClick={() => void goBack()}><ArrowLeft fontSize="small" /></IconButton>
        </Tooltip>
        <TextField
          size="small" value={titleDraft} aria-label="白板标题"
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur() } }}
          inputProps={{ maxLength: 120 }}
          sx={{ width: { xs: 150, sm: 260 }, '& .MuiInputBase-input': { fontSize: 14, fontWeight: 600, py: 0.5 } }}
        />
        <Chip size="small" variant="outlined" color={statusMeta.color} label={statusMeta.label} sx={{ fontSize: 11.5 }} />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small" variant="contained" startIcon={<SaveIcon fontSize="small" />}
          disabled={saving.current || conflict}
          onClick={() => void saveNow(true)}
        >
          保存
        </Button>
        <Button
          size="small" variant="outlined" startIcon={<Download fontSize="small" />} endIcon={<MoreFilled fontSize="small" />}
          aria-label="导出白板" onClick={(event) => setMenuAnchor(event.currentTarget)}
        >
          导出
        </Button>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <MenuItem onClick={() => void copySelection()}>复制选区为图片</MenuItem>
          <MenuItem onClick={() => void exportBoard()}>导出整板 PNG</MenuItem>
        </Menu>
      </Stack>
      <LoadingBar active={status === 'saving'} />

      {conflict ? (
        <Alert
          severity="error" variant="outlined"
          sx={{ mx: 1.25, mt: 0.75, py: 0.25, alignItems: 'center', flexShrink: 0 }}
          action={(
            <Stack direction="row" spacing={0.75}>
              <Button color="inherit" size="small" disabled={busy} onClick={() => void saveAsCopy()}>另存为副本</Button>
              <Button color="inherit" size="small" disabled={busy} onClick={() => void useServerVersion()}>载入服务器版本</Button>
            </Stack>
          )}
        >
          <Typography sx={{ fontSize: 12 }}>
            白板已在其他标签页或设备上更新（服务器版本 {conflictVersion ?? '未知'}）。本地修改已保留且不会自动覆盖服务器内容。
          </Typography>
        </Alert>
      ) : null}

      {draftWarning ? (
        <Alert severity="warning" variant="outlined" onClose={() => setDraftWarning('')} sx={{ mx: 1.25, mt: 0.75, py: 0.25, flexShrink: 0 }}>
          <Typography sx={{ fontSize: 12 }}>{draftWarning}</Typography>
        </Alert>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', bgcolor: 'background.default' }}>
        {loading ? (
          <LoadingBlock text="正在打开白板…" />
        ) : initial ? (
          <Excalidraw
            key={instanceKey}
            excalidrawAPI={onApi}
            initialData={initial}
            onChange={onChange}
            theme={session.theme}
            langCode="zh-CN"
            name={title}
          />
        ) : (
          <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={20} />
          </Stack>
        )}
      </Box>
      {status === 'saved' && !loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.35, borderTop: 1, borderColor: 'divider', color: 'text.secondary', flexShrink: 0 }}>
          <Check sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: 11 }}>所有更改已保存到本地服务</Typography>
        </Box>
      ) : null}
    </Box>
  )
}
