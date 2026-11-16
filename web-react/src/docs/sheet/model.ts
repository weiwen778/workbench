import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { unzipSync } from 'fflate'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_CELLS = 100_000
export const MAX_ROWS = 10_000
export const MAX_COLS = 200

export interface CellData {
  value: any
  formula?: string
  type?: string
  format?: string
  style?: any
}

export interface SheetModel {
  name: string
  cells: Record<string, CellData>
  rowCount: number
  colCount: number
  merges?: string[]
  cols?: any[]
  hidden?: boolean
}

export interface WorkbookModel {
  fileName: string
  sourceFormat: string
  sheets: SheetModel[]
  activeSheet: number
  warnings: string[]
  dirty: boolean
}

export function colName(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

export function colIndex(name: string): number {
  let value = 0
  for (const char of name.replace(/\$/g, '').toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64
  return value - 1
}

export function a1(row: number, col: number): string {
  return `${colName(col)}${row + 1}`
}

export function parseA1(value: string): { row: number; col: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(value.trim())
  if (!match) return null
  const row = Number(match[2]) - 1
  const col = colIndex(match[1])
  return row >= 0 && col >= 0 ? { row, col } : null
}

export function getCell(sheet: SheetModel, row: number, col: number): CellData | undefined {
  return sheet.cells[a1(row, col)]
}

export function cloneWorkbook(workbook: WorkbookModel): WorkbookModel {
  return structuredClone(workbook)
}

export function sheetBounds(sheet: SheetModel) {
  let rowCount = 1
  let colCount = 1
  for (const key of Object.keys(sheet.cells)) {
    const ref = parseA1(key)
    if (!ref) continue
    rowCount = Math.max(rowCount, ref.row + 1)
    colCount = Math.max(colCount, ref.col + 1)
  }
  return { rowCount: Math.max(rowCount, sheet.rowCount || 1), colCount: Math.max(colCount, sheet.colCount || 1) }
}

function displayText(value: any): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

export function cellDisplay(cell: CellData | undefined, computed?: any): string {
  if (!cell) return ''
  if (cell.formula) {
    if (computed === undefined) return cell.value == null ? '' : displayText(cell.value)
    return displayText(computed)
  }
  if (cell.format && /[ymdhs]/i.test(cell.format) && typeof cell.value === 'number') {
    try { return XLSX.SSF.format(cell.format, cell.value) } catch { /* fall through */ }
  }
  if (cell.format && /^0+$/.test(cell.format) && typeof cell.value === 'number') {
    return String(Math.trunc(cell.value)).padStart(cell.format.length, '0')
  }
  return displayText(cell.value)
}

export function cellInput(cell: CellData | undefined): string {
  if (!cell) return ''
  return cell.formula ? `=${cell.formula}` : cellDisplay(cell)
}

export function setCell(sheet: SheetModel, row: number, col: number, input: string) {
  if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) {
    throw new Error(`单元格超出上限：最多 ${MAX_ROWS.toLocaleString()} 行、${MAX_COLS} 列`)
  }
  const key = a1(row, col)
  const text = input
  if (!text.trim()) {
    delete sheet.cells[key]
  } else if (text.startsWith('=')) {
    const formula = text.slice(1).trim()
    const existing = sheet.cells[key]
    sheet.cells[key] = {
      value: existing?.value ?? 0,
      formula,
      type: existing?.type || 'n',
      format: existing?.format,
      style: existing?.style,
    }
  } else {
    const existing = sheet.cells[key]
    const trimmed = text.trim()
    const numeric = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)
    const preserveText = existing?.type === 's' || /^0\d+/.test(trimmed) || (existing?.format ? /^0+$/.test(existing.format) : false)
    let value: any = text
    let type = 's'
    if (numeric && !preserveText) { value = Number(trimmed); type = 'n' }
    else if (/^(TRUE|FALSE)$/i.test(trimmed)) { value = /^TRUE$/i.test(trimmed); type = 'b' }
    sheet.cells[key] = { value, type, format: existing?.format, style: existing?.style }
  }
  sheet.rowCount = Math.max(sheet.rowCount || 1, row + 1)
  sheet.colCount = Math.max(sheet.colCount || 1, col + 1)
}

