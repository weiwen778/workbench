import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Checkbox, FormControlLabel, List, ListItemButton, ListItemIcon, ListItemText,
  MenuItem, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import {
  Check, Delete, InfoFilled, Menu, Moon, Search, Setting, Sunny, Todo, Translate,
} from '@/icons'
import { apiError, copyText, http } from '@/api/client'
import { logout, setCheckinLabel, setTheme, setThemeColor, useSession } from '@/session'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { FieldRow } from '@/ui/common'
import TrashView from './Trash'
import { AgentsSection, AiSection, Card, SystemSection, TranslationSection } from './SettingsSections'
import { readTranslationPreferences, type TranslationPreferences } from '@/utils/translation-preferences'

const groups = [
  {
    name: '偏好设置',
    items: [
      { key: 'appearance', label: '外观', icon: Sunny, description: '调整工作台的明暗主题和强调色。', keywords: '主题 深色 浅色 颜色 强调色' },
      { key: 'navigation', label: '导航与命名', icon: Menu, description: '修改两类打卡在侧栏和页面中的名称。', keywords: '打卡 店铺 社媒 命名 导航' },
    ],
  },
  {
    name: '账号与连接',
    items: [
      { key: 'ai', label: 'AI 能力', icon: InfoFilled, description: '配置智谱模型，用于 AI 填表和 AI 生成看板图表。', keywords: 'GLM OCR 视觉 文本 图片 识别 看板 图表 API Key' },
      { key: 'account', label: '账号与安全', icon: Setting, description: '管理登录密码和当前设备的登录状态。', keywords: '密码 用户名 退出 登录' },
      { key: 'agents', label: 'Agent 接入', icon: Todo, description: '管理自动化助手的访问权限和写入记录。', keywords: '令牌 API token 自动化 权限' },
      { key: 'translation', label: '翻译服务', icon: Translate, description: '配置、启用和测试翻译服务，密钥留空时保留原有值。', keywords: '百度 有道 DeepSeek 密钥 模型' },
    ],
  },
  {
    name: '数据与维护',
    items: [
      { key: 'trash', label: '回收站', icon: Delete, description: '恢复误删内容，或清理不再需要的数据。', keywords: '删除 恢复 清理 数据' },
      { key: 'system', label: '系统与备份', icon: InfoFilled, description: '查看服务器 CPU、内存、磁盘、网络、运行状态与备份。', keywords: 'CPU 内存 磁盘 网络 负载 监控 健康 时区 隐私 状态 备份 恢复' },
    ],
  },
]
const allItems = groups.flatMap((group) => group.items)

