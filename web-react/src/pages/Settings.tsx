import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import { ArrowLeft, ArrowRight, Delete, InfoFilled, Lock, Menu, Moon, Palette, Search, Sunny, Todo, Translate, Tune } from '@/icons'
import BackupIcon from '@mui/icons-material/Backup'
import BugReportIcon from '@mui/icons-material/BugReport'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import SpeedIcon from '@mui/icons-material/Speed'
import { apiError } from '@/api/client'
import { setTheme, useSession } from '@/session'
import { MOTION_SPEED_OPTIONS, readMotionSpeed, writeMotionSpeed, type MotionSpeed } from '@/motion'
import { useReducedMotion } from 'framer-motion'
import { Card, AgentsSection, AiSection, SystemSection, TranslationSection } from './SettingsSections'
import ContentDisplaySection from './settings/ContentDisplaySection'
import FeedbackSection from './settings/FeedbackSection'
import LogsSection from './settings/LogsSection'
import NavigationSection from './settings/NavigationSection'
import SecuritySection from './settings/SecuritySection'
import TrashView from './Trash'

const groups = [
  {
    name: '偏好',
    items: [
      { key: 'appearance', label: '外观', icon: Palette, description: '调整工作台的明暗主题。', keywords: '主题 深色 浅色 颜色 外观' },
      { key: 'content', label: '内容显示', icon: Tune, description: '设置表格、便利贴、笔记和看板的默认显示方式。', keywords: '表格 行高 斑马纹 居中 每页 便利贴 列数 笔记 宽度 看板 卡片 列表 视图 默认' },
      { key: 'navigation', label: '导航', icon: Menu, description: '设置侧栏宽窄，浏览全部功能，管理固定项和顺序。', keywords: '侧栏 导航 宽窄 固定 排序 顺序 菜单 全部功能' },
    ],
  },
  {
    name: '服务与连接',
    items: [
      { key: 'ai', label: 'AI 能力', icon: InfoFilled, description: '配置智谱模型，用于 AI 填表和 AI 生成看板图表。', keywords: 'GLM OCR 视觉 文本 图片 识别 看板 图表 API Key 模型' },
      { key: 'translation', label: '翻译服务', icon: Translate, description: '配置、启用和测试翻译服务，密钥留空时保留原有值。', keywords: '百度 有道 DeepSeek 智谱 密钥 模型 翻译 字号 服务' },
      { key: 'agents', label: 'Agent 接入', icon: Todo, description: '让 Agent 直接接管工作台，记录每次操作并支持撤销。', keywords: '令牌 API token 自动化 权限 直接写入 撤销 暂存 审核 活动' },
      { key: 'feedback', label: '问题反馈', icon: BugReportIcon, description: '连接 GitHub 仓库，把浏览器里提交的 Bug 和需求直接变成 Issue。', keywords: 'GitHub Issue 反馈 Bug 需求 令牌 仓库 标签' },
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
      { key: 'logs', label: '运行日志', icon: ReceiptLongIcon, description: '检索后端、请求、后台任务和浏览器上报的运行日志。', keywords: '日志 报错 异常 错误 请求 堆栈 排查 运行 检索' },
      { key: 'security', label: '登录与安全', icon: Lock, description: '修改登录密码，退出当前设备。', keywords: '密码 登录 安全 退出 会话 设备' },
    ],
  },
]
const allItems = groups.flatMap((group) => group.items)

