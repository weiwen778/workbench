import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { apiError } from '@/api/client'
import { login, useSession } from '@/session'

export default function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const session = useSession()
  const [form, setForm] = useState({ username: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const redirectParam = params.get('redirect') || '/checkins'
  const redirect = redirectParam.startsWith('/') && !redirectParam.startsWith('//') ? redirectParam : '/checkins'

  useEffect(() => {
    if (session.loaded && session.user) navigate(redirect, { replace: true })
  }, [session.loaded, session.user, navigate, redirect])

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!form.username.trim() || !form.password) { setError('请输入用户名和密码'); return }
    setLoading(true); setError('')
    try {
      await login(form.username.trim(), form.password)
      navigate(redirect, { replace: true })
    } catch (err) {
      setError(apiError(err).message)
    } finally { setLoading(false) }
  }

  return (
    <Box sx={{
      height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'background.default', p: 3,
    }}>
      <Paper
        variant="outlined"
        sx={{ width: 380, maxWidth: '100%', p: { xs: 3, sm: 4 }, borderRadius: 1.5, boxShadow: '0 1px 2px rgba(9,9,11,0.04)' }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box
            component="img"
            src="/favicon.svg"
            alt="Nexus"
            sx={{ width: 36, height: 36, display: 'block', mb: 1.5 }}
          />
          <Typography sx={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>Nexus</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>登录到个人工作台</Typography>
        </Box>
        <form onSubmit={submit}>
          <Stack spacing={1.75}>
            <TextField fullWidth autoFocus label="用户名" placeholder="请输入用户名" autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            <TextField
              fullWidth type="password" label="密码" placeholder="请输入密码" autoComplete="current-password"
              value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}
              error={Boolean(error)} helperText={error}
            />
            <Button type="submit" variant="contained" fullWidth disabled={loading} sx={{ height: 40, mt: 0.25 }}>
              {loading ? '登录中…' : '登录'}
            </Button>
          </Stack>
        </form>
      </Paper>
      <Typography sx={{ mt: 2, fontSize: 11, color: 'text.disabled' }}>
        Nexus · 个人工作台
      </Typography>
    </Box>
  )
}