// ---------------------------------------------------------------- formula engine

class FormulaError extends Error {
  code: string
  constructor(code: string) { super(code); this.code = code }
}

interface RangeValue {
  range: true
  sheet: string
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

const isRange = (value: any): value is RangeValue => Boolean(value && value.range === true)

interface EvalContext {
  workbook: WorkbookModel
  sheetName: string
  cache: Map<string, any>
  visiting: Set<string>
  warnings: Set<string>
}

const FUNCTIONS = new Set([
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'AND', 'OR', 'NOT',
  'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'SQRT', 'POWER', 'LEN', 'LEFT', 'RIGHT', 'MID',
  'CONCAT', 'CONCATENATE', 'TEXTJOIN', 'ISBLANK', 'TODAY', 'NOW', 'VLOOKUP',
])

function toNumber(value: any): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.getTime()
  const number = Number(String(value).replace(/,/g, ''))
  if (Number.isNaN(number)) throw new FormulaError('#VALUE!')
  return number
}

function toText(value: any): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function flatten(value: any, ctx: EvalContext): any[] {
  if (!isRange(value)) return [value]
  const sheet = ctx.workbook.sheets.find((item) => item.name.toLowerCase() === value.sheet.toLowerCase())
  if (!sheet) throw new FormulaError('#REF!')
  const result: any[] = []
  for (let row = value.startRow; row <= value.endRow; row += 1) {
    for (let col = value.startCol; col <= value.endCol; col += 1) {
      result.push(evalCell(sheet, row, col, ctx))
    }
  }
  return result
}

function numbers(values: any[], ctx: EvalContext): number[] {
  return values.flatMap((value) => flatten(value, ctx)).flatMap((value) => {
    if (value === null || value === undefined || value === '') return []
    if (typeof value === 'number') return [value]
    if (typeof value === 'boolean') return [value ? 1 : 0]
    return []
  })
}

function truthy(value: any): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (value === null || value === undefined) return false
  const text = toText(value).trim().toUpperCase()
  return text !== '' && text !== 'FALSE' && text !== '0'
}

function callFunction(name: string, args: any[], ctx: EvalContext): any {
  if (!FUNCTIONS.has(name)) {
    ctx.warnings.add(`不支持公式函数 ${name}`)
    throw new FormulaError('#NAME?')
  }
  const all = () => args.flatMap((value) => flatten(value, ctx))
  switch (name) {
    case 'SUM': return numbers(args, ctx).reduce((sum, value) => sum + value, 0)
    case 'AVERAGE': {
      const list = numbers(args, ctx)
      if (!list.length) throw new FormulaError('#DIV/0!')
      return list.reduce((sum, value) => sum + value, 0) / list.length
    }
    case 'MIN': {
      const list = numbers(args, ctx)
      return list.length ? Math.min(...list) : 0
    }
    case 'MAX': {
      const list = numbers(args, ctx)
      return list.length ? Math.max(...list) : 0
    }
    case 'COUNT': return numbers(args, ctx).length
    case 'COUNTA': return all().filter((value) => value !== null && value !== undefined && value !== '').length
    case 'IF': return truthy(args[0]) ? args[1] ?? '' : args[2] ?? ''
    case 'AND': return all().every(truthy)
    case 'OR': return all().some(truthy)
    case 'NOT': return !truthy(args[0])
    case 'ROUND': {
      const digits = toNumber(args[1] ?? 0)
      const factor = 10 ** digits
      return Math.round(toNumber(args[0]) * factor) / factor
    }
    case 'ROUNDUP': {
      const digits = toNumber(args[1] ?? 0)
      const factor = 10 ** digits
      return Math.ceil(toNumber(args[0]) * factor) / factor
    }
    case 'ROUNDDOWN': {
      const digits = toNumber(args[1] ?? 0)
      const factor = 10 ** digits
      return Math.floor(toNumber(args[0]) * factor) / factor
    }
    case 'ABS': return Math.abs(toNumber(args[0]))
    case 'SQRT': {
      const value = toNumber(args[0])
      if (value < 0) throw new FormulaError('#NUM!')
      return Math.sqrt(value)
    }
    case 'POWER': return toNumber(args[0]) ** toNumber(args[1])
    case 'LEN': return toText(args[0]).length
    case 'LEFT': return toText(args[0]).slice(0, Math.max(0, toNumber(args[1] ?? 1)))
    case 'RIGHT': {
      const count = Math.max(0, toNumber(args[1] ?? 1))
      const text = toText(args[0])
      return count ? text.slice(-count) : ''
    }
    case 'MID': return toText(args[0]).slice(Math.max(0, toNumber(args[1] ?? 1) - 1), Math.max(0, toNumber(args[1] ?? 1) - 1) + Math.max(0, toNumber(args[2] ?? 0)))
    case 'CONCAT':
    case 'CONCATENATE': return all().map(toText).join('')
    case 'TEXTJOIN': {
      const delimiter = toText(args[0])
      const ignoreEmpty = Boolean(args[1]) && toNumber(args[1]) !== 0
      return args.slice(2).flatMap((value) => flatten(value, ctx)).map(toText).filter((text) => !ignoreEmpty || text !== '').join(delimiter)
    }
    case 'ISBLANK': return args[0] === null || args[0] === undefined || args[0] === ''
    case 'TODAY': return new Date(new Date().toISOString().slice(0, 10))
    case 'NOW': return new Date()
    case 'VLOOKUP': {
      const needle = toText(args[0]).toLowerCase()
      const table = flatten(args[1], ctx)
      const width = isRange(args[1]) ? args[1].endCol - args[1].startCol + 1 : 1
      const index = Math.max(0, toNumber(args[2] ?? 1) - 1)
      for (let offset = 0; offset + width <= table.length; offset += width) {
        if (toText(table[offset]).toLowerCase() === needle) return table[offset + index] ?? ''
      }
      return '#N/A'
    }
    default: throw new FormulaError('#NAME?')
  }
}

