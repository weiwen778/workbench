import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import sheetUrl from './assets/dog-sheet.png'
import type { PetPayload } from './api'

export type SpriteState = 'idle' | 'walk' | 'eat' | 'sleep' | 'sad' | 'sick'

const ROWS: Record<SpriteState, number> = { idle: 0, walk: 1, eat: 2, sleep: 3, sad: 4, sick: 5 }
// 规格：idle/walk/eat 各 4 帧，sleep/sad/sick 各 2 帧。
const FRAMES: Record<SpriteState, number> = { idle: 4, walk: 4, eat: 4, sleep: 2, sad: 2, sick: 2 }
const FPS: Record<SpriteState, number> = { idle: 6, walk: 8, eat: 8, sleep: 2, sad: 3, sick: 3 }

// 百分比背景定位按 p * (容器 - 图片) 计算：图片是 400%×600%，所以第 n 列要用
// 正的 n * 33.3333%、第 n 行要用正的 n * 20%，0..100% 刚好覆盖四列/六行。
// 负百分比会把图片推出容器，显示成空白。
const COL_STEP = 33.3333

export default function PetSprite({
  state, stage, reduced, className,
}: {
  state: SpriteState
  stage: PetPayload['stage']
  reduced: boolean
  className?: string
}) {
  const [frame, setFrame] = useState(0)
  // prefers-reduced-motion 固定显示 idle 第一帧，而不是当前状态的第一帧。
  const row = reduced ? ROWS.idle : ROWS[state]
  const fps = FPS[state]
  const frames = FRAMES[state]
  const shown = reduced ? 0 : frame

  useEffect(() => {
    setFrame(0)
    if (reduced) return
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % frames), Math.round(1000 / fps))
    return () => window.clearInterval(timer)
  }, [state, reduced, fps, frames])

  return (
    <Box
      component="span"
      className={className}
      aria-hidden
      data-pet-sprite
      data-frame={shown}
      sx={{
        display: 'block',
        width: '100%',
        aspectRatio: '1 / 1',
        backgroundImage: `url(${sheetUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '400% 600%',
        backgroundPosition: reduced ? '0% 0%' : `${shown * COL_STEP}% ${row * 20}%`,
        imageRendering: 'pixelated',
        transform: stage === 'puppy' ? 'scale(0.85)' : 'scale(1)',
        filter: stage === 'senior' ? 'saturate(0.65)' : 'none',
        transformOrigin: '50% 100%',
      }}
    />
  )
}
