import type { ComponentType } from 'react'
import {
  Calendar, Collection, DashboardIcon, Document, Link, Memo, Picture, Todo, Translate,
} from '@/icons'

export interface SidebarData {
  checkinTargets: any[]
  tables: any[]
  dashboards: any[]
  todoLists: any[]
  noteFolders: any[]
  uncategorizedCount: number
  memoCategories: string[]
  bookmarkCategories: string[]
}

export interface NavItem { label: string; path: string; count?: number; targetId?: number }

export interface NavGroup {
  key: string
  label: string
  path: string
  icon: ComponentType<any>
  createLabel: string
  items: NavItem[]
}

export function buildGroups(data: SidebarData): NavGroup[] {
  return [
    {
      key: 'checkin', label: '打卡', path: '/checkins', icon: Calendar, createLabel: '新建打卡项目',
      items: data.checkinTargets.map((target) => ({ label: target.name, path: `/checkins/items/${target.id}`, targetId: target.id })),
    },
    {
      key: 'visualizations', label: '数据可视化', path: '/visualizations', icon: DashboardIcon, createLabel: '新建看板',
      items: data.dashboards.map((board) => ({ label: board.name, path: `/visualizations/${board.id}` })),
    },
    {
      key: 'data', label: '表格', path: '/data', icon: Collection, createLabel: '新建表格',
      items: data.tables.map((table) => ({ label: table.name, path: `/data/${table.id}` })),
    },
    {
      key: 'todos', label: '待办', path: '/todos', icon: Todo, createLabel: '新建清单',
      items: data.todoLists.map((list) => ({ label: list.name, path: `/todos/${list.id}`, count: list.pending })),
    },
    {
      key: 'notes', label: '笔记', path: '/notes', icon: Document, createLabel: '新建文件夹',
      items: [
        { label: '未分类', path: '/notes/uncategorized', count: data.uncategorizedCount },
        ...data.noteFolders.map((folder) => ({ label: folder.name, path: `/notes/${folder.id}`, count: folder.note_count })),
      ],
    },
    {
      key: 'memos', label: '便利贴', path: '/memos', icon: Memo, createLabel: '新建分类',
      items: [
        { label: '未分类', path: '/memos?uncategorized=1' },
        ...data.memoCategories.map((name) => ({ label: name, path: `/memos?category=${encodeURIComponent(name)}` })),
      ],
    },
    {
      key: 'bookmarks', label: '网址导航', path: '/bookmarks', icon: Link, createLabel: '新建网址分类',
      items: [
        { label: '未分类', path: '/bookmarks?category=__none' },
        ...data.bookmarkCategories.map((name) => ({ label: name, path: `/bookmarks?category=${encodeURIComponent(name)}` })),
      ],
    },
  ]
}

export const toolItems = [
  { key: 'translate', label: '翻译', path: '/translate', icon: Translate },
  { key: 'images', label: '图片处理', path: '/images', icon: Picture },
]

export const groupByKey = (groups: NavGroup[], key: string) => groups.find((group) => group.key === key)

export function activeGroupKey(pathname: string, groups: NavGroup[]) {
  return groups.find((group) => pathname === group.path || pathname.startsWith(group.path + '/'))?.key
}