function parseReference(text: string): { sheet?: string; start: [number, number]; end?: [number, number] } | null {
  const match = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*))!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?$/.exec(text)
  if (!match) return null
  const sheet = match[1] ? match[1].replace(/''/g, "'") : match[2]
  const start = parseA1(match[3])
  const end = match[4] ? parseA1(match[4]) : undefined
  if (!start || (match[4] && !end)) return null
  return { sheet, start: [start.row, start.col], end: end ? [end.row, end.col] : undefined }
}

class FormulaParser {
  private index = 0
  constructor(private text: string, private ctx: EvalContext) {}

  parse() {
    const value = this.comparison()
    this.space()
    if (this.index < this.text.length) throw new FormulaError('#VALUE!')
    return value
  }

  private space() { while (/\s/.test(this.text[this.index] || '')) this.index += 1 }
  private take(value: string) { this.space(); if (this.text.startsWith(value, this.index)) { this.index += value.length; return true } return false }

  private comparison(): any {
    let left = this.additive()
    while (true) {
      this.space()
      const operator = ['<=', '>=', '<>', '=', '<', '>'].find((item) => this.text.startsWith(item, this.index))
      if (!operator) return left
      this.index += operator.length
      const right = this.additive()
      if (operator === '=') left = toText(left).toLowerCase() === toText(right).toLowerCase()
      else if (operator === '<>') left = toText(left).toLowerCase() !== toText(right).toLowerCase()
      else {
        const a = typeof left === 'number' ? left : toText(left)
        const b = typeof right === 'number' ? right : toText(right)
        left = operator === '<' ? a < b : operator === '>' ? a > b : operator === '<=' ? a <= b : a >= b
      }
    }
  }

  private additive(): any {
    let left = this.multiplicative()
    while (true) {
      this.space()
      if (this.take('&')) left = toText(left) + toText(this.multiplicative())
      else if (this.take('+')) left = toNumber(left) + toNumber(this.multiplicative())
      else if (this.take('-')) left = toNumber(left) - toNumber(this.multiplicative())
      else return left
    }
  }

