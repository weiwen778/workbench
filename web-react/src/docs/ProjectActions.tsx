import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, List, ListItemButton, ListItemText, Stack, Tooltip, Typography,
} from '@mui/material'
import { Delete, FolderOpened, InfoFilled, Refresh, Upload } from '@/icons'
import { apiError } from '@/api/client'
import { confirmDialog, toast } from '@/ui/feedback'
import {
  createProject, deleteProject, getProject, listProjects, updateProject, uploadProjectFile,
  type ProjectAttachment, type ProjectDetail, type ProjectKind, type ProjectSummary,
} from '@/docs/api'

export interface ProjectSavePayload {
  state: Record<string, any>
  files?: File[]
  existingAttachmentIds?: number[]
  attachmentIds?: number[]
}

interface Props {
  kind: ProjectKind
  kindLabel: string
  title: string
  onTitleChange: (value: string) => void
  current: ProjectDetail | null
  onCurrentChange: (project: ProjectDetail | null) => void
  onSaved?: (project: ProjectDetail) => void
  buildSave: () => Promise<ProjectSavePayload>
  onOpen: (project: ProjectDetail) => void | Promise<void>
  saving?: boolean
  disabled?: boolean
  saveShortcut?: boolean
}

function when(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function ProjectActions({
  kind, kindLabel, title, onTitleChange, current, onCurrentChange, onSaved, buildSave, onOpen, saving, disabled, saveShortcut,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ProjectSummary[]>([])
  const [error, setError] = useState('')
  const operationSeq = useRef(0)
  const saveButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!saveShortcut) return
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) saveButton.current?.click()
    }
    window.addEventListener('keydown', handleSaveShortcut, true)
    return () => window.removeEventListener('keydown', handleSaveShortcut, true)
  }, [saveShortcut])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setItems(await listProjects(kind)) }
    catch (reason) { setError(apiError(reason).message) }
    finally { setLoading(false) }
  }, [kind])

  const openList = () => {
    if (busy || saving) return
    setOpen(true)
    void load()
  }

  const save = async () => {
    if (busy || saving || disabled) return
    const sequence = ++operationSeq.current
    setBusy(true)
    try {
      const payload = await buildSave()
      const uploads: ProjectAttachment[] = []
      for (const file of payload.files || []) uploads.push(await uploadProjectFile(file))
      const attachmentIds = [...new Set([...(payload.existingAttachmentIds || []), ...(payload.attachmentIds || []), ...uploads.map((file) => file.id)])]
      const name = title.trim() || '未命名项目'
      try {
        const saved = current
          ? await updateProject(current.id, { kind, title: name, state: payload.state, attachment_ids: attachmentIds, version: current.version })
          : await createProject({ kind, title: name, state: payload.state, attachment_ids: attachmentIds })
        if (sequence !== operationSeq.current) return
        onCurrentChange(saved)
        onTitleChange(saved.title)
        onSaved?.(saved)
        toast.success(current ? '项目已保存' : '项目已创建')
      } catch (reason: any) {
        if (sequence !== operationSeq.current) return
        if (reason?.response?.status === 409) {
          const createCopy = await confirmDialog({
            title: '项目已在其他标签页更新',
            message: '当前项目版本已过期。保留当前编辑并另存为新项目？',
            confirmText: '另存为新项目',
          })
          if (createCopy && sequence === operationSeq.current) {
            const saved = await createProject({ kind, title: `${name} 副本`, state: payload.state, attachment_ids: attachmentIds })
            if (sequence !== operationSeq.current) return
            onCurrentChange(saved); onTitleChange(saved.title)
            onSaved?.(saved)
            toast.success('已另存为新项目')
          }
        } else throw reason
      }
    } catch (reason) {
      toast.error(apiError(reason).message)
    } finally {
      setBusy(false)
    }
  }

  const openProject = async (summary: ProjectSummary) => {
    if (busy || saving) return
    const sequence = ++operationSeq.current
    setLoading(true); setError('')
    try {
      const detail = await getProject(summary.id)
      if (sequence !== operationSeq.current) return
      await onOpen(detail)
      if (sequence !== operationSeq.current) return
      onCurrentChange(detail)
      onTitleChange(detail.title)
      setOpen(false)
      toast.success(`已打开「${detail.title}」`)
    } catch (reason) { setError(apiError(reason).message) }
    finally { if (sequence === operationSeq.current) setLoading(false) }
  }

  const remove = async (summary: ProjectSummary) => {
    if (busy || saving) return
    const ok = await confirmDialog({ title: '删除项目', danger: true, confirmText: '删除', message: `删除「${summary.title}」？项目附件随后会按现有清理规则处理。` })
    if (!ok) return
    try {
      await deleteProject(summary.id)
      if (current?.id === summary.id) onCurrentChange(null)
      await load()
      toast.success('项目已删除')
    } catch (reason) { toast.error(apiError(reason).message) }
  }

  return (
    <>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
        <Button size="small" startIcon={<FolderOpened fontSize="small" />} disabled={busy || saving} onClick={openList}>项目</Button>
        <Button ref={saveButton} size="small" variant="outlined" startIcon={busy ? <CircularProgress size={13} /> : <Upload fontSize="small" />} disabled={busy || saving || disabled} onClick={() => void save()}>
          保存项目
        </Button>
        {current ? <Chip size="small" variant="outlined" label={current.title} sx={{ maxWidth: 180, height: 22, fontSize: 10.5 }} /> : null}
      </Stack>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{kindLabel}项目</DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>项目保存元数据、可恢复的编辑状态和必要附件；未保存的本地文件不会上传。</Typography>
            <Tooltip title="刷新列表"><IconButton size="small" aria-label="刷新项目列表" onClick={() => void load()} disabled={loading}><Refresh fontSize="small" /></IconButton></Tooltip>
          </Stack>
          {error ? <Typography sx={{ fontSize: 12, color: 'error.main', mb: 1 }}>{error}</Typography> : null}
          {loading ? <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}><CircularProgress size={16} /><Typography sx={{ fontSize: 12 }}>正在读取项目…</Typography></Stack> : (
            <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 320, overflow: 'auto' }}>
              {items.length === 0 ? <Typography sx={{ p: 2, fontSize: 12.5, color: 'text.secondary' }}>还没有保存的{kindLabel}项目</Typography> : items.map((item) => (
                <ListItemButton key={item.id} disabled={busy || saving} onClick={() => void openProject(item)}>
                  <ListItemText
                    primary={item.title}
                    secondary={`${when(item.updated_at)} · 版本 ${item.version} · ${item.attachments.length} 个附件`}
                    primaryTypographyProps={{ fontSize: 13, fontWeight: 600, noWrap: true }}
                    secondaryTypographyProps={{ fontSize: 11.5, noWrap: true }}
                  />
                  <IconButton size="small" disabled={busy || saving} aria-label={`删除项目 ${item.title}`} onClick={(event) => { event.stopPropagation(); void remove(item) }}><Delete fontSize="small" /></IconButton>
                </ListItemButton>
              ))}
            </List>
          )}
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1 }}>
            <InfoFilled sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>打开项目会替换当前未保存的编辑；需要保留时先保存当前项目或导出文件。</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button size="small" onClick={() => setOpen(false)}>关闭</Button></DialogActions>
      </Dialog>
    </>
  )
}
