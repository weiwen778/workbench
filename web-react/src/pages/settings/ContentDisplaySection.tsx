import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { Card } from '../SettingsSections'

const read = (key: string, fallback: string) => localStorage.getItem(key) || fallback
const write = (key: string, value: string) => localStorage.setItem(key, value)

function Field({ label, children }: { label: string; children: ReactNode }) {
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, {
        inputProps: { 'aria-label': label, ...(children.props as any).inputProps },
      })
    : children
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>{label}</Typography>
      {control}
    </Box>
  )
}

export default function ContentDisplaySection() {
  const [tableView, setTableView] = useState(() => read('wb_table_view', 'cards'))
  const [tableDensity, setTableDensity] = useState(() => read('wb_table_density', 'compact'))
  const [tableStriped, setTableStriped] = useState(() => read('wb_table_striped', '0') === '1')
  const [tableCenterX, setTableCenterX] = useState(() => read('wb_table_center_x', '1') !== '0')
  const [tableCenterY, setTableCenterY] = useState(() => read('wb_table_center_y', '1') !== '0')
  const [tablePageSize, setTablePageSize] = useState(() => read('wb_table_page_size', '50'))
  const [memoView, setMemoView] = useState(() => read('wb_memo_view', 'cards'))
  const [memoColumns, setMemoColumns] = useState(() => read('wb_memo_columns', '0'))
  const [noteWidth, setNoteWidth] = useState(() => read('wb_note_width', 'standard'))
  const [boardView, setBoardView] = useState(() => read('wb_board_view', 'cards'))

  const change = (setter: (value: string) => void, key: string) => (value: string) => {
    setter(value)
    write(key, value)
  }
  const changeBool = (setter: (value: boolean) => void, key: string) => (value: boolean) => {
    setter(value)
    write(key, value ? '1' : '0')
  }

  const reset = () => {
    setTableView('cards'); write('wb_table_view', 'cards')
    setTableDensity('compact'); write('wb_table_density', 'compact')
    setTableStriped(false); write('wb_table_striped', '0')
    setTableCenterX(true); write('wb_table_center_x', '1')
    setTableCenterY(true); write('wb_table_center_y', '1')
    setTablePageSize('50'); write('wb_table_page_size', '50')
    setMemoView('cards'); write('wb_memo_view', 'cards')
    setMemoColumns('0'); write('wb_memo_columns', '0')
    setNoteWidth('standard'); write('wb_note_width', 'standard')
    setBoardView('cards'); write('wb_board_view', 'cards')
  }

  return (
    <Stack spacing={2}>
      <Card>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'flex-start' }} gap={1}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>表格</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>新打开表格时使用的默认显示方式；表格内仍可临时切换。</Typography>
          </Box>
          <Button size="small" onClick={reset} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>恢复全部默认</Button>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
          <Field label="默认视图">
            <TextField select fullWidth size="small" value={tableView} onChange={(event) => change(setTableView, 'wb_table_view')(event.target.value)}>
              <MenuItem value="cards">卡片</MenuItem>
              <MenuItem value="list">列表</MenuItem>
            </TextField>
          </Field>
          <Field label="行高">
            <TextField select fullWidth size="small" value={tableDensity} onChange={(event) => change(setTableDensity, 'wb_table_density')(event.target.value)}>
              <MenuItem value="compact">紧凑</MenuItem>
              <MenuItem value="comfortable">舒适</MenuItem>
            </TextField>
          </Field>
          <Field label="每页条数">
            <TextField select fullWidth size="small" value={tablePageSize} onChange={(event) => change(setTablePageSize, 'wb_table_page_size')(event.target.value)}>
              {[20, 50, 100].map((size) => <MenuItem key={size} value={String(size)}>{size} 条</MenuItem>)}
            </TextField>
          </Field>
          <Box sx={{ pt: { sm: 3.5 } }}>
            <FormControlLabel control={<Checkbox size="small" checked={tableStriped} onChange={(event) => changeBool(setTableStriped, 'wb_table_striped')(event.target.checked)} />} label="斑马纹" />
          </Box>
          <FormControlLabel control={<Checkbox size="small" checked={tableCenterX} onChange={(event) => changeBool(setTableCenterX, 'wb_table_center_x')(event.target.checked)} />} label="内容水平居中" />
          <FormControlLabel control={<Checkbox size="small" checked={tableCenterY} onChange={(event) => changeBool(setTableCenterY, 'wb_table_center_y')(event.target.checked)} />} label="内容垂直居中" />
        </Box>
      </Card>

      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>便利贴</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>默认视图和每行卡片数量。</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
          <Field label="默认视图">
            <TextField select fullWidth size="small" value={memoView} onChange={(event) => change(setMemoView, 'wb_memo_view')(event.target.value)}>
              <MenuItem value="cards">卡片</MenuItem>
              <MenuItem value="list">列表</MenuItem>
            </TextField>
          </Field>
          <Field label="每行列数">
            <TextField select fullWidth size="small" value={memoColumns} onChange={(event) => change(setMemoColumns, 'wb_memo_columns')(event.target.value)}>
              <MenuItem value="0">自动</MenuItem>
              {[2, 3, 4, 5].map((count) => <MenuItem key={count} value={String(count)}>{count} 列</MenuItem>)}
            </TextField>
          </Field>
        </Box>
      </Card>

      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>笔记与看板</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>控制笔记正文宽度和看板列表的默认视图。</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
          <Field label="笔记正文宽度">
            <TextField select fullWidth size="small" value={noteWidth} onChange={(event) => change(setNoteWidth, 'wb_note_width')(event.target.value)}>
              <MenuItem value="narrow">窄</MenuItem>
              <MenuItem value="standard">标准</MenuItem>
              <MenuItem value="wide">宽</MenuItem>
              <MenuItem value="full">全宽</MenuItem>
            </TextField>
          </Field>
          <Field label="看板默认视图">
            <TextField select fullWidth size="small" value={boardView} onChange={(event) => change(setBoardView, 'wb_board_view')(event.target.value)}>
              <MenuItem value="cards">卡片</MenuItem>
              <MenuItem value="list">列表</MenuItem>
            </TextField>
          </Field>
        </Box>
      </Card>
    </Stack>
  )
}