  private multiplicative(): any {
    let left = this.power()
    while (true) {
      this.space()
      if (this.take('*')) left = toNumber(left) * toNumber(this.power())
      else if (this.take('/')) {
        const right = toNumber(this.power())
        if (right === 0) throw new FormulaError('#DIV/0!')
        left = toNumber(left) / right
      } else return left
    }
  }

  private power(): any {
    let left = this.unary()
    if (this.take('^')) left = toNumber(left) ** toNumber(this.power())
    return left
  }

  private unary(): any {
    this.space()
    if (this.take('+')) return this.unary()
    if (this.take('-')) return -toNumber(this.unary())
    return this.primary()
  }

  private primary(): any {
    this.space()
    if (this.take('(')) {
      const value = this.comparison()
      if (!this.take(')')) throw new FormulaError('#VALUE!')
      return value
    }
    if (this.take('"')) {
      let value = ''
      while (this.index < this.text.length) {
        const char = this.text[this.index++]
        if (char === '"') {
          if (this.text[this.index] === '"') { value += '"'; this.index += 1; continue }
          break
        }
        value += char
      }
      return value
    }
    if (this.text[this.index] === '#') {
      const match = /^#[A-Z0-9/?!]+/.exec(this.text.slice(this.index))
      if (match) { this.index += match[0].length; throw new FormulaError(match[0]) }
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(this.text.slice(this.index))
    if (number) { this.index += number[0].length; return Number(number[0]) }
    const identifier = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*/.exec(this.text.slice(this.index))
    if (identifier) {
      const raw = identifier[0]
      const after = this.text[this.index + raw.length]
      if (after === '(') {
        this.index += raw.length
        this.take('(')
        const args: any[] = []
        if (!this.take(')')) {
          do { args.push(this.comparison()) } while (this.take(','))
          if (!this.take(')')) throw new FormulaError('#VALUE!')
        }
        return callFunction(raw.toUpperCase(), args, this.ctx)
      }
      if (/^(TRUE|FALSE)$/i.test(raw)) { this.index += raw.length; return /^TRUE$/i.test(raw) }
      const reference = this.referenceToken()
      if (reference) return reference
      throw new FormulaError('#NAME?')
    }
    const reference = this.referenceToken()
    if (reference) return reference
    throw new FormulaError('#VALUE!')
  }

  private referenceToken(): any {
    const saved = this.index
    this.space()
    const rest = this.text.slice(this.index)
    let prefix = ''
    let candidate = rest
    const quoted = /^'((?:[^']|'')+)'!/.exec(rest)
    if (quoted) {
      prefix = rest.slice(0, quoted[0].length)
      candidate = rest.slice(quoted[0].length)
    } else {
      const unquoted = /^([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*)!/.exec(rest)
      if (unquoted) {
        prefix = unquoted[0]
        candidate = rest.slice(prefix.length)
      }
    }
    const refMatch = /^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?/.exec(candidate)
    if (!refMatch) { this.index = saved; return null }
    const full = prefix + refMatch[0]
    const parsed = parseReference(full)
    if (!parsed) { this.index = saved; return null }
    this.index += full.length
    const sheetName = parsed.sheet || this.ctx.sheetName
    if (parsed.end) return { range: true, sheet: sheetName, startRow: parsed.start[0], startCol: parsed.start[1], endRow: parsed.end[0], endCol: parsed.end[1] } as RangeValue
    const sheet = this.ctx.workbook.sheets.find((item) => item.name.toLowerCase() === sheetName.toLowerCase())
    if (!sheet) throw new FormulaError('#REF!')
    return evalCell(sheet, parsed.start[0], parsed.start[1], this.ctx)
  }
}

function evalCell(sheet: SheetModel, row: number, col: number, ctx: EvalContext): any {
  const key = `${sheet.name.toLowerCase()}!${a1(row, col)}`
  if (ctx.cache.has(key)) return ctx.cache.get(key)
  if (ctx.visiting.has(key)) return '#CYCLE!'
  const cell = getCell(sheet, row, col)
  if (!cell) return ''
  if (!cell.formula) return cell.value
  ctx.visiting.add(key)
  const previousSheet = ctx.sheetName
  ctx.sheetName = sheet.name
  let value: any
  try {
    value = new FormulaParser(cell.formula, ctx).parse()
    if (value instanceof Date) value = value.toISOString().slice(0, 10)
  } catch (error) {
    if (error instanceof FormulaError) {
      value = error.code
      if (error.code === '#REF!') ctx.warnings.add('公式引用的工作表或单元格不存在')
    } else value = '#VALUE!'
  } finally {
    ctx.sheetName = previousSheet
    ctx.visiting.delete(key)
  }
  ctx.cache.set(key, value)
  return value
}

