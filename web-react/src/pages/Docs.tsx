import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, CircularProgress, Tab, Tabs, Typography } from '@mui/material'
import { ModuleToolbar, Page } from '@/ui/common'

const PdfEditor = lazy(() => import('@/docs/pdf/PdfEditor'))
const SheetEditor = lazy(() => import('@/docs/sheet/WorkbookEditor'))
const DocEditor = lazy(() => import('@/docs/doc/DocEditor'))

const TABS = [
  { key: 'pdf', label: 'PDF 编辑与处理' },
  { key: 'sheet', label: '工作簿' },
  { key: 'doc', label: 'Markdown 文档' },
] as const

type ModuleKey = typeof TABS[number]['key']

const loaders: Record<ModuleKey, () => Promise<unknown>> = {
  pdf: () => import('@/docs/pdf/PdfEditor'),
  sheet: () => import('@/docs/sheet/WorkbookEditor'),
  doc: () => import('@/docs/doc/DocEditor'),
}

function EditorFallback({ label }: { label: string }) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
      <CircularProgress size={22} />
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>正在加载{label}…</Typography>
    </Box>
  )
}

export default function DocsPage() {
  const [params, setParams] = useSearchParams()
  const requested = TABS.find((item) => item.key === params.get('module'))?.key || 'pdf'
  const [visited, setVisited] = useState<Set<ModuleKey>>(() => new Set([requested]))
  const module = requested
  useEffect(() => {
    setVisited((current) => {
      if (current.has(requested)) return current
      const next = new Set(current)
      next.add(requested)
      return next
    })
  }, [requested])
  const select = (value: ModuleKey) => {
    void loaders[value]()
    setVisited((current) => {
      if (current.has(value)) return current
      const next = new Set(current)
      next.add(value)
      return next
    })
    setParams(value === 'pdf' ? {} : { module: value }, { replace: true })
  }
  const panel = (key: ModuleKey, children: ReactNode) => {
    if (!visited.has(key)) return null
    const active = module === key
    return (
      <Box
        aria-hidden={!active}
        sx={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          visibility: active ? 'visible' : 'hidden',
          pointerEvents: active ? 'auto' : 'none',
        }}
      >
        <Suspense fallback={<EditorFallback label={TABS.find((item) => item.key === key)!.label} />}>
          {children}
        </Suspense>
      </Box>
    )
  }
  return (
    <Page variant="bleed" sx={{ minHeight: 0 }}>
      <ModuleToolbar
        sx={{ px: 2, py: 0.6, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
        info={(
          <Tabs
            value={module}
            onChange={(_, value: ModuleKey) => select(value)}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0, fontSize: 13 } }}
          >
            {TABS.map((item) => <Tab key={item.key} value={item.key} label={item.label} onMouseEnter={() => { void loaders[item.key]() }} onFocus={() => { void loaders[item.key]() }} />)}
          </Tabs>
        )}
      />
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {panel('pdf', <PdfEditor />)}
        {panel('sheet', <SheetEditor active={module === 'sheet'} />)}
        {panel('doc', <DocEditor />)}
      </Box>
    </Page>
  )
}
