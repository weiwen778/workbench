import { useEffect, useState } from 'react'
import { Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useSession } from '@/session'
import { APP_NAV_KEYS, DEFAULT_PINNED_KEYS } from '@/layout/app-nav'
import { ManageNavDialog } from '@/layout/NavPanels'
import { readPinnedKeys, readSidebarMode, writePinnedKeys, writeSidebarMode, type SidebarMode } from '@/layout/sidebar-order'
import { Card } from '../SettingsSections'

export default function NavigationSection() {
  const session = useSession()
  const userId = session.user?.id
  const [mode, setMode] = useState<SidebarMode>(() => readSidebarMode(userId))
  const [pinned, setPinned] = useState<string[]>(() => readPinnedKeys(userId, DEFAULT_PINNED_KEYS, APP_NAV_KEYS))
  const [manageOpen, setManageOpen] = useState(false)

  useEffect(() => {
    setMode(readSidebarMode(userId))
    setPinned(readPinnedKeys(userId, DEFAULT_PINNED_KEYS, APP_NAV_KEYS))
  }, [userId])

  const changeMode = (next: SidebarMode | null) => {
    if (!next) return
    setMode(next)
    writeSidebarMode(userId, next)
  }
  const changePinned = (keys: string[]) => {
    const next = keys
    setPinned(next)
    writePinnedKeys(userId, next)
  }
  const reset = () => {
    setMode('narrow')
    writeSidebarMode(userId, 'narrow')
    changePinned([...DEFAULT_PINNED_KEYS])
  }

  return (
    <Stack spacing={2}>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>侧栏宽度</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>宽版显示图标和文字，窄版只显示图标。设置按账号保存在当前浏览器。</Typography>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, value: SidebarMode | null) => changeMode(value)}>
          <ToggleButton value="narrow">窄版</ToggleButton>
          <ToggleButton value="wide">宽版</ToggleButton>
        </ToggleButtonGroup>
      </Card>

      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} flexWrap="wrap">
          <div>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>固定导航</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              已固定 {pinned.length} 个，数量不限。其余功能收在侧栏「全部功能」里。
            </Typography>
          </div>
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={reset}>恢复默认</Button>
            <Button size="small" variant="contained" onClick={() => setManageOpen(true)}>管理导航</Button>
          </Stack>
        </Stack>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>
          在「管理导航」里可以拖动排序、取消固定，或从全部功能中添加。主导航最多 8 项，不会出现滚动条。
        </Typography>
      </Card>

      <ManageNavDialog open={manageOpen} onClose={() => setManageOpen(false)} pinned={pinned} onChange={changePinned} />
    </Stack>
  )
}
