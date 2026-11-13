import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import { Divider } from '@mui/material'
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactElement, type ReactNode } from 'react'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import { DataGrid, useGridApiRef, type GridColDef } from '@mui/x-data-grid'
import { zhCN } from '@mui/x-data-grid/locales'

export function Page({ children, scroll = false, sx }: { children: ReactNode; scroll?: boolean; sx?: any }) {
  return (
    <Box sx={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5, p: 2, ...(scroll ? { overflow: 'auto' } : {}), ...sx }}>
      {children}
    </Box>
  )
}

export function PageToolbar({ children, sx }: { children: ReactNode; sx?: any }) {
  return <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, minHeight: 40, flexShrink: 0, ...sx }}>{children}</Box>
}

export function PageBody({ children, sx }: { children: ReactNode; sx?: any }) {
  return <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.5, ...sx }}>{children}</Box>
}

export function EmptyHint({ children, action }: { children?: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, py: 4, px: 2, textAlign: 'center', color: 'text.secondary', fontSize: 13 }}>
      {children ? <div>{children}</div> : null}
      {action}
    </Box>
  )
}

export function LoadingBlock({ text = '加载中…' }: { text?: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ py: 5, color: 'text.secondary' }}>
      <CircularProgress size={18} />
      <Typography variant="body2">{text}</Typography>
    </Stack>
  )
}

export function LoadingBar({ active }: { active: boolean }) {
  return <Box sx={{ height: 2, overflow: 'hidden' }}>{active ? <LinearProgress /> : null}</Box>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{children}</Typography>
      {action}
    </Stack>
  )
}

export function Muted({ children, sx }: { children: ReactNode; sx?: any }) {
  return <Typography component="span" variant="caption" color="text.secondary" sx={sx}>{children}</Typography>
}