export function recalculate(workbook: WorkbookModel): { values: Record<string, any>; warnings: string[] } {
  const warnings = new Set<string>()
  const ctx: EvalContext = { workbook, sheetName: workbook.sheets[0]?.name || '', cache: new Map(), visiting: new Set(), warnings }
  const values: Record<string, any> = {}
  for (const sheet of workbook.sheets) {
    for (const [key, cell] of Object.entries(sheet.cells)) {
      if (!cell.formula) continue
      const ref = parseA1(key)
      if (!ref) continue
      const cacheKey = `${sheet.name.toLowerCase()}!${key}`
      values[`${sheet.name}!${key}`] = evalCell(sheet, ref.row, ref.col, ctx)
    }
  }
  return { values, warnings: [...warnings] }
}

// ---------------------------------------------------------------- import / export

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '') }
  catch {
    try { return new TextDecoder('gb18030').decode(buffer) }
    catch { return new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '') }
  }
}

function makeSheet(name: string, rows: any[][]): SheetModel {
  const sheet: SheetModel = { name: name.slice(0, 31) || 'Sheet1', cells: {}, rowCount: 1, colCount: 1 }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  if (rows.length > MAX_ROWS) throw new Error(`表格超过 ${MAX_ROWS.toLocaleString()} 行上限，请先拆分`)
  if (width > MAX_COLS) throw new Error(`表格超过 ${MAX_COLS} 列上限，请先拆分`)
  let cellCount = 0
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = rows[row]?.[col]
      if (value === null || value === undefined || value === '') continue
      cellCount += 1
      if (cellCount > MAX_CELLS) throw new Error(`表格超过 ${MAX_CELLS.toLocaleString()} 个单元格上限，请先拆分`)
      const text = String(value)
      const isNumber = typeof value === 'number' || (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && !/^0\d+/.test(text))
      sheet.cells[a1(row, col)] = { value: isNumber ? Number(value) : value, type: isNumber ? 'n' : 's' }
    }
  }
  sheet.rowCount = Math.max(1, rows.length)
  sheet.colCount = Math.max(1, width)
  return sheet
}

function inspectZip(bytes: Uint8Array): { external: boolean; charts: boolean; pivots: boolean; vba: boolean } {
  try {
    const files = Object.keys(unzipSync(bytes))
    return {
      external: files.some((name) => name.includes('externalLinks/')),
      charts: files.some((name) => name.includes('charts/') || name.includes('drawings/')),
      pivots: files.some((name) => name.includes('pivot')),
      vba: files.some((name) => name.includes('vbaProject.bin')),
    }
  } catch { return { external: false, charts: false, pivots: false, vba: false } }
}

