import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography } from '@mui/material'
import { apiError, http } from '@/api/client'
import { toast } from '@/ui/feedback'

function requestId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function DeleteTableDialog({ open, table, onClose, onDeleted }: {
  open: boolean
  table: { id: number; name: string } | null
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

  useEffect(() => {
    if (open) { setDownloaded(false); setSaved(false); setError(''); setBusy(false); setDeleting(false); setProgress('') }
  }, [open])

  const backup = async () => {
    if (!table || busy) return
    setBusy(true); setDownloaded(false); setSaved(false); setError(''); setProgress('正在生成整表备份…')
    try {
      let { data: job } = await http.post(`/tables/${table.id}/export-tasks`, { scope: 'all' }, { headers: { 'Idempotency-Key': requestId() } })
      const deadline = Date.now() + 10 * 60 * 1000
      while (['queued', 'running'].includes(job.status)) {
        if (Date.now() > deadline) throw new Error('导出仍在后台进行，请到任务中心查看，完成后重新下载备份。尚未删除表格。')
        setProgress(`正在导出：${job.processed || 0} 行（${job.progress || 0}%）`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        job = (await http.get(`/tasks/${job.id}`)).data
      }
      if (job.status !== 'completed' || !job.result?.download_url) throw new Error(job.error || '导出未完成，表格未删除')
      const response = await http.get(job.result.download_url, { baseURL: '', responseType: 'blob' })
      if (!response.data.size) throw new Error('备份文件为空，请重新导出')
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = table.name.replace(/[\/:*?"<>|]/g, '_') + '-完整备份.xlsx'
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      setDownloaded(true); setProgress('')
      toast.success('备份已开始下载，请确认文件已保存后再删除')
    } catch (cause) {
      setError(cause instanceof Error && !('response' in (cause as any)) ? cause.message : apiError(cause).message)
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!table || !downloaded || !saved || busy || deleting) return
    setDeleting(true)
    try {
      await http.delete(`/tables/${table.id}`)
      window.dispatchEvent(new Event('wb:tables-changed'))
      onDeleted(); onClose(); toast.success('表格已移入回收站')
    } catch (error) { setError(apiError(error).message) }
    finally { setDeleting(false) }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>导出备份后删除表格</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13.5, mb: 1.5 }}>即将删除「{table?.name}」。建议先导出备份；删除后回收站保留 30 天。</Typography>
        <Alert severity="info" sx={{ fontSize: 12.5, mb: 2 }}>备份包含全表数据，不受筛选和分页影响。</Alert>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <Button size="small" variant={downloaded ? 'outlined' : 'contained'} disabled={busy || deleting} onClick={backup}>{downloaded ? '重新下载整表备份' : '导出并下载整表备份'}</Button>
          {busy ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{progress}</Typography> : null}
        </Stack>
        {error ? <Alert severity="error" sx={{ mb: 1.5, fontSize: 12.5 }}>{error}</Alert> : null}
        <FormControlLabel
          control={<Checkbox checked={saved} disabled={!downloaded || busy} onChange={(event) => setSaved(event.target.checked)} />}
          label="我已确认备份文件保存到电脑，可以删除表格"
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" disabled={busy || deleting} onClick={onClose}>取消</Button>
        <Button size="small" color="error" variant="contained" disabled={!downloaded || !saved || busy || deleting} onClick={remove}>确认删除</Button>
      </DialogActions>
    </Dialog>
  )
}
