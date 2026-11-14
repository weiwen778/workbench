import { useEffect, useMemo, useState } from 'react'
import { Button, Stack, Tooltip, Typography } from '@mui/material'
import type { PetAction, PetPayload } from './api'

const ACTIONS: Array<{ action: PetAction; label: string }> = [
  { action: 'feed', label: '喂食' },
  { action: 'treat', label: '零食' },
  { action: 'wash', label: '洗澡' },
  { action: 'play', label: '玩耍' },
  { action: 'walk', label: '遛狗' },
  { action: 'vet', label: '看医生' },
]

function clock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function ActionBar({
  pet, syncedAt, pending, onAction,
}: {
  pet: PetPayload
  syncedAt: number
  pending: PetAction | null
  onAction: (action: PetAction) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  // 冷却起点用 TanStack Query 的 dataUpdatedAt，绝不拿当前时间当起点。
  const elapsed = Math.max(0, Math.floor((now - syncedAt) / 1000))
  // 遛狗时段以后端返回的本地小时为准，避免浏览器时区与服务端不一致时按钮可点但请求 409。
  const hour = pet.local_hour ?? new Date().getHours()

  const reasons = useMemo<Record<string, string>>(() => {
    const result: Record<string, string> = {}
    if (pet.sleeping) result.all = '睡觉时只能叫醒'
    if (pet.stats.satiety >= 95) result.feed = '它已经吃饱了'
    if (pet.treats <= 0) result.treat = '没有零食了'
    if (pet.status === 'sick') { result.play = '生病了，先看医生'; result.walk = '生病了，先看医生' }
    if (pet.stats.energy < 20) result.play = '精力不足 20'
    if (pet.stats.energy < 25) result.walk = '精力不足 25'
    if (pet.stats.health >= 85) result.vet = '它很健康'
    if (hour < 7 || hour >= 22) result.walk = '只有 07:00–22:00 能遛狗'
    return result
  }, [pet, hour])

  const cooling = (action: keyof PetPayload['cooldowns']) =>
    Math.max(0, pet.cooldowns[action] - elapsed)

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
        {ACTIONS.map(({ action, label }) => {
          const left = cooling(action as keyof PetPayload['cooldowns'])
          const reason = pet.sleeping ? '睡觉时只能叫醒' : reasons[action]
          const disabled = pending !== null || left > 0 || Boolean(reason)
          return (
            <Tooltip key={action} title={reason || (left > 0 ? `冷却中，${clock(left)}` : '')}>
              <span>
                <Button size="small" variant="outlined" disabled={disabled} onClick={() => onAction(action)}>
                  {left > 0 ? `${label} ${clock(left)}` : label}
                </Button>
              </span>
            </Tooltip>
          )
        })}
        <Button
          size="small" variant="outlined" disabled={pending !== null}
          onClick={() => onAction(pet.sleeping ? 'wake' : 'sleep')}
        >
          {pet.sleeping ? '叫醒' : '睡觉'}
        </Button>
        <Button
          size="small" variant="contained"
          disabled={pending !== null || pet.sleeping || cooling('pet') > 0}
          onClick={() => onAction('pet')}
        >
          {cooling('pet') > 0 ? `抚摸 ${clock(cooling('pet'))}` : '抚摸'}
        </Button>
      </Stack>
      {pet.sleeping ? <Typography variant="caption" color="text.secondary">它睡着了，叫醒后才能做别的。</Typography> : null}
    </Stack>
  )
}