export default function SettingsPage({ section: explicitSection }: { section?: string }) {
  const params = useParams()
  const navigate = useNavigate()
  const session = useSession()
  const section = explicitSection || params.section || 'appearance'
  const current = allItems.find((item) => item.key === section) || allItems[0]
  const [search, setSearch] = useState('')
  const [feedback, setFeedback] = useState('')
  const [feedbackError, setFeedbackError] = useState(false)

  const notify = (message: string, error = false) => { setFeedback(message); setFeedbackError(error) }

  const filtered = useMemo(() => allItems.filter((item) => (item.label + item.keywords).toLowerCase().includes(search.trim().toLowerCase())), [search])

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '200px minmax(0,1fr)' }, minHeight: 'calc(100vh - 44px)', width: '100%' }}>
      <Box component="aside" aria-label="设置分类" sx={{ borderRight: { md: (theme) => `1px solid ${theme.palette.divider}` }, borderBottom: { xs: (theme) => `1px solid ${theme.palette.divider}`, md: 0 }, borderColor: 'divider', minWidth: 0 }}>
        <Box sx={{ p: { xs: 2, md: '24px 14px' }, position: { md: 'sticky' }, top: 0, maxHeight: { md: 'calc(100vh - 44px)' }, overflowY: { md: 'auto' } }}>
          <TextField fullWidth size="small" value={search} placeholder="搜索设置" aria-label="搜索设置" onChange={(event) => setSearch(event.target.value)} InputProps={{ startAdornment: <Search sx={{ fontSize: 17, mr: 0.5, color: 'text.secondary' }} /> }} sx={{ mb: 1 }} />
          {groups.map((group) => {
            const items = filtered.filter((item) => group.items.some((entry) => entry.key === item.key))
            if (!items.length) return null
            return (
              <Box key={group.name} sx={{ mt: 2 }}>
                <Typography variant="overline" color="text.secondary" sx={{ px: 2, display: 'block' }}>{group.name}</Typography>
                <List disablePadding>
                  {items.map((item) => {
                    const Icon = item.icon
                    return (
                      <ListItemButton
                        key={item.key}
                        selected={section === item.key}
                        onClick={() => navigate(item.key === 'appearance' ? '/settings' : `/settings/${item.key}`)}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}><Icon /></ListItemIcon>
                        <ListItemText primary={item.label} primaryTypographyProps={{ variant: 'body2' }} />
                      </ListItemButton>
                    )
                  })}
                </List>
              </Box>
            )
          })}
          {!filtered.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary', p: 1 }}>没有匹配的设置</Typography> : null}
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ borderTop: 1, borderColor: 'divider', pt: 2.25, mt: 2.75, px: 1 }}>
            <Box sx={{ width: 32, height: 32, borderRadius: 1, bgcolor: 'action.hover', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 600 }}>{session.user?.username?.slice(0, 1).toUpperCase()}</Box>
            <Box><Typography sx={{ fontSize: 13, fontWeight: 500 }}>{session.user?.username}</Typography><Typography sx={{ fontSize: 12, color: 'text.secondary' }}>个人工作台</Typography></Box>
          </Stack>
        </Box>
      </Box>

      <Box component="main" sx={{ p: { xs: 2, md: '24px 28px' }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 1 }}>{current.label}</Typography>
          <Typography variant="body2" color="text.secondary">{current.description}</Typography>
        </Box>
        {feedback ? <Alert severity={feedbackError ? 'error' : 'success'} onClose={() => setFeedback('')}>{feedback}</Alert> : null}

        {section === 'appearance' ? <AppearanceSection notify={notify} /> : null}
        {section === 'navigation' ? <NavigationSection notify={notify} /> : null}
        {section === 'account' ? <AccountSection notify={notify} /> : null}
        {section === 'agents' ? <AgentsSection /> : null}
        {section === 'ai' ? <AiSection notify={notify} /> : null}
        {section === 'translation' ? <TranslationSection /> : null}
        {section === 'trash' ? <TrashView embedded /> : null}
        {section === 'system' ? <SystemSection /> : null}
      </Box>
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
  return (
    <>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>界面主题</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={session.theme}
          disabled={session.appearanceSaving}
          onChange={(_, value) => value && void changeTheme(value)}
        >
          <ToggleButton value="light"><Sunny sx={{ mr: 1 }} />浅色</ToggleButton>
          <ToggleButton value="dark"><Moon sx={{ mr: 1 }} />深色</ToggleButton>
        </ToggleButtonGroup>
      </Card>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>强调色</Typography>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box component="input" type="color" aria-label="强调色" value={session.themeColor} disabled={session.appearanceSaving}
            onChange={(event) => void changeColor(event.target.value)}
            sx={{ width: 42, height: 34, p: 0, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'monospace' }}>{session.themeColor}</Typography>
        </Stack>
      </Card>
    </>
  )
}

