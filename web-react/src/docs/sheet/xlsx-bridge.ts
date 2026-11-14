/**
 * SheetJS <-> Univer 的本地桥接层。
 *
 * Univer 1.x 的 XLSX 导入导出依赖 Pro 版 exchanger + 服务端转换，本机离线工作台不能走那条路，
 * 因此这里用项目已有的 SheetJS 做双向转换：
 * - 导入：XLSX 工作簿 -> IWorkbookData（值、公式、合并、列宽、行高、数字格式）
 * - 导出：IWorkbookData 快照 -> XLSX 工作簿
 * 样式（字体/颜色/边框）SheetJS CE 读写都不支持，这里不搬运，由 Univer 自身编辑产生。
 */
import * as XLSX from 'xlsx'
import type { ICellData, IWorkbookData, IWorksheetData } from '@univerjs/presets'

/** Univer CellValueType：1 字符串、2 数字、3 布尔、4 强制字符串。 */
const CELL_STRING = 1
const CELL_NUMBER = 2
const CELL_BOOLEAN = 3
const CELL_FORCE_STRING = 4

export interface NumberFormatPatch {
  sheetId: string
  row: number
  col: number
  pattern: string
}

export interface ImportResult {
  data: Partial<IWorkbookData>
  numberFormats: NumberFormatPatch[]
  warnings: string[]
}

const MAX_ROWS = 20_000
const MAX_COLS = 500
const MAX_NUMBER_FORMAT_CELLS = 5_000

function charWidthToPx(width: number) {
  return Math.max(24, Math.round(width * 7 + 5))
}

function pointHeightToPx(height: number) {
  return Math.max(18, Math.round((height * 4) / 3))
}

function cellFromSheetJs(cell: XLSX.CellObject | undefined): ICellData | null {
  if (!cell) return null
  const formula = typeof cell.f === 'string' && cell.f ? `=${cell.f}` : null
  const value = cell.v
  const empty = value === undefined || value === null || value === ''
  if (empty && !formula) return null
  const out: ICellData = {}
  if (formula) out.f = formula
  if (!empty) {
    if (cell.t === 'n') { out.v = value as number; out.t = CELL_NUMBER }
    else if (cell.t === 'b') { out.v = Boolean(value); out.t = CELL_BOOLEAN }
    else if (cell.t === 'd' && value instanceof Date) { out.v = value.toISOString().slice(0, 10); out.t = CELL_STRING }
    else { out.v = String(value); out.t = cell.t === 's' ? CELL_STRING : CELL_FORCE_STRING }
  } else if (formula) {
    // 只有公式没有缓存值：交给 Univer 重算
    out.t = CELL_NUMBER
  }
  return out
}

/** XLSX 工作簿 -> Univer 快照（可直接喂给 univerAPI.createWorkbook）。 */
export function sheetJsToUniver(workbook: XLSX.WorkBook, name: string): ImportResult {
  const warnings: string[] = []
  const numberFormats: NumberFormatPatch[] = []
  const sheets: Record<string, IWorksheetData> = {}
  const sheetOrder: string[] = []
  let formatCells = 0

  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName]
    const sheetId = `sheet-${index + 1}`
    sheetOrder.push(sheetId)
    const cellData: Record<number, Record<number, ICellData>> = {}
    let maxRow = 0
    let maxCol = 0

    if (worksheet) {
      const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null
      if (range && (range.e.r + 1 > MAX_ROWS || range.e.c + 1 > MAX_COLS)) {
        warnings.push(`工作表「${sheetName}」超出 ${MAX_ROWS} 行 / ${MAX_COLS} 列上限，只导入左上角部分`)
      }
      for (const address of Object.keys(worksheet)) {
        if (address.startsWith('!')) continue
        const decoded = XLSX.utils.decode_cell(address)
        if (decoded.r >= MAX_ROWS || decoded.c >= MAX_COLS) continue
        const cell = worksheet[address] as XLSX.CellObject
        const converted = cellFromSheetJs(cell)
        if (!converted) continue
        if (!cellData[decoded.r]) cellData[decoded.r] = {}
        cellData[decoded.r][decoded.c] = converted
        maxRow = Math.max(maxRow, decoded.r)
        maxCol = Math.max(maxCol, decoded.c)
        const pattern = typeof cell.z === 'string' ? cell.z : ''
        if (pattern && pattern !== 'General' && formatCells < MAX_NUMBER_FORMAT_CELLS) {
          numberFormats.push({ sheetId, row: decoded.r, col: decoded.c, pattern })
          formatCells += 1
        }
      }
    }

    const mergeData = (worksheet?.['!merges'] || [])
      .filter((merge) => merge.s.r < MAX_ROWS && merge.s.c < MAX_COLS)
      .map((merge) => ({ startRow: merge.s.r, startColumn: merge.s.c, endRow: merge.e.r, endColumn: merge.e.c }))

    const columnData: Record<number, { w: number }> = {}
    ;(worksheet?.['!cols'] || []).forEach((col, index) => {
      if (col && typeof col.wch === 'number' && col.wch > 0) columnData[index] = { w: charWidthToPx(col.wch) }
      else if (col && typeof col.width === 'number' && col.width > 0) columnData[index] = { w: charWidthToPx(col.width) }
    })
    const rowData: Record<number, { h: number }> = {}
    ;(worksheet?.['!rows'] || []).forEach((row, index) => {
      if (row && typeof row.hpt === 'number' && row.hpt > 0) rowData[index] = { h: pointHeightToPx(row.hpt) }
    })

    sheets[sheetId] = {
      id: sheetId,
      name: sheetName.slice(0, 100) || `Sheet${index + 1}`,
      tabColor: '',
      hidden: 0,
      freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
      rowCount: Math.max(maxRow + 1, 200),
      columnCount: Math.max(maxCol + 1, 26),
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
      defaultColumnWidth: 88,
      defaultRowHeight: 24,
      mergeData,
      cellData,
      rowData,
      columnData,
      showGridlines: 1,
      rowHeader: { width: 46 },
      columnHeader: { height: 20 },
      selections: [],
      rightToLeft: 0,
    } as unknown as IWorksheetData
  })

  if (formatCells >= MAX_NUMBER_FORMAT_CELLS) {
    warnings.push(`数字格式单元格超过 ${MAX_NUMBER_FORMAT_CELLS} 个，其余按常规显示`)
  }

  return {
    data: {
      id: `wb-${Date.now().toString(36)}`,
      name: name || '未命名工作簿',
      sheetOrder,
      sheets,
    },
    numberFormats,
    warnings,
  }
}

