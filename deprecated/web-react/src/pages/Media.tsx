import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, Divider, Paper, Stack, TextField, Typography,
} from '@mui/material'
import {
  ContentPaste, Download, Link, Play, Video,
} from '@/icons'
import { apiError, copyText, http } from '@/api/client'
import { EmptyHint, LoadingBar, Page, PageBody, PageToolbar } from '@/ui/common'
import { toast } from '@/ui/feedback'

interface DownloadEntry {
  url: string
  filename: string
}

interface MediaImage {
  url: string
  live_photo_url: string
}

interface MediaResult {
  platform: string
  platform_name: string
  video_id: string
  title: string
  description: string
  author: string
  cover_url: string
  video_url: string
  audio_url: string
  images: MediaImage[]
  videos: string[]
  is_preview: boolean
  downloads: {
    video?: DownloadEntry
    cover?: DownloadEntry
    audio?: DownloadEntry
    videos?: DownloadEntry[]
  }
  image_downloads: Array<{ url: DownloadEntry; live_photo_url?: DownloadEntry }>
}

interface MediaPlatform {
  key: string
  name: string
  cookie_configured: boolean
  cookie_env: string
}

interface MediaConfig {
  enabled: boolean
  platforms: MediaPlatform[]
}

// 最近输入只保存分享文本，不保存解析结果；属于偏好历史，与 wb_table_recent 同类。
const RECENT_KEY = 'wb.media.recent'
const MAX_RECENT = 10

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function shortText(text: string, limit = 64) {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > limit ? `${oneLine.slice(0, limit)}…` : oneLine
}

function DownloadButton({ entry, label, variant = 'outlined' }: {
  entry?: DownloadEntry
  label: string
  variant?: 'text' | 'outlined' | 'contained'
}) {
  if (!entry) return null
  return (
    <Button
      size="small"
      variant={variant}
      component="a"
      href={entry.url}
      download={entry.filename}
      startIcon={<Download />}
    >
      {label}
    </Button>
  )
}

