import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Divider, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery,
} from '@mui/material'
import { Delete, InfoFilled, Lock, Menu, Moon, Palette, Search, Sunny, Todo, Translate, Tune } from '@/icons'
import BackupIcon from '@mui/icons-material/Backup'
import SpeedIcon from '@mui/icons-material/Speed'
import { apiError } from '@/api/client'
import { setTheme, setThemeColor, useSession } from '@/session'
import { Card, AgentsSection, AiSection, SystemSection, TranslationSection } from './SettingsSections'
import ContentDisplaySection from './settings/ContentDisplaySection'
import NavigationSection from './settings/NavigationSection'
import SecuritySection from './settings/SecuritySection'
import TrashView from './Trash'

const groups = [
  {
    name: '偏好',
    items: [
      { key: 'appearance', label: '外观', icon: Palette, description: '调整工作台的明暗主题和强调色。', keywords: '主题 深色 浅色 颜色 强调色 外观 色板' },
      { key: 'content', label: '内容显示', icon: Tune, description: '设置表格、便利贴、笔记和看板的默认显示方式。', keywords: '表格 行高 斑马纹 居中 每页 便利贴 列数 笔记 宽度 看板 卡片 列表 视图 默认' },
      { key: 'navigation', label: '导航', icon: Menu, description: '设置侧栏宽窄，管理固定项和顺序。', keywords: '侧栏 导航 宽窄 固定 排序 顺序 菜单 全部功能' },
    ],
  },
  {
    name: '服务与连接',
    items: [
      { key: 'ai', label: 'AI 能力', icon: InfoFilled, description: '配置智谱模型，用于 AI 填表和 AI 生成看板图表。', keywords: 'GLM OCR 视觉 文本 图片 识别 看板 图表 API Key 模型' },
      { key: 'translation', label: '翻译服务', icon: Translate, description: '配置、启用和测试翻译服务，密钥留空时保留原有值。', keywords: '百度 有道 DeepSeek 智谱 密钥 模型 翻译 字号 服务' },
      { key: 'agents', label: 'Agent 接入', icon: Todo, description: '管理自动化助手的访问权限和写入记录。', keywords: '令牌 API token 自动化 权限 暂存 审核 活动' },
    ],
  },
  {
    name: '数据',
    items: [
      { key: 'backup', label: '备份与恢复', icon: BackupIcon, description: '创建完整备份、下载恢复密钥并校验备份完整性。', keywords: '备份 恢复 密钥 下载 校验 自动备份 频率 保留' },
      { key: 'trash', label: '回收站', icon: Delete, description: '恢复误删内容，或清理不再需要的数据。', keywords: '删除 恢复 清理 数据 回收站' },
    ],
  },
  {
    name: '系统',
    items: [
      { key: 'runtime', label: '运行状态', icon: SpeedIcon, description: '查看服务器 CPU、内存、磁盘、网络和健康状态。', keywords: 'CPU 内存 磁盘 网络 负载 监控 健康 运行 状态' },
      { key: 'security', label: '登录与安全', icon: Lock, description: '修改登录密码，退出当前设备。', keywords: '密码 登录 安全 退出 会话 设备' },
    ],
  },
]
const allItems = groups.flatMap((group) => group.items)