/** Univer 快照 -> XLSX 工作簿。公式与缓存值一并写出，样式不写。 */
export function univerToSheetJs(data: IWorkbookData): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()
  for (const sheetId of data.sheetOrder || []) {
    const sheet = data.sheets?.[sheetId]
    if (!sheet) continue
    const worksheet: XLSX.WorkSheet = {}
    let maxRow = 0
    let maxCol = 0
    const cellRows = Object.entries(sheet.cellData || {}) as [string, Record<string, ICellData> | null | undefined][]
    for (const [rowKey, row] of cellRows) {
      const rowIndex = Number(rowKey)
      for (const [colKey, cell] of Object.entries(row || {})) {
        const colIndex = Number(colKey)
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
        const formula = typeof cell?.f === 'string' ? cell.f.replace(/^=/, '') : ''
        const value = cell?.v
        const entry: XLSX.CellObject = { t: 's', v: '' }
        if (formula) {
          entry.f = formula
          if (typeof value === 'number') { entry.t = 'n'; entry.v = value }
          else if (typeof value === 'boolean') { entry.t = 'b'; entry.v = value }
          else if (value !== undefined && value !== null && value !== '') { entry.t = 's'; entry.v = String(value) }
          else { entry.t = 'n'; entry.v = 0 }
        } else if (typeof value === 'number') { entry.t = 'n'; entry.v = value }
        else if (typeof value === 'boolean') { entry.t = 'b'; entry.v = value }
        else if (value !== undefined && value !== null && value !== '') { entry.t = 's'; entry.v = String(value) }
        else continue
        worksheet[address] = entry
        maxRow = Math.max(maxRow, rowIndex)
        maxCol = Math.max(maxCol, colIndex)
      }
    }
    worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } })
    if (sheet.mergeData?.length) {
      worksheet['!merges'] = sheet.mergeData.map((merge) => ({
        s: { r: merge.startRow, c: merge.startColumn },
        e: { r: merge.endRow, c: merge.endColumn },
      }))
    }
    const cols: XLSX.ColInfo[] = []
    for (const [colKey, col] of Object.entries(sheet.columnData || {})) {
      if (typeof col?.w === 'number' && col.w > 0) cols[Number(colKey)] = { wch: Math.max(3, Math.round((col.w - 5) / 7)) }
    }
    if (cols.length) worksheet['!cols'] = cols
    const rows: XLSX.RowInfo[] = []
    for (const [rowKey, row] of Object.entries(sheet.rowData || {})) {
      if (typeof row?.h === 'number' && row.h > 0) rows[Number(rowKey)] = { hpt: Math.round((row.h * 3) / 4) }
    }
    if (rows.length) worksheet['!rows'] = rows

    let name = (sheet.name || 'Sheet').replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet'
    let suffix = 1
    while (used.has(name)) { name = `${name.slice(0, 28)}_${suffix++}` }
    used.add(name)
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
  }
  if (!workbook.SheetNames.length) XLSX.utils.book_append_sheet(workbook, {}, 'Sheet1')
  return workbook
}

export function workbookToBlob(workbook: XLSX.WorkBook): Blob {
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