export default function SettingsPage({ section: explicitSection }: { section?: string }) {
  const params = useParams()
  const navigate = useNavigate()
  const session = useSession()
  const section = explicitSection || params.section || 'appearance'
  const canonical = section === 'account' ? 'security' : section === 'system' ? 'backup' : section
  const current = allItems.find((item) => item.key === canonical) || allItems[0]
  const [search, setSearch] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobile = useMediaQuery('(max-width:899.95px)')
  const reduceMotion = useReducedMotion()
  const navKey = `wb_settings_nav_${session.user?.id || 'guest'}`
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem(navKey) === '1')
  const [feedback, setFeedback] = useState('')
  const [feedbackError, setFeedbackError] = useState(false)
  const notify = (message: string, error = false) => { setFeedback(message); setFeedbackError(error) }

  useEffect(() => {
    setNavCollapsed(localStorage.getItem(navKey) === '1')
  }, [navKey])

  useEffect(() => {
    if (section === 'account') navigate('/settings/security', { replace: true })
    if (section === 'system') navigate('/settings/backup', { replace: true })
  }, [section, navigate])

  const toggleNav = () => {
    setNavCollapsed((value) => {
      const next = !value
      localStorage.setItem(navKey, next ? '1' : '0')
      return next
    })
  }

  const goBack = () => {
    const index = Number(window.history.state?.idx)
    if (Number.isFinite(index) && index > 0) navigate(-1)
    else navigate('/')
  }

  const filtered = useMemo(() => allItems.filter((item) => (item.label + item.keywords).toLowerCase().includes(search.trim().toLowerCase())), [search])

  const collapsedNav = (
    <Box sx={{ py: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
      <Tooltip title="展开设置目录" placement="right">
        <IconButton size="small" aria-label="展开设置目录" aria-expanded={false} onClick={toggleNav}>
          <ArrowRight sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      {groups.map((group, groupIndex) => (
        <Box key={group.name} sx={{ width: '100%' }}>
          {group.items.map((item) => {
            const Icon = item.icon
            return (
              <Tooltip key={item.key} title={item.label} placement="right">
                <ListItemButton
                  selected={canonical === item.key}
                  aria-label={item.label}
                  onClick={() => navigate(item.key === 'appearance' ? '/settings' : `/settings/${item.key}`)}
                  sx={{ justifyContent: 'center', px: 0, minHeight: 38 }}
                >
                  <ListItemIcon sx={{ minWidth: 0, justifyContent: 'center' }}><Icon sx={{ fontSize: 20 }} /></ListItemIcon>
                </ListItemButton>
              </Tooltip>
            )
          })}
          {groupIndex < groups.length - 1 ? <Divider sx={{ mx: 1.5, my: 0.5 }} /> : null}
        </Box>
      ))}
    </Box>
  )

  const nav = (compact = false, collapsed = false) => {
    if (collapsed) return collapsedNav
    return (
    <Box sx={{ p: compact ? 2 : { xs: 2, md: '20px 12px' }, minWidth: 0 }}>
      {!compact ? (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>设置</Typography>
          <Tooltip title="收起设置目录">
            <IconButton size="small" aria-label="收起设置目录" aria-expanded onClick={toggleNav}>
              <ArrowLeft sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : null}
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
  }

  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: mobile ? '1fr' : `${navCollapsed ? 64 : 210}px minmax(0,1fr)`,
      transition: reduceMotion ? 'none' : 'grid-template-columns 160ms ease',
      minHeight: 'calc(100vh - 44px)', width: '100%',
    }}>
      {!mobile ? <Box component="aside" aria-label={navCollapsed ? '设置分类（已收起）' : '设置分类'} sx={{ borderRight: 1, borderColor: 'divider', minWidth: 0, overflow: 'hidden' }}>
        <Box sx={{ position: 'sticky', top: 0, maxHeight: 'calc(100vh - 44px)', overflowY: 'auto', overflowX: 'hidden' }}>{nav(false, navCollapsed)}</Box>
      </Box> : null}

      <Box component="main" sx={{ p: { xs: 2, md: '24px 28px' }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
            <Button size="small" startIcon={<ArrowLeft />} aria-label="返回上一页" onClick={goBack} sx={{ flexShrink: 0, mt: 0.25 }}>
              返回
            </Button>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" sx={{ mb: 0.75 }}>{current.label}</Typography>
              <Typography variant="body2" color="text.secondary">{current.description}</Typography>
            </Box>
          </Stack>
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
        {canonical === 'feedback' ? <FeedbackSection /> : null}
        {canonical === 'logs' ? <LogsSection /> : null}
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
  const [motionSpeed, setMotionSpeed] = useState<MotionSpeed>(() => readMotionSpeed())
  const changeTheme = async (value: 'light' | 'dark') => {
    try { await setTheme(value); notify('主题已保存到账号。') }
    catch (error) { notify(apiError(error).message + '，已恢复原主题。', true) }
  }
  const changeMotionSpeed = (value: MotionSpeed) => {
    setMotionSpeed(value)
    writeMotionSpeed(value)
    notify(`动效速度已改为「${MOTION_SPEED_OPTIONS.find((item) => item.value === value)?.label}」。`)
  }
  const motionHint = MOTION_SPEED_OPTIONS.find((item) => item.value === motionSpeed)?.hint
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
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>动效速度</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.25 }}>
          控制页面切换、卡片、抽屉、弹窗等过渡的快慢。觉得画面抖动时选「关闭」最稳。
        </Typography>
        <ToggleButtonGroup
          size="small" exclusive value={motionSpeed}
          onChange={(_, value: MotionSpeed | null) => value && changeMotionSpeed(value)}
        >
          {MOTION_SPEED_OPTIONS.map((option) => (
            <ToggleButton key={option.value} value={option.value}>{option.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.25 }}>{motionHint}</Typography>
      </Card>
    </Stack>
  )
}
