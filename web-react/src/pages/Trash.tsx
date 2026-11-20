import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { apiError, http } from '@/api/client'
import { ModuleToolbar, DataTable, EmptyHint, Page, PageBody } from '@/ui/common'
import { confirmDialog, toast } from '@/ui/feedback'

export default function TrashView({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<any[]>([])
  const [kind, setKind] = useState('')
  const [loading, setLoading] = useState(false)

  const formatTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = {}
      if (kind) params.kind = kind
      setItems((await http.get('/trash', { params })).data.items)
    } catch (error) { toast.error(apiError(error).message) }
    finally { setLoading(false) }
  }, [kind])

  useEffect(() => { void load() }, [load])

  const restore = async (row: any) => {
    try {
      const { data } = await http.post(`/trash/${row.kind}/${row.entity_id}/restore`)
      toast.success(data.message || '已恢复')
      await load()
      window.dispatchEvent(new Event('wb:tables-changed'))
      if (row.kind === 'todo' || row.kind === 'todo_list') window.dispatchEvent(new Event('wb:todos-changed'))
      if (row.kind === 'memo') window.dispatchEvent(new Event('wb:memos-changed'))
    } catch (error: any) {
      const body = error?.response?.data
      if (body?.code === 'NAME_CONFLICT') toast.error('已经有同名表格，请先给现有表格改名再恢复')
      else if (body?.code === 'PARENT_TABLE_DELETED') toast.error('它所属的表格还没恢复，请先恢复表格')
      else toast.error(apiError(error).message)
    }
  }

  const purge = async (row: any) => {
    const ok = await confirmDialog({ title: '彻底删除', danger: true, confirmText: '彻底删除', message: `彻底删除「${row.name}」？删了就找不回来；附件如果没别的地方在用，也会一起清掉。` })
    if (!ok) return
    try { await http.delete(`/trash/${row.kind}/${row.entity_id}`); toast.success('已彻底删除'); await load() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const purgeExpired = async () => {
    try {
      const { data } = await http.post('/trash/purge-expired')
      toast.success(`已清理 ${data.purged} 条到期内容`); await load()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const content = (
    <>
      <ModuleToolbar
        info={<Typography sx={{ fontSize: 12, color: 'text.secondary' }}>删除后保留 30 天，到期不可恢复</Typography>}
        filters={(
          <ToggleButtonGroup size="small" exclusive value={kind} onChange={(_, value) => value !== null && setKind(value)} sx={{ flexWrap: 'wrap' }}>
            <ToggleButton value="">全部</ToggleButton>
            <ToggleButton value="table">表格</ToggleButton>
            <ToggleButton value="record">表格行</ToggleButton>
            <ToggleButton value="note">笔记</ToggleButton>
            <ToggleButton value="memo">便利贴</ToggleButton>
            <ToggleButton value="todo">待办</ToggleButton>
            <ToggleButton value="todo_list">待办清单</ToggleButton>
          </ToggleButtonGroup>
        )}
        onRefresh={() => void load()}
        refreshLabel="刷新回收站"
        refreshDisabled={loading}
        primary={<Button size="small" color="error" variant="contained" onClick={purgeExpired}>清理已到期</Button>}
      />
      <PageBody>
        <DataTable
          rows={items}
          loading={loading}
          maxHeight={560}
          columns={[
            { key: 'kind_label', label: '类型', width: 100 },
            { key: 'name', label: '名称或摘要', width: 240, ellipsis: true },
            { key: 'deleted_at', label: '删除时间', width: 160, render: (row) => formatTime(row.deleted_at) },
            { key: 'remaining_days', label: '剩余', width: 90, render: (row) => <Box component="span" sx={{ color: row.remaining_days <= 3 ? 'error.main' : 'inherit' }}>{row.remaining_days} 天</Box> },
            {
              key: 'actions', label: '操作', width: 170,
              render: (row) => (
                <Stack direction="row" spacing={0.25}>
                  <Button size="small" onClick={() => void restore(row)}>恢复</Button>
                  <Button size="small" onClick={() => void purge(row)}>彻底删除</Button>
                </Stack>
              ),
            },
          ]}
        />
        {!items.length && !loading ? <EmptyHint>回收站为空。内容删除后保留 30 天。</EmptyHint> : null}
      </PageBody>
    </>
  )

  return embedded ? <Box>{content}</Box> : <Page>{content}</Page>
}