export async function readWorkbookFile(file: File): Promise<WorkbookModel> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限，请先精简后再导入`)
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (ext === 'csv' || ext === 'tsv') {
    if (ext === 'tsv') {
      const text = decodeText(bytes.buffer)
      const parsed = Papa.parse<string[]>(text, { delimiter: '\t', skipEmptyLines: 'greedy' })
      if (parsed.errors.some((error) => error.type === 'Quotes')) throw new Error('TSV 引号格式不正确')
      if (!parsed.data.length) throw new Error('文件没有可读取的数据')
      return {
        fileName: file.name, sourceFormat: ext, activeSheet: 0, dirty: false,
        warnings: ['TSV 仅保留文本与数字，公式和样式不会导入'],
        sheets: [makeSheet(file.name.replace(/\.[^.]+$/, ''), parsed.data)],
      }
    }
    const text = decodeText(bytes.buffer)
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
    if (parsed.errors.some((error) => error.type === 'Quotes' || error.type === 'Delimiter')) {
      throw new Error(`CSV 解析失败：${parsed.errors[0]?.message || '格式错误'}`)
    }
    if (!parsed.data.length) throw new Error('文件没有可读取的数据')
    return {
      fileName: file.name, sourceFormat: ext, activeSheet: 0, dirty: false,
      warnings: ['CSV 仅保留文本与数字，公式、样式和其他工作表不会导入'],
      sheets: [makeSheet(file.name.replace(/\.[^.]+$/, ''), parsed.data)],
    }
  }
  if (ext === 'json') {
    let payload: any
    try { payload = JSON.parse(decodeText(bytes.buffer)) }
    catch { throw new Error('JSON 无法解析') }
    let rows: any[][]
    if (Array.isArray(payload) && payload.every((item) => item && !Array.isArray(item) && typeof item === 'object')) {
      const columns = [...new Set(payload.flatMap((item) => Object.keys(item)))]
      rows = [columns, ...payload.map((item) => columns.map((key) => {
        const value = item[key]
        if (value === null || value === undefined) return ''
        if (typeof value === 'object') return JSON.stringify(value)
        return value
      }))]
    } else if (Array.isArray(payload) && payload.every((item) => Array.isArray(item))) {
      rows = payload
    } else {
      throw new Error('JSON 需要是对象数组或二维数组')
    }
    if (rows.some((row) => row.length > MAX_COLS) || rows.length > MAX_ROWS) throw new Error('JSON 超过 10,000 行或 200 列上限')
    return {
      fileName: file.name, sourceFormat: 'json', activeSheet: 0, dirty: false,
      warnings: ['JSON 对象数组已展开；嵌套对象/数组按 JSON 文本保存，空值导入为空单元格'],
      sheets: [makeSheet(file.name.replace(/\.[^.]+$/, '') || 'JSON', rows)],
    }
  }

  const zipInfo = inspectZip(bytes)
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false, cellNF: true, cellStyles: true, sheetStubs: true, bookVBA: true })
  } catch {
    throw new Error('工作簿无法打开，文件可能损坏或加密')
  }
  if (!workbook.SheetNames?.length) throw new Error('工作簿没有工作表')
  const warnings: string[] = []
  if (zipInfo.vba) warnings.push('检测到宏/VBA，已禁用且不会导出；请勿在 Nexus 中执行宏')
  if (zipInfo.external) warnings.push('检测到外部链接，首版不会更新外部数据')
  if (zipInfo.charts) warnings.push('检测到图表或绘图对象，首版可能不保留其外观')
  if (zipInfo.pivots) warnings.push('检测到数据透视表，首版按静态单元格读取，不保留透视交互')
  let totalCells = 0
  const sheets: SheetModel[] = []
  for (const name of workbook.SheetNames) {
    const source = workbook.Sheets[name]
    if (!source) continue
    const ref = source['!ref'] ? XLSX.utils.decode_range(source['!ref']) : null
    const sheet: SheetModel = {
      name: name.slice(0, 31), cells: {}, rowCount: 1, colCount: 1,
      merges: (source['!merges'] || []).map((merge: XLSX.Range) => XLSX.utils.encode_range(merge)),
      cols: source['!cols'],
    }
    if (ref) {
      if (ref.e.r + 1 > MAX_ROWS || ref.e.c + 1 > MAX_COLS) {
        throw new Error(`工作表「${name}」超过 ${MAX_ROWS} 行或 ${MAX_COLS} 列上限`)
      }
      sheet.rowCount = ref.e.r + 1
      sheet.colCount = ref.e.c + 1
      for (let row = ref.s.r; row <= ref.e.r; row += 1) {
        for (let col = ref.s.c; col <= ref.e.c; col += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: col })
          const cell = source[address]
          if (!cell) continue
          totalCells += 1
          if (totalCells > MAX_CELLS) throw new Error(`工作簿超过 ${MAX_CELLS.toLocaleString()} 个单元格上限，请先拆分`)
          const value = cell.v
          sheet.cells[a1(row, col)] = {
            value: value instanceof Date ? value : value,
            formula: cell.f,
            type: cell.t,
            format: cell.z,
            style: cell.s,
          }
        }
      }
    }
    sheets.push(sheet)
  }
  if (!sheets.length) throw new Error('工作簿没有可读取的工作表')
  return { fileName: file.name, sourceFormat: ext || 'xlsx', sheets, activeSheet: 0, warnings, dirty: false }
}

function sheetToWorksheet(sheet: SheetModel, computed: Record<string, any>): XLSX.WorkSheet {
  const worksheet: XLSX.WorkSheet = {}
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const result = computed[`${sheet.name}!${key}`]
    const out: any = {}
    if (cell.formula) {
      out.f = cell.formula
      out.v = result === undefined ? cell.value ?? 0 : result
      out.t = typeof out.v === 'number' ? 'n' : typeof out.v === 'boolean' ? 'b' : 's'
    } else {
      out.v = cell.value
      out.t = cell.type || (typeof cell.value === 'number' ? 'n' : typeof cell.value === 'boolean' ? 'b' : cell.value instanceof Date ? 'd' : 's')
    }
    if (cell.format) out.z = cell.format
    if (cell.style) out.s = cell.style
    worksheet[key] = out
  }
  const bounds = sheetBounds(sheet)
  worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: bounds.rowCount - 1, c: bounds.colCount - 1 } })
  if (sheet.merges?.length) worksheet['!merges'] = sheet.merges.map((range) => XLSX.utils.decode_range(range))
  if (sheet.cols?.length) worksheet['!cols'] = sheet.cols
  return worksheet
}

export function exportWorkbook(workbook: WorkbookModel, fileName?: string): Blob {
  const values = recalculate(workbook).values
  const output = XLSX.utils.book_new()
  for (const sheet of workbook.sheets) {
    XLSX.utils.book_append_sheet(output, sheetToWorksheet(sheet, values), sheet.name.slice(0, 31) || 'Sheet')
  }
  const array = XLSX.write(output, { bookType: 'xlsx', type: 'array', cellStyles: true })
  return new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function sheetAsDelimited(workbook: WorkbookModel, sheetIndex: number, delimiter: ',' | '\t'): string {
  const sheet = workbook.sheets[sheetIndex]
  if (!sheet) throw new Error('工作表不存在')
  const values = recalculate(workbook).values
  const bounds = sheetBounds(sheet)
  const rows: string[][] = []
  for (let row = 0; row < bounds.rowCount; row += 1) {
    const line: string[] = []
    for (let col = 0; col < bounds.colCount; col += 1) {
      const key = a1(row, col)
      const cell = sheet.cells[key]
      const text = cell ? cellDisplay({ ...cell, formula: cell.formula }, values[`${sheet.name}!${key}`]) : ''
      line.push(/^[=+\-@]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text) ? `'${text}` : text)
    }
    rows.push(line)
  }
  if (delimiter === '\t') return rows.map((row) => row.map((value) => value.replace(/\t/g, ' ')).join('\t')).join('\r\n')
  return Papa.unparse(rows, { delimiter })
}