export default function SettingsPage({ section: explicitSection }: { section?: string }) {
  const params = useParams()
  const navigate = useNavigate()
  const section = explicitSection || params.section || 'appearance'
  const canonical = section === 'account' ? 'security' : section === 'system' ? 'backup' : section
  const current = allItems.find((item) => item.key === canonical) || allItems[0]
  const [search, setSearch] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobile = useMediaQuery('(max-width:899.95px)')
  const [feedback, setFeedback] = useState('')
  const [feedbackError, setFeedbackError] = useState(false)
  const notify = (message: string, error = false) => { setFeedback(message); setFeedbackError(error) }

  useEffect(() => {
    if (section === 'account') navigate('/settings/security', { replace: true })
    if (section === 'system') navigate('/settings/backup', { replace: true })
  }, [section, navigate])

  const filtered = useMemo(() => allItems.filter((item) => (item.label + item.keywords).toLowerCase().includes(search.trim().toLowerCase())), [search])

  const nav = (compact = false) => (
    <Box sx={{ p: compact ? 2 : { xs: 2, md: '20px 12px' }, minWidth: 0 }}>
      <TextField
        fullWidth size="small" value={search} placeholder="搜索设置" aria-label="搜索设置"
        onChange={(event) => setSearch(event.target.value)}
        InputProps={{ startAdornment: <Search sx={{ fontSize: 17, mr: 0.5, color: 'text.secondary' }} /> }}
        sx={{ mb: 1 }}
      />
      {groups.map((group) => {
        const items = filtered.filter((item) => group.items.some((entry) => entry.key === item.key))
        if (!items.length) return null
        return (
          <Box key={group.name} sx={{ mt: 1.75 }}>
            <Typography variant="overline" color="text.secondary" sx={{ px: 1.5, display: 'block' }}>{group.name}</Typography>
            <List disablePadding>
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <ListItemButton
                    key={item.key}
                    selected={canonical === item.key}
                    onClick={() => {
                      navigate(item.key === 'appearance' ? '/settings' : `/settings/${item.key}`)
                      if (compact) setMobileNavOpen(false)
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}><Icon sx={{ fontSize: 20 }} /></ListItemIcon>
                    <ListItemText primary={item.label} primaryTypographyProps={{ variant: 'body2' }} />
                  </ListItemButton>
                )
              })}
            </List>
          </Box>
        )
      })}
      {!filtered.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary', p: 1 }}>没有匹配的设置</Typography> : null}
    </Box>
  )

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '210px minmax(0,1fr)' }, minHeight: 'calc(100vh - 44px)', width: '100%' }}>
      {!mobile ? <Box component="aside" aria-label="设置分类" sx={{ borderRight: 1, borderColor: 'divider', minWidth: 0 }}>
        <Box sx={{ position: 'sticky', top: 0, maxHeight: 'calc(100vh - 44px)', overflowY: 'auto' }}>{nav()}</Box>
      </Box> : null}

      <Box component="main" sx={{ p: { xs: 2, md: '24px 28px' }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Box>
            <Typography variant="h5" sx={{ mb: 0.75 }}>{current.label}</Typography>
            <Typography variant="body2" color="text.secondary">{current.description}</Typography>
          </Box>
          <Button size="small" startIcon={<Menu />} aria-label="打开设置目录" onClick={() => setMobileNavOpen(true)} sx={{ display: mobile ? 'inline-flex' : 'none', flexShrink: 0 }}>
            目录
          </Button>
        </Stack>
        {feedback ? <Alert severity={feedbackError ? 'error' : 'success'} onClose={() => setFeedback('')}>{feedback}</Alert> : null}

        {canonical === 'appearance' ? <AppearanceSection notify={notify} /> : null}
        {canonical === 'content' ? <ContentDisplaySection /> : null}
        {canonical === 'navigation' ? <NavigationSection /> : null}
        {canonical === 'agents' ? <AgentsSection /> : null}
        {canonical === 'ai' ? <AiSection notify={notify} /> : null}
        {canonical === 'translation' ? <TranslationSection /> : null}
        {canonical === 'trash' ? <TrashView embedded /> : null}
        {canonical === 'backup' ? <SystemSection part="backup" /> : null}
        {canonical === 'runtime' ? <SystemSection part="runtime" /> : null}
        {canonical === 'security' ? <SecuritySection notify={notify} /> : null}
      </Box>

      {mobile ? <Drawer anchor="left" open={mobileNavOpen} onClose={() => setMobileNavOpen(false)}>
        <Box sx={{ width: 300 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, pt: 2 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>设置</Typography>
            <Button size="small" onClick={() => setMobileNavOpen(false)}>关闭</Button>
          </Stack>
          <Divider sx={{ mt: 1 }} />
          {nav(true)}
        </Box>
      </Drawer> : null}
    </Box>
  )
}

function AppearanceSection({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const session = useSession()
  const changeTheme = async (value: 'light' | 'dark') => {
    try { await setTheme(value); notify('主题已保存到账号。') }
    catch (error) { notify(apiError(error).message + '，已恢复原主题。', true) }
  }
  const changeColor = async (value: string) => {
    try { await setThemeColor(value); notify('强调色已保存到账号。') }
    catch (error) { notify(apiError(error).message + '，已恢复原强调色。', true) }
  }
  const presets = ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#be123c', '#475569']
  return (
    <Stack spacing={2}>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>界面主题</Typography>
        <ToggleButtonGroup
          size="small" exclusive value={session.theme} disabled={session.appearanceSaving}
          onChange={(_, value) => value && void changeTheme(value)}
        >
          <ToggleButton value="light"><Sunny sx={{ mr: 1 }} />浅色</ToggleButton>
          <ToggleButton value="dark"><Moon sx={{ mr: 1 }} />深色</ToggleButton>
        </ToggleButtonGroup>
      </Card>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>强调色</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>用于主按钮、选中状态和导航高亮。</Typography>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {presets.map((color) => (
            <Box
              key={color}
              component="button"
              type="button"
              aria-label={`使用强调色 ${color}`}
              onClick={() => void changeColor(color)}
              sx={{
                width: 28, height: 28, p: 0, borderRadius: '50%', bgcolor: color, cursor: 'pointer',
                border: 2, borderColor: session.themeColor.toLowerCase() === color ? 'text.primary' : 'transparent',
                outline: '1px solid', outlineColor: 'divider',
              }}
            />
          ))}
          <Box component="input" type="color" aria-label="自定义强调色" value={session.themeColor} disabled={session.appearanceSaving}
            onChange={(event) => void changeColor(event.target.value)}
            sx={{ width: 38, height: 30, p: 0, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'monospace' }}>{session.themeColor}</Typography>
        </Stack>
      </Card>
    </Stack>
  )
}