function NavigationSection({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const session = useSession()
  const [shops, setShops] = useState(session.user?.checkin_shop_label || '店铺打卡')
  const [social, setSocial] = useState(session.user?.checkin_social_label || '社媒打卡')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!shops.trim() || !social.trim()) { notify('名称不能为空', true); return }
    setSaving(true)
    try {
      await setCheckinLabel('shops', shops)
      await setCheckinLabel('social', social)
      notify('导航名称已保存。')
    } catch (error) { notify(apiError(error).message, true) }
    finally { setSaving(false) }
  }
  return (
    <Card>
      <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>导航与命名</Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>名称会同步到侧栏、顶部标题和打卡页面。</Typography>
      <Stack spacing={1.25} sx={{ maxWidth: 420 }}>
        <TextField size="small" label="店铺打卡名称" value={shops} onChange={(event) => setShops(event.target.value)} inputProps={{ maxLength: 40 }} />
        <TextField size="small" label="社媒打卡名称" value={social} onChange={(event) => setSocial(event.target.value)} inputProps={{ maxLength: 40 }} />
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button>
          <Button size="small" disabled={saving} onClick={() => { setShops('店铺打卡'); setSocial('社媒打卡') }}>恢复默认</Button>
        </Stack>
      </Stack>
    </Card>
  )
}

function AccountSection({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const session = useSession()
  const navigate = useNavigate()
  const [form, setForm] = useState({ old_password: '', new_password: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const valid = Boolean(form.old_password) && form.new_password.length >= 8 && form.new_password === form.confirm
  const change = async () => {
    if (!valid) return
    setSaving(true)
    try {
      await http.post('/auth/password', { old_password: form.old_password, new_password: form.new_password })
      setForm({ old_password: '', new_password: '', confirm: '' })
      notify('密码已更新，其他设备需要重新登录。')
    } catch (error) { notify(apiError(error).message, true) }
    finally { setSaving(false) }
  }
  const doLogout = async () => {
    setLoggingOut(true)
    try { await logout(); navigate('/login', { replace: true }) }
    catch (error) { notify(apiError(error).message, true) }
    finally { setLoggingOut(false) }
  }
  return (
    <>
      <Card>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
          <Box sx={{ width: 42, height: 42, borderRadius: 1, bgcolor: 'action.hover', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 600 }}>{session.user?.username?.slice(0, 1).toUpperCase()}</Box>
          <Box><Typography sx={{ fontSize: 13, fontWeight: 600 }}>{session.user?.username}</Typography><Typography sx={{ fontSize: 12, color: 'text.secondary' }}>当前登录账号</Typography></Box>
        </Stack>
        <Box sx={{ borderTop: 1, borderColor: 'divider', my: 1.5 }} />
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>修改密码</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>修改后其他设备需重新登录。</Typography>
        <FieldRow label="原密码"><TextField fullWidth type="password" autoComplete="current-password" value={form.old_password} disabled={saving} onChange={(event) => setForm({ ...form, old_password: event.target.value })} /></FieldRow>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box sx={{ flex: 1 }}><FieldRow label="新密码"><TextField fullWidth type="password" autoComplete="new-password" placeholder="至少 8 位" value={form.new_password} disabled={saving} onChange={(event) => setForm({ ...form, new_password: event.target.value })} /></FieldRow></Box>
          <Box sx={{ flex: 1 }}><FieldRow label="确认新密码"><TextField fullWidth type="password" autoComplete="new-password" value={form.confirm} disabled={saving} onChange={(event) => setForm({ ...form, confirm: event.target.value })} /></FieldRow></Box>
        </Stack>
        {form.new_password ? <Typography sx={{ fontSize: 12, color: valid ? 'success.main' : 'text.secondary', mb: 1 }}>{valid ? '新密码长度与两次输入均符合要求' : '新密码至少 8 位，两次输入需一致'}</Typography> : null}
        <Button size="small" variant="contained" disabled={!valid || saving} onClick={change}>更新密码</Button>
      </Card>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
          <Box><Typography sx={{ fontSize: 14, fontWeight: 600 }}>退出当前设备</Typography></Box>
          <Button size="small" disabled={loggingOut} onClick={doLogout}>退出登录</Button>
        </Stack>
      </Card>
    </>
  )
}