export function sheetAsJson(workbook: WorkbookModel, sheetIndex: number, header = true): string {
  const sheet = workbook.sheets[sheetIndex]
  if (!sheet) throw new Error('工作表不存在')
  const values = recalculate(workbook).values
  const bounds = sheetBounds(sheet)
  const rows = Array.from({ length: bounds.rowCount }, (_, row) => Array.from({ length: bounds.colCount }, (_, col) => {
    const key = a1(row, col)
    const cell = sheet.cells[key]
    return cell ? cellDisplay(cell, values[`${sheet.name}!${key}`]) : ''
  }))
  if (!header) return JSON.stringify(rows, null, 2)
  const columns = rows[0].map((value, index) => value || colName(index))
  return JSON.stringify(rows.slice(1).map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? '']))), null, 2)
}

export function addSheet(workbook: WorkbookModel, name?: string): WorkbookModel {
  const next = cloneWorkbook(workbook)
  let base = (name || 'Sheet').slice(0, 31)
  let index = 2
  while (next.sheets.some((sheet) => sheet.name === base)) { base = `${(name || 'Sheet').slice(0, 28)} ${index++}` }
  next.sheets.push({ name: base, cells: {}, rowCount: 20, colCount: 10 })
  next.activeSheet = next.sheets.length - 1
  next.dirty = true
  return next
}

