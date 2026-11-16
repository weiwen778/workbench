import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Stack, TextField, Typography } from '@mui/material'
import { apiError, http } from '@/api/client'
import { logout } from '@/session'
import { FieldRow } from '@/ui/common'
import { Card } from '../SettingsSections'

export default function SecuritySection({ notify }: { notify: (message: string, error?: boolean) => void }) {
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
    <Stack spacing={2}>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>修改密码</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>修改后其他设备需要使用新密码重新登录。</Typography>
        <FieldRow label="原密码"><TextField fullWidth type="password" autoComplete="current-password" value={form.old_password} disabled={saving} onChange={(event) => setForm({ ...form, old_password: event.target.value })} /></FieldRow>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <div style={{ flex: 1 }}><FieldRow label="新密码"><TextField fullWidth type="password" autoComplete="new-password" placeholder="至少 8 位" value={form.new_password} disabled={saving} onChange={(event) => setForm({ ...form, new_password: event.target.value })} /></FieldRow></div>
          <div style={{ flex: 1 }}><FieldRow label="确认新密码"><TextField fullWidth type="password" autoComplete="new-password" value={form.confirm} disabled={saving} onChange={(event) => setForm({ ...form, confirm: event.target.value })} /></FieldRow></div>
        </Stack>
        {form.new_password ? <Typography sx={{ fontSize: 12, color: valid ? 'success.main' : 'text.secondary', mb: 1 }}>{valid ? '新密码长度与两次输入均符合要求' : '新密码至少 8 位，两次输入需一致'}</Typography> : null}
        <Button size="small" variant="contained" disabled={!valid || saving} onClick={change}>更新密码</Button>
      </Card>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
          <div>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>退出当前设备</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>退出后需要重新输入密码登录。</Typography>
          </div>
          <Button size="small" disabled={loggingOut} onClick={doLogout}>退出登录</Button>
        </Stack>
      </Card>
    </Stack>
  )
}