export interface Column<T> {
  key: string
  label: ReactNode
  width?: number | string
  align?: 'left' | 'right' | 'center'
  ellipsis?: boolean
  sticky?: boolean
  sortable?: boolean
  headerRender?: ReactNode
  render?: (row: T, index: number) => ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty = '暂无数据',
  rowKey,
  onRowClick,
  maxHeight,
  size = 'small',
  columnDividers = false,
  striped = false,
  centerX = false,
  centerY = true,
  columnWidths,
  onColumnWidthsChange,
  columnVisibility,
  onColumnVisibilityChange,
  sortKey,
  sortDirection = 'asc',
  onSort,
  onSortClear,
  sx,
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  empty?: ReactNode
  rowKey?: (row: T, index: number) => string | number
  onRowClick?: (row: T, index: number) => void
  maxHeight?: number | string
  size?: 'small' | 'medium'
  columnDividers?: boolean
  striped?: boolean
  centerX?: boolean
  centerY?: boolean
  columnWidths?: Record<string, number>
  onColumnWidthsChange?: (widths: Record<string, number>) => void
  columnVisibility?: Record<string, boolean>
  onColumnVisibilityChange?: (model: Record<string, boolean>) => void
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  onSort?: (key: string, direction: 'asc' | 'desc') => void
  onSortClear?: () => void
  sx?: any
}) {
  const gridColumns: GridColDef[] = columns.map((column) => {
    const field = String(column.key)
    const pinnedActions = field === '__actions'
    const tailActions = field === 'actions'
    const fixed = pinnedActions || tailActions || field === '__select'
    const savedWidth = typeof columnWidths?.[field] === 'number' && columnWidths[field] > 0 ? columnWidths[field] : undefined
    const baseWidth = savedWidth ?? (typeof column.width === 'number' ? column.width : undefined)
    const hasSavedWidths = Boolean(columnWidths && Object.keys(columnWidths).length)
    return {
      field,
      headerName: typeof column.label === 'string' ? column.label : '',
      width: baseWidth,
      minWidth: savedWidth ?? (!fixed && typeof column.width === 'number' ? column.width : undefined),
      flex: fixed || savedWidth || hasSavedWidths ? 0 : typeof column.width === 'number' ? column.width : 1,
      align: centerX ? 'center' : column.align,
      headerAlign: centerX ? 'center' : column.align,
      sortable: Boolean(column.sortable && onSort),
      hideable: !(pinnedActions || tailActions || field === '__select'),
      disableColumnMenu: field === '__select',
      renderHeader: () => column.headerRender ?? column.label,
      renderCell: (params) => {
        if (column.render) return column.render(params.row as T, rows.indexOf(params.row as T))
        const value = (params.row as any)?.[column.key]
        return (
          <Box component="span" title={value == null ? undefined : String(value)} sx={{ display: 'block', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value ?? '—'}
          </Box>
        )
      },
    }
  })
  const theme = useTheme()
  const softBg = theme.palette.mode === 'dark' ? '#242B2E' : '#F4F5F5'
  const apiRef = useGridApiRef()
  const hasActions = columns.some((column) => String(column.key) === '__actions')
  // DataGrid 免费版没有 pinnedColumns 属性，但社区版内部状态已支持列固定，这里直接注入状态把操作列固定在右侧。
  useLayoutEffect(() => {
    if (!hasActions) return
    apiRef.current.setState((state: any) => ({ ...state, pinnedColumns: { left: [], right: ['__actions'] } }))
  }, [apiRef, hasActions])

  const widthsChangeRef = useRef(onColumnWidthsChange)
  widthsChangeRef.current = onColumnWidthsChange
  useEffect(() => {
    return apiRef.current.subscribeEvent('columnResizeStop', () => {
      if (!widthsChangeRef.current) return
      const widths = Object.fromEntries(
        apiRef.current.getAllColumns()
          .filter((column) => column.field && column.computedWidth > 0)
          .map((column) => [String(column.field), Math.round(column.computedWidth)]),
      )
      widthsChangeRef.current(widths)
    })
  }, [apiRef])
  const rowHeightValue = size === 'small' ? 36 : 52
  const headerHeightValue = size === 'small' ? 36 : 44
  const naturalHeight = headerHeightValue + rows.length * rowHeightValue + 2
  const height = maxHeight === '100%'
    ? '100%'
    : typeof maxHeight === 'number'
      ? (naturalHeight <= maxHeight ? undefined : maxHeight)
      : maxHeight ?? (rows.length <= 8 ? undefined : 440)
  const effectiveHeight = !loading && rows.length === 0 ? undefined : height
  return (
    <Box sx={{ width: '100%', minWidth: 0, ...(maxHeight === '100%' ? { flex: 1, minHeight: 0, height: '100%' } : {}), ...sx }}>
      <DataGrid
        apiRef={apiRef}
        localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}
        rows={rows}
        columns={gridColumns}
        loading={Boolean(loading)}
        getRowId={(row) => {
          const index = rows.indexOf(row)
          return String(rowKey ? rowKey(row, index) : (row as any)?.id ?? index)
        }}
        onRowClick={onRowClick ? (params) => onRowClick(params.row as T, rows.indexOf(params.row as T)) : undefined}
        hideFooter
        disableRowSelectionOnClick
        disableColumnFilter
        columnVisibilityModel={columnVisibility}
        onColumnVisibilityModelChange={onColumnVisibilityChange ? (model) => onColumnVisibilityChange(model) : undefined}
        scrollbarSize={8}
        autoHeight={!effectiveHeight}
        rowHeight={rowHeightValue}
        columnHeaderHeight={headerHeightValue}
        sortingMode={onSort ? 'server' : 'client'}
        sortModel={onSort && sortKey ? [{ field: sortKey, sort: sortDirection }] : []}
        onSortModelChange={(model) => {
          if (!onSort) return
          const next = model[0]
          if (!next) { onSortClear?.(); return }
          if (next.field === sortKey && next.sort === sortDirection) return
          onSort(next.field, next.sort === 'desc' ? 'desc' : 'asc')
        }}
        slots={{ noRowsOverlay: () => <Box sx={{ p: 4, textAlign: 'center', fontSize: 13, color: 'text.secondary' }}>{empty}</Box> }}
        sx={{
          height: effectiveHeight ?? undefined,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          bgcolor: 'background.paper',
          '& .MuiDataGrid-columnHeaders': { bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' },
          '& .MuiDataGrid-cell': {
            fontSize: 12.5, borderBottom: '1px solid', borderColor: 'divider',
            ...(columnDividers ? { borderRight: '1px solid', borderRightColor: 'divider' } : {}),
            ...(centerX ? { textAlign: 'center' } : {}),
            ...(centerY ? {} : { lineHeight: '1.5 !important', paddingTop: '4px !important' }),
          },
          '& .MuiDataGrid-row--lastVisible .MuiDataGrid-cell': { borderBottom: 0 },
          '& .MuiDataGrid-columnHeaderTitle': { fontSize: 12.5, fontWeight: 600 },
          '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
          '& .MuiDataGrid-scrollbar--horizontal': { height: '8px !important' },
          '& .MuiDataGrid-scrollbar--horizontal > div': { height: '8px !important' },
          '& .MuiDataGrid-scrollbar--vertical': { width: '8px !important' },
          '& .MuiDataGrid-scrollbar--vertical > div': { width: '8px !important' },
          '& .MuiDataGrid-scrollbar::-webkit-scrollbar': { width: 8, height: 8 },
          '& .MuiDataGrid-scrollbar::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '& .MuiDataGrid-scrollbar::-webkit-scrollbar-thumb': {
            backgroundColor: theme.palette.mode === 'dark' ? 'rgba(228,235,233,0.28)' : 'rgba(26,36,38,0.24)',
            borderRadius: 4,
          },
          '& .MuiDataGrid-cell--pinnedRight': {
            backgroundColor: 'background.paper',
            boxShadow: '-8px 0 8px -8px rgba(0,0,0,0.28)',
          },
          '& .MuiDataGrid-columnHeader--pinnedRight': {
            backgroundColor: softBg,
            boxShadow: '-8px 0 8px -8px rgba(0,0,0,0.28)',
          },

          ...(columnDividers ? {
            '& .MuiDataGrid-columnHeader': { borderRight: '1px solid', borderColor: 'divider' },
            '& .MuiDataGrid-cell:last-child, & .MuiDataGrid-columnHeader:last-child': { borderRight: 0 },
          } : {}),
          ...(striped ? {
            '& .MuiDataGrid-row:nth-of-type(even)': { backgroundColor: softBg },
            '& .MuiDataGrid-row:nth-of-type(even) .MuiDataGrid-cell--pinnedRight': { backgroundColor: softBg },
          } : {}),
        }}
      />
    </Box>
  )
}