export function renameSheet(workbook: WorkbookModel, index: number, name: string): WorkbookModel {
  const next = cloneWorkbook(workbook)
  const sheet = next.sheets[index]
  if (!sheet) throw new Error('工作表不存在')
  const clean = name.trim().slice(0, 31)
  if (!clean) throw new Error('工作表名称不能为空')
  if (next.sheets.some((item, itemIndex) => itemIndex !== index && item.name.toLowerCase() === clean.toLowerCase())) throw new Error('工作表名称重复')
  const oldName = sheet.name
  const token = (value: string) => /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*$/.test(value)
    ? value
    : `'${value.replace(/'/g, "''")}'`
  const oldToken = token(oldName)
  const newToken = token(clean)
  const quotedOld = `'${oldName.replace(/'/g, "''")}'`
  const escapedOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const item of next.sheets) {
    for (const cell of Object.values(item.cells)) {
      if (!cell.formula) continue
      let formula = cell.formula
      formula = formula.split(`${quotedOld}!`).join(`${newToken}!`)
      if (oldToken === oldName) formula = formula.replace(new RegExp(`\\b${escapedOld}!`, 'gi'), `${newToken}!`)
      cell.formula = formula
    }
  }
  sheet.name = clean
  next.dirty = true
  return next
}

export function deleteSheet(workbook: WorkbookModel, index: number): WorkbookModel {
  if (workbook.sheets.length <= 1) throw new Error('至少保留一个工作表')
  const next = cloneWorkbook(workbook)
  next.sheets.splice(index, 1)
  next.activeSheet = Math.max(0, Math.min(next.activeSheet, next.sheets.length - 1))
  next.dirty = true
  return next
}

export function insertRow(sheet: SheetModel, at: number): void {
  const next: Record<string, CellData> = {}
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const ref = parseA1(key)
    if (!ref) continue
    next[ref.row >= at ? a1(ref.row + 1, ref.col) : key] = cell
  }
  sheet.cells = next
  sheet.rowCount += 1
}

export function deleteRow(sheet: SheetModel, at: number): void {
  const next: Record<string, CellData> = {}
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const ref = parseA1(key)
    if (!ref || ref.row === at) continue
    next[ref.row > at ? a1(ref.row - 1, ref.col) : key] = cell
  }
  sheet.cells = next
  sheet.rowCount = Math.max(1, sheet.rowCount - 1)
}

export function insertColumn(sheet: SheetModel, at: number): void {
  const next: Record<string, CellData> = {}
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const ref = parseA1(key)
    if (!ref) continue
    next[ref.col >= at ? a1(ref.row, ref.col + 1) : key] = cell
  }
  sheet.cells = next
  sheet.colCount += 1
}

export function deleteColumn(sheet: SheetModel, at: number): void {
  const next: Record<string, CellData> = {}
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const ref = parseA1(key)
    if (!ref || ref.col === at) continue
    next[ref.col > at ? a1(ref.row, ref.col - 1) : key] = cell
  }
  sheet.cells = next
  sheet.colCount = Math.max(1, sheet.colCount - 1)
}

export function findAndReplace(sheet: SheetModel, find: string, replace: string, allSheets: boolean, workbook: WorkbookModel): WorkbookModel {
  const next = cloneWorkbook(workbook)
  let count = 0
  for (const target of allSheets ? next.sheets : [next.sheets[next.activeSheet]]) {
    for (const cell of Object.values(target.cells)) {
      if (cell.formula) {
        if (cell.formula.includes(find)) { cell.formula = cell.formula.split(find).join(replace); count += 1 }
      } else if (String(cell.value ?? '').includes(find)) {
        cell.value = String(cell.value ?? '').split(find).join(replace)
        count += 1
      }
    }
  }
  if (!count) throw new Error('没有找到匹配内容')
  next.dirty = true
  return next
}
