import type { ComponentType } from 'react'
import {
  Brush, Calendar, Collection, DashboardIcon, Document, Files, Link, Memo,
  Palette, Picture, QrCodeIcon, Switch, Todo, Translate,
} from '@/icons'

export type AppNavGroup = 'work' | 'content' | 'info' | 'tools'

export interface AppNavItem {
  key: string
  label: string
  path: string
  icon: ComponentType<any>
  group: AppNavGroup
}

export const APP_NAV_GROUPS: Array<{ key: AppNavGroup; label: string }> = [
  { key: 'work', label: '工作台' },
  { key: 'content', label: '内容' },
  { key: 'info', label: '信息' },
  { key: 'tools', label: '工具' },
]

export const APP_NAV_ITEMS: AppNavItem[] = [
  { key: 'checkin', label: '打卡', path: '/checkins', icon: Calendar, group: 'work' },
  { key: 'data', label: '表格', path: '/data', icon: Collection, group: 'content' },
  { key: 'todos', label: '待办', path: '/todos', icon: Todo, group: 'work' },
  { key: 'notes', label: '笔记', path: '/notes', icon: Document, group: 'content' },
  { key: 'memos', label: '便利贴', path: '/memos', icon: Memo, group: 'content' },
  { key: 'visualizations', label: '看板', path: '/visualizations', icon: DashboardIcon, group: 'work' },
  { key: 'docs', label: '文档工作台', path: '/docs', icon: Files, group: 'content' },
  { key: 'bookmarks', label: '网址', path: '/bookmarks', icon: Link, group: 'info' },
  { key: 'translate', label: '翻译', path: '/translate', icon: Translate, group: 'info' },
  { key: 'images', label: '图片处理', path: '/images', icon: Picture, group: 'tools' },
  { key: 'convert', label: '格式转换', path: '/convert', icon: Switch, group: 'tools' },
  { key: 'color', label: '取色对比', path: '/color', icon: Palette, group: 'tools' },
  { key: 'codes', label: '二维码条码', path: '/codes', icon: QrCodeIcon, group: 'tools' },
  { key: 'whiteboards', label: '白板', path: '/whiteboards', icon: Brush, group: 'content' },
]

export const APP_NAV_KEYS = APP_NAV_ITEMS.map((item) => item.key)

export const DEFAULT_PINNED_KEYS = [
  'checkin',
  'data',
  'todos',
  'notes',
  'memos',
  'visualizations',
  'docs',
]

export const appNavItem = (key: string) => APP_NAV_ITEMS.find((item) => item.key === key)
