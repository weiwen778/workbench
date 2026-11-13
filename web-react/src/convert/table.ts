import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { baseName, sanitizeName } from './files'
import type { ConvertOutput, ConvertSettings } from './types'

export interface TableData {
  columns: string[]
  rawColumns: string[]
  rows: string[][]
  warnings: string[]
}

function decodeText(buffer: ArrayBuffer, encoding: string) {
  if (buffer.byteLength >= 2) {
    const first = new Uint8Array(buffer, 0, 2)
    if (first[0] === 0xff && first[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer)
    if (first[0] === 0xfe && first[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer)
  }
  try {
    return new TextDecoder(encoding || 'utf-8').decode(buffer).replace(/^\uFEFF/, '')
  } catch {
    throw new Error(`浏览器不支持 ${encoding} 编码，请换用 UTF-8 或 GBK`)
  }
}

function normalizeRows(rows: string[][], hasHeader: boolean): TableData {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const padded = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''))
  const rawColumns = hasHeader && padded.length ? padded[0] : []
  const columns = hasHeader && padded.length ? rawColumns.map((value, index) => value || `列 ${index + 1}`) : Array.from({ length: width }, (_, index) => `列 ${index + 1}`)
  const body = hasHeader ? padded.slice(1) : padded
  return { columns, rawColumns, rows: body, warnings: [] }
}

export async function readCsv(file: File, settings: ConvertSettings): Promise<TableData> {
  const text = decodeText(await file.arrayBuffer(), settings.encoding)
  const parsed = Papa.parse<string[]>(text, {
    delimiter: settings.delimiter === 'auto' ? undefined : settings.delimiter,
    skipEmptyLines: 'greedy',
  })
  const fatal = parsed.errors.find((error) => error.type === 'Delimiter' || error.type === 'Quotes')
  if (fatal) throw new Error(`CSV 解析失败：${fatal.message}`)
  const data = parsed.data.filter((row) => Array.isArray(row))
  if (!data.length) throw new Error('CSV 没有可读取的数据')
  const result = normalizeRows(data, settings.hasHeader)
  const warnings: string[] = []
  if (text.includes('\uFFFD')) warnings.push('检测到无法解码的字符，建议切换编码后重新导入')
  if (result.rows.some((row) => row.some((value) => /^0\d+$/.test(value)))) warnings.push('检测到前导零，导出时会按文本保留（例如 00123）')
  const width = result.columns.length
  if (data.some((row) => row.length !== width)) warnings.push('部分行列数不一致，已按空值补齐')
  result.warnings = warnings
  return result
}

export async function csvToXlsx(file: File, settings: ConvertSettings, onProgress: (progress: number) => void, signal?: AbortSignal): Promise<ConvertOutput> {
  onProgress(15)
  const table = await readCsv(file, settings)
  if (signal?.aborted) throw new Error('已取消')
  onProgress(55)
  const data = settings.hasHeader ? [table.rawColumns, ...table.rows] : table.rows
  const sheet = XLSX.utils.aoa_to_sheet(data)
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref'])
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const value = data[row]?.[column]
        if (typeof value !== 'string' || !/^[=+\-@]/.test(value) || /^-?\d+(?:\.\d+)?$/.test(value)) continue
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]
        if (cell) { cell.t = 's'; cell.v = value; cell.w = value; delete cell.f }
      }
    }
  }
  const widths = table.columns.map((column, index) => ({
    wch: Math.min(50, Math.max(column.length + 2, ...table.rows.slice(0, 200).map((row) => String(row[index] ?? '').length + 2))),
  }))
  sheet['!cols'] = widths
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, sanitizeName(settings.sheetName || baseName(file.name)).slice(0, 31) || 'Sheet1')
  const array = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  onProgress(100)
  return {
    blob: new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    name: `${baseName(file.name)}.xlsx`,
  }
}

export interface WorkbookData {
  sheets: string[]
  warnings: string[]
}

export async function readWorkbook(file: File): Promise<WorkbookData> {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellFormula: true, cellDates: false, cellNF: false, sheetStubs: true })
  const warnings: string[] = []
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet?.['!ref']) continue
    const range = XLSX.utils.decode_range(sheet['!ref'])
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]
        if (cell?.f && (cell.t === 'z' || cell.v === undefined)) warnings.push(`工作表「${name}」${XLSX.utils.encode_cell({ r: row, c: column })} 的公式缺少计算值，将导出为空`)
      }
    }
  }
  return { sheets: workbook.SheetNames, warnings }
}

function sheetTable(sheet: XLSX.WorkSheet): TableData {
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref'])
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]
        if (cell?.f && cell.t === 'z') { cell.t = 's'; cell.v = ''; cell.w = '' }
      }
    }
  }
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: true, defval: '', blankrows: false })
  const rows = data.map((row) => (Array.isArray(row) ? row.map((value) => value == null ? '' : String(value)) : []))
  if (!rows.length) throw new Error('工作表为空')
  const rawColumns = rows[0]
  return { columns: rawColumns.map((value, index) => value || `列 ${index + 1}`), rawColumns, rows: rows.slice(1), warnings: [] }
}

export async function previewXlsx(file: File, sheetName: string): Promise<TableData> {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellFormula: true, cellDates: false, cellNF: false, sheetStubs: true })
  const target = sheetName && workbook.Sheets[sheetName] ? sheetName : workbook.SheetNames[0]
  if (!target) throw new Error('工作表为空')
  return sheetTable(workbook.Sheets[target])
}

function toCsv(columns: string[], rows: string[][]) {
  const escape = (value: string) => {
    let text = value
    if (/^[=+\-@]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return '\uFEFF' + [columns, ...rows].map((row) => row.map((value) => escape(String(value ?? ''))).join(',')).join('\r\n')
}

export async function xlsxToCsv(
  file: File,
  settings: ConvertSettings,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ConvertOutput[]> {
  onProgress(15)
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellFormula: true, cellDates: false, cellNF: false, sheetStubs: true })
  const names = settings.sheetMode === 'all' ? workbook.SheetNames : [settings.sheetName || workbook.SheetNames[0]].filter(Boolean)
  if (!names.length) throw new Error('没有可导出的工作表')
  const outputs: ConvertOutput[] = []
  for (let index = 0; index < names.length; index += 1) {
    if (signal?.aborted) throw new Error('已取消')
    const name = names[index]
    const table = sheetTable(workbook.Sheets[name])
    const text = toCsv(table.rawColumns.length ? table.rawColumns : table.columns, table.rows)
    const suffix = names.length > 1 ? `-${sanitizeName(name)}` : ''
    outputs.push({ blob: new Blob([text], { type: 'text/csv;charset=utf-8' }), name: `${baseName(file.name)}${suffix}.csv` })
    onProgress(Math.round(((index + 1) / names.length) * 100))
  }
  return outputs
}