export function Pager({
  page, pageSize, total, onPage, onPageSize, pageSizes = [20, 50, 100],
  showSize = true,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize?: (size: number) => void
  pageSizes?: number[]
  showSize?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= 0 && !showSize) return null
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="flex-end" sx={{ py: 1 }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>共 {total} 条</Typography>
      {showSize && onPageSize ? (
        <Select
          size="small"
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
          sx={{ height: 30, fontSize: 12, minWidth: 92 }}
        >
          {pageSizes.map((size) => <MenuItem key={size} value={size} sx={{ fontSize: 12 }}>{size} 条/页</MenuItem>)}
        </Select>
      ) : null}
      <Pagination
        size="small"
        count={pages}
        page={Math.min(page, pages)}
        onChange={(_, value) => onPage(value)}
        showFirstButton
        showLastButton
        siblingCount={1}
      />
    </Stack>
  )
}

export function UploadDropzone({
  accept, onFile, title = '把文件拖到这里，或点一下选择', hint, disabled,
}: {
  accept?: string
  onFile: (file: File) => void
  title?: string
  hint?: string
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = event.dataTransfer.files?.[0]
    if (file) onFile(file)
  }
  return (
    <Box
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      sx={{
        border: '1px dashed', borderColor: dragging ? 'primary.main' : 'divider',
        bgcolor: dragging ? 'action.hover' : 'transparent',
        borderRadius: 1.5, px: 2, py: 2.5, textAlign: 'center', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <CloudUploadIcon sx={{ fontSize: 28, color: 'text.secondary' }} />
      <Typography sx={{ fontSize: 13, mt: 0.5 }}>{title}</Typography>
      {hint ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>{hint}</Typography> : null}
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />
    </Box>
  )
}

export function FieldRow({ label, children, required, hint }: { label: ReactNode; children: ReactNode; required?: boolean; hint?: string }) {
  const longLabel = typeof label === 'string' && label.length > 16
  // 单输入控件：把标签放进输入框，统一成上浮标签样式
  if (!longLabel && isValidElement(children)) {
    const child = children as ReactElement<any>
    if (child.type === TextField) {
      return (
        <Box sx={{ mb: 1.5 }}>
          {cloneElement(child, {
            label: child.props.label ?? label,
            required: child.props.required ?? required,
            InputLabelProps: { ...child.props.InputLabelProps },
          })}
          {hint ? <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.4 }}>{hint}</Typography> : null}
        </Box>
      )
    }
    if (child.type === Select) {
      return (
        <Box sx={{ mb: 1.5 }}>
          <FormControl
            fullWidth={Boolean(child.props.fullWidth)}
            size={child.props.size ?? 'small'}
            disabled={child.props.disabled}
            error={child.props.error}
          >
            <InputLabel shrink required={required}>{label}</InputLabel>
            {cloneElement(child, {
              label: child.props.label ?? label,
              inputProps: {
                ...child.props.inputProps,
                ...(typeof label === 'string' ? { 'aria-label': label } : {}),
              },
            })}
          </FormControl>
          {hint ? <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.4 }}>{hint}</Typography> : null}
        </Box>
      )
    }
  }
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
        {label}{required ? <Box component="span" sx={{ color: 'error.main' }}> *</Box> : null}
      </Typography>
      {children}
      {hint ? <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.4 }}>{hint}</Typography> : null}
    </Box>
  )
}
