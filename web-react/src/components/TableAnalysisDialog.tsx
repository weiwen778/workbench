import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material'
import { apiError, http } from '@/api/client'
import { DataTable } from '@/ui/common'
import { aggregate, display, type Field, type Row } from '@/table-core'

export default function TableAnalysisDialog({ open, tableId, onClose }: { open: boolean; tableId: number; onClose: () => void }) {
  const [source, setSource] = useState<any>(null)
  const [failure, setFailure] = useState('')
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<'summary' | 'pivot'>('summary')
  const [group, setGroup] = useState('')
  const [column, setColumn] = useState('')
  const [value, setValue] = useState('')
  const [operation, setOperation] = useState('count')
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!open) return
    setLoading(true); setFailure(''); setSource(null)
    void http.get(`/tables/${tableId}/workspace`).then(({ data }) => {
      setSource(data)
      const fields: Field[] = data.fields
      const firstDimension = fields.find((field) => ['short_text', 'select', 'checkbox', 'date'].includes(field.type))
      const firstNumber = fields.find((field) => ['number', 'formula', 'rollup'].includes(field.type))
      setGroup(firstDimension?.key || fields[0]?.key || '')
      setColumn('')
      setValue(firstNumber?.key || '')
      setOperation(firstNumber ? 'sum' : 'count')
    }).catch((error) => setFailure(apiError(error).message)).finally(() => setLoading(false))
  }, [open, tableId])

  const fields: Field[] = source?.fields || []
  const references = source?.references || {}
  const rows: Row[] = source?.records || []

  const result = useMemo(() => {
    if (!source || !group) return { headers: [] as string[], data: [] as any[], detail: [] as Row[] }
    const groupField = fields.find((field) => field.key === group)
    const columnField = fields.find((field) => field.key === column)
    const label = (row: Row, field?: Field) => field ? display(field, row.data[field.key], references) || '（空）' : '全部'
    const groupKeys = Array.from(new Set(rows.map((row) => label(row, groupField))))
    if (kind === 'summary') {
      const data = groupKeys.map((key) => {
        const subset = rows.filter((row) => label(row, groupField) === key)
        return { key, value: aggregate(subset, value, operation), count: subset.length }
      })
      return { headers: ['分组', '结果', '行数'], data, detail: rows }
    }
    const columnKeys = columnField ? Array.from(new Set(rows.map((row) => label(row, columnField)))) : ['合计']
    const data = groupKeys.map((key) => {
      const resultRow: Record<string, any> = { key }
      for (const columnKey of columnKeys) {
        const subset = rows.filter((row) => label(row, groupField) === key && (!columnField || label(row, columnField) === columnKey))
        resultRow[columnKey] = aggregate(subset, value, operation)
      }
      return resultRow
    })
    return { headers: ['分组', ...columnKeys], data, detail: rows }
  }, [source, group, column, value, operation, kind, fields, rows, references])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>汇总与透视</DialogTitle>
      <DialogContent>
        {failure ? <Alert severity="error">{failure}</Alert> : null}
        {loading ? <Typography sx={{ py: 3, fontSize: 13, color: 'text.secondary' }}>正在读取整张表…</Typography> : null}
        {source ? (
          <>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>全表 {rows.length} 行。</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel shrink>分析方式</InputLabel>
                <Select label="分析方式" value={kind} onChange={(event) => setKind(event.target.value as any)}>
                  <MenuItem value="summary">分组汇总</MenuItem>
                  <MenuItem value="pivot">交叉透视</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel shrink>分组列</InputLabel>
                <Select label="分组列" displayEmpty value={group} onChange={(event) => setGroup(event.target.value)}>
                  <MenuItem value="" disabled>分组列</MenuItem>
                  {fields.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
                </Select>
              </FormControl>
              {kind === 'pivot' ? (
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel shrink>交叉列</InputLabel>
                  <Select label="交叉列" displayEmpty value={column} onChange={(event) => setColumn(event.target.value)}>
                    <MenuItem value="">不设列</MenuItem>
                    {fields.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
                  </Select>
                </FormControl>
              ) : null}
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel shrink>计算方式</InputLabel>
                <Select label="计算方式" value={operation} onChange={(event) => setOperation(event.target.value)}>
                  <MenuItem value="count">计数</MenuItem>
                  <MenuItem value="sum">合计</MenuItem>
                  <MenuItem value="avg">平均值</MenuItem>
                  <MenuItem value="min">最小值</MenuItem>
                  <MenuItem value="max">最大值</MenuItem>
                </Select>
              </FormControl>
              {operation !== 'count' ? (
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel shrink>数值列</InputLabel>
                  <Select label="数值列" displayEmpty value={value} onChange={(event) => setValue(event.target.value)}>
                    <MenuItem value="" disabled>数值列</MenuItem>
                    {fields.filter((field) => ['number', 'formula', 'rollup'].includes(field.type)).map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
                  </Select>
                </FormControl>
              ) : null}
            </Stack>
            <DataTable
              rows={result.data}
              rowKey={(row) => row.key}
              maxHeight={260}
              columns={kind === 'summary' ? [
                { key: 'key', label: '分组', width: 200, ellipsis: true },
                { key: 'value', label: '结果', width: 160, align: 'right' },
                { key: 'count', label: '行数', width: 100, align: 'right' },
              ] : [
                { key: 'key', label: '分组', width: 200, ellipsis: true },
                ...result.headers.slice(1).map((header) => ({ key: header, label: header, align: 'right' as const, render: (row: any) => row[header] })),
              ]}
            />
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5, mb: 0.75 }}>明细 · {result.detail.length} 行</Typography>
            <DataTable
              rows={result.detail.slice((page - 1) * 50, page * 50)}
              maxHeight={240}
              columns={fields.map((field) => ({ key: field.key, label: field.name, width: 130, ellipsis: true, render: (row: any) => display(field, row.data[field.key], references) }))}
            />
            <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 0.5 }} alignItems="center">
              <Typography sx={{ fontSize: 12, alignSelf: 'center' }}>{page} / {Math.max(1, Math.ceil(result.detail.length / 50))}</Typography>
              <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
              <Button size="small" disabled={page >= Math.ceil(result.detail.length / 50)} onClick={() => setPage(page + 1)}>下一页</Button>
            </Stack>
          </>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button size="small" onClick={onClose}>关闭</Button></DialogActions>
    </Dialog>
  )
}
