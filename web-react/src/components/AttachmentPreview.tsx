import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack } from '@mui/material'
import { http } from '@/api/client'

export default function AttachmentPreview({ open, file, onClose }: { open: boolean; file: any | null; onClose: () => void }) {
  const isPdf = Boolean(file?.is_pdf || file?.name?.toLowerCase().endsWith('.pdf'))
  const url = `/api/v1/files/${file?.id}/content`
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<any>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const renderTask = useRef<any>(null)

  const renderPage = async (targetPage = page, targetScale = scale) => {
    const doc = pdfRef.current
    if (!doc || !canvas.current) return
    const current = ++sequence.current
    try {
      renderTask.current?.cancel?.()
      setLoading(true)
      const pdfPage = await doc.getPage(targetPage)
      if (current !== sequence.current || !canvas.current) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const view = pdfPage.getViewport({ scale: targetScale * ratio })
      canvas.current.width = Math.ceil(view.width)
      canvas.current.height = Math.ceil(view.height)
      canvas.current.style.width = `${view.width / ratio}px`
      canvas.current.style.height = `${view.height / ratio}px`
      renderTask.current = pdfPage.render({ canvas: canvas.current, canvasContext: canvas.current.getContext('2d')!, viewport: view })
      await renderTask.current.promise
    } catch (cause: any) {
      if (current === sequence.current && cause?.name !== 'RenderingCancelledException') setError('PDF 页面加载失败，请重试。')
    } finally { if (current === sequence.current) setLoading(false) }
  }

  useEffect(() => {
    if (!open || !isPdf || !file?.id) return
    const current = ++sequence.current
    setError(''); setPages(0); setPage(1)
    void (async () => {
      setLoading(true)
      try {
        const response = await http.get(`/files/${file.id}/content`, { responseType: 'arraybuffer' })
        if (current !== sequence.current) return
        const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        GlobalWorkerOptions.workerSrc = workerUrl
        const task = getDocument({
          data: new Uint8Array(response.data),
          cMapUrl: '/pdfjs/6.4.299/cmaps/', cMapPacked: true,
          standardFontDataUrl: '/pdfjs/6.4.299/standard_fonts/', wasmUrl: '/pdfjs/6.4.299/wasm/',
        })
        const doc = await task.promise
        if (current !== sequence.current) { void task.destroy(); return }
        pdfRef.current = doc; setPages(doc.numPages)
        window.setTimeout(() => {
          const width = viewport.current?.clientWidth || 800
          doc.getPage(1).then((first: any) => {
            const nextScale = Math.max(0.25, Math.min(3, (width - 24) / first.getViewport({ scale: 1 }).width))
            setScale(nextScale)
            void renderPage(1, nextScale)
          })
        }, 60)
      } catch { if (current === sequence.current) setError('PDF 无法读取，请重试或下载查看。') }
      finally { if (current === sequence.current) setLoading(false) }
    })()
    return () => { sequence.current++; renderTask.current?.cancel?.(); void pdfRef.current?.destroy?.(); pdfRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file?.id])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{file?.name || '附件预览'}</DialogTitle>
      <DialogContent>
        {isPdf ? (
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
              <Button size="small" disabled={!pdfRef.current || page <= 1} onClick={() => { const next = Math.max(1, page - 1); setPage(next); void renderPage(next, scale) }}>上一页</Button>
              <span style={{ fontSize: 13 }}>第 {page} / {pages} 页</span>
              <Button size="small" disabled={!pdfRef.current || page >= pages} onClick={() => { const next = Math.min(pages, page + 1); setPage(next); void renderPage(next, scale) }}>下一页</Button>
              <Button size="small" disabled={!pdfRef.current} onClick={() => { const next = Math.max(0.25, scale - 0.2); setScale(next); void renderPage(page, next) }}>缩小</Button>
              <Button size="small" disabled={!pdfRef.current} onClick={() => { const next = Math.min(3, scale + 0.2); setScale(next); void renderPage(page, next) }}>放大</Button>
              <Button size="small" disabled={!pdfRef.current} onClick={() => {
                pdfRef.current?.getPage(page).then((pdfPage: any) => {
                  const next = Math.max(0.25, Math.min(3, ((viewport.current?.clientWidth || 800) - 24) / pdfPage.getViewport({ scale: 1 }).width))
                  setScale(next); void renderPage(page, next)
                })
              }}>适合宽度</Button>
            </Stack>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Box ref={viewport} sx={{ height: 'min(48dvh, 600px)', minHeight: 200, overflow: 'auto', bgcolor: 'action.hover', p: 1.5 }}>
              {loading ? <Box sx={{ fontSize: 14, color: 'text.secondary' }}>加载中…</Box> : null}
              <canvas ref={canvas} aria-label="PDF 页面" style={{ display: 'block', margin: 'auto' }} />
            </Box>
          </Box>
        ) : file?.is_image ? (
          <Box component="img" src={url} alt={file?.name} sx={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
        ) : <p>此类型请下载后查看。</p>}
      </DialogContent>
      <DialogActions>
        <Link href={`/api/v1/files/${file?.id}/download`} target="_blank">下载文件</Link>
        <Button size="small" onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
