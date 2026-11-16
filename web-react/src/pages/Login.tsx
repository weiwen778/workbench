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
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 3 }}>
      <Paper elevation={3} sx={{ width: 360, maxWidth: '100%', p: 3 }}>
        <Box component="img" src="/favicon.svg?v=20261031-notion" alt="个人工作台图标" sx={{ width: 52, height: 52, display: 'block', mx: 'auto', mb: 2 }} />
        <Typography variant="h5" align="center" sx={{ mb: 2.5 }}>个人工作台</Typography>
        <form onSubmit={submit}>
          <Stack spacing={1.5}>
            <TextField fullWidth autoFocus label="用户名" placeholder="请输入用户名" autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            <TextField
              fullWidth type="password" label="密码" placeholder="请输入密码" autoComplete="current-password"
              value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}
              error={Boolean(error)} helperText={error}
            />
            <Button type="submit" variant="contained" fullWidth disabled={loading}>{loading ? '登录中…' : '登录'}</Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  )
}