export default function MediaPage() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<MediaResult | null>(null)
  const [error, setError] = useState('')
  const [config, setConfig] = useState<MediaConfig | null>(null)
  const [recent, setRecent] = useState<string[]>(() => readRecent())

  useEffect(() => {
    http.get<MediaConfig>('/media/config')
      .then((response) => setConfig(response.data))
      .catch(() => setConfig(null))
  }, [])

  const disabled = config?.enabled === false
  const platforms = config?.platforms || []
  const missingCookie = useMemo(
    () => platforms.filter((item) => !item.cookie_configured),
    [platforms],
  )

  const remember = (value: string) => {
    const next = [value, ...recent.filter((item) => item !== value)].slice(0, MAX_RECENT)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }

  const paste = async () => {
    try {
      const value = await navigator.clipboard.readText()
      if (value) setText(value)
      else toast.warning('剪贴板里没有文本')
    } catch {
      toast.warning('无法读取剪贴板，请手动粘贴')
    }
  }

  const parse = async () => {
    const value = text.trim()
    if (!value) {
      toast.warning('请先粘贴分享链接')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const response = await http.post<MediaResult>('/media/parse', { text: value }, { timeout: 120000 })
      setResult(response.data)
      remember(value)
      toast.success('解析成功')
    } catch (err) {
      const info = apiError(err)
      setError(info.message)
    } finally {
      setLoading(false)
    }
  }

  const copyLink = async (url: string) => {
    if (!url) return
    const ok = await copyText(url)
    if (ok) toast.success('直链已复制')
    else toast.error('复制失败，请手动选择链接')
  }

  return (
    <Page scroll>
      <PageToolbar>
        <Video sx={{ color: 'primary.main' }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>视频解析</Typography>
        <Typography variant="body2" color="text.secondary">粘贴抖音、小红书、快手的分享链接，下载无水印视频、图集和实况图</Typography>
      </PageToolbar>

      <PageBody>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <TextField
              multiline
              minRows={3}
              maxRows={7}
              fullWidth
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="请粘贴视频链接或整段分享文案，例如：复制打开抖音…… https://v.douyin.com/xxxx/"
              disabled={disabled}
            />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              <Button variant="outlined" startIcon={<ContentPaste />} onClick={paste} disabled={disabled}>粘贴</Button>
              <Button variant="contained" startIcon={<Play />} onClick={parse} disabled={disabled || loading}>
                {loading ? '解析中…' : '开始解析'}
              </Button>
              <Button onClick={() => { setText(''); setResult(null); setError('') }} disabled={loading}>清空</Button>
              <Box sx={{ flex: 1 }} />
              {platforms.map((item) => (
                <Chip
                  key={item.key}
                  size="small"
                  label={item.name}
                  color={item.cookie_configured ? 'default' : 'warning'}
                  variant={item.cookie_configured ? 'outlined' : 'filled'}
                />
              ))}
            </Stack>
            <LoadingBar active={loading} />
            {disabled && <Alert severity="warning">视频解析功能未启用，请检查服务端配置。</Alert>}
            {missingCookie.length > 0 && (
              <Alert severity="info">
                未配置 {missingCookie.map((item) => item.name).join('、')} 的 Cookie。多数链接可直接解析；若提示登录校验，请在 .env 中补充
                {' '}{missingCookie.map((item) => item.cookie_env).join('、')}。
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </Paper>

        {recent.length > 0 && (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            <Typography variant="body2" color="text.secondary">最近：</Typography>
            {recent.map((item) => (
              <Chip
                key={item}
                size="small"
                label={shortText(item)}
                onClick={() => setText(item)}
                variant="outlined"
              />
            ))}
          </Stack>
        )}

        {!result && !loading && (
          <EmptyHint>
            解析结果会显示在这里。支持视频、图集和实况图；只下载自己发布或已获授权的内容。
          </EmptyHint>
        )}

        {result && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {result.cover_url && (
                  <Box
                    component="img"
                    src={result.cover_url}
                    alt="封面"
                    sx={{
                      width: { xs: '100%', sm: 180 }, height: 120, objectFit: 'cover',
                      borderRadius: 1, bgcolor: 'action.hover', flexShrink: 0,
                    }}
                  />
                )}
                <Stack spacing={1} sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={result.platform_name} color="primary" variant="outlined" />
                    {result.author && <Typography variant="body2" color="text.secondary">@{result.author}</Typography>}
                    {result.is_preview && <Chip size="small" label="试看片段" color="warning" />}
                  </Stack>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
                    {result.title || '未命名作品'}
                  </Typography>
                  {result.description && result.description !== result.title && (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {result.description}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    <DownloadButton entry={result.downloads.video} label="下载视频" variant="contained" />
                    <DownloadButton entry={result.downloads.cover} label="下载封面" />
                    <DownloadButton entry={result.downloads.audio} label="下载音频" />
                    {result.video_url && (
                      <Button size="small" variant="outlined" startIcon={<Link />} onClick={() => copyLink(result.video_url)}>
                        复制直链
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </Stack>

              {result.video_url && (
                <Box
                  component="video"
                  controls
                  playsInline
                  poster={result.cover_url || undefined}
                  src={result.video_url}
                  sx={{ width: '100%', maxHeight: 520, bgcolor: 'common.black', borderRadius: 1 }}
                />
              )}

              {result.downloads.videos && result.downloads.videos.length > 0 && (
                <Stack spacing={1}>
                  <Divider />
                  <Typography variant="subtitle2">其他视频</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {result.downloads.videos.map((entry, index) => (
                      <DownloadButton key={entry.url} entry={entry} label={`下载视频 ${index + 2}`} />
                    ))}
                  </Stack>
                </Stack>
              )}

              {result.images.length > 0 && (
                <Stack spacing={1}>
                  <Divider />
                  <Typography variant="subtitle2">图集（{result.images.length} 张）</Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                      gap: 1.25,
                    }}
                  >
                    {result.images.map((image, index) => {
                      const download = result.image_downloads[index]
                      return (
                        <Paper key={`${image.url}-${index}`} variant="outlined" sx={{ overflow: 'hidden' }}>
                          <Box sx={{ position: 'relative' }}>
                            <Box
                              component="img"
                              src={image.url}
                              alt={`图集 ${index + 1}`}
                              loading="lazy"
                              sx={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', bgcolor: 'action.hover' }}
                            />
                            {image.live_photo_url && (
                              <Chip
                                size="small"
                                label="实况"
                                color="secondary"
                                sx={{ position: 'absolute', top: 8, left: 8 }}
                              />
                            )}
                          </Box>
                          <Stack direction="row" spacing={0.5} sx={{ p: 0.75 }} flexWrap="wrap" useFlexGap>
                            <DownloadButton entry={download?.url} label={`图片 ${index + 1}`} />
                            <DownloadButton entry={download?.live_photo_url} label="实况" variant="text" />
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Box>
                </Stack>
              )}
            </Stack>
          </Paper>
        )}

        <Typography variant="caption" color="text.secondary">
          仅用于下载自己发布或已获得授权的内容。解析依赖平台公开接口，可能因平台风控临时失败。
        </Typography>
      </PageBody>
    </Page>
  )
}
