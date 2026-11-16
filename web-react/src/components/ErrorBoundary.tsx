import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { reportClientError } from '@/logging/client-errors'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError({
      message: `界面渲染崩溃：${error.message || error.name}`,
      stack: [error.stack, info.componentStack].filter(Boolean).join('\n'),
      context: { boundary: 'app' },
    })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <Typography variant="h6">页面遇到了一个错误</Typography>
          <Typography variant="body2" color="text.secondary">
            错误信息已经自动记录到运行日志，方便之后排查。你可以先重新加载页面，未保存的输入可能丢失。
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto',
            }}
          >
            {this.state.error.message}
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => window.location.reload()}>重新加载</Button>
            <Button onClick={() => this.setState({ error: null })}>返回上一处</Button>
          </Stack>
        </Stack>
      </Box>
    )
  }
}
