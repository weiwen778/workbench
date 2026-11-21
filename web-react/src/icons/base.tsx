import { forwardRef } from 'react'
import { styled } from '@mui/material/styles'
import type { LucideIcon, LucideProps } from 'lucide-react'

export type AppIconSize = 'small' | 'medium' | 'large'

export type AppIconProps = Omit<LucideProps, 'size' | 'ref'> & {
  size?: number
  fontSize?: number | AppIconSize
  sx?: any
}

const SIZE_MAP: Record<AppIconSize, number> = { small: 16, medium: 18, large: 20 }

/**
 * Lucide 图标统一出口：保留应用里惯用的 `sx.fontSize` / `fontSize="small"`，
 * 内部用 1em 宽高，保证 16/18/20 下都按字号缩放。
 */
export function createIcon(Icon: LucideIcon) {
  const Styled = styled(Icon as unknown as React.ComponentType<LucideProps>)({
    display: 'block',
    flexShrink: 0,
    width: '1em',
    height: '1em',
  }) as unknown as React.ComponentType<AppIconProps & { ref?: React.Ref<SVGSVGElement> }>

  const AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function AppIcon(
    { sx, fontSize, size, strokeWidth = 1.75, ...rest }, ref,
  ) {
    const mapped = typeof fontSize === 'number' ? fontSize : fontSize ? SIZE_MAP[fontSize] : 18
    return (
      <Styled
        ref={ref}
        size={size ?? mapped}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        focusable="false"
        sx={[{ fontSize: mapped }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
        {...rest}
      />
    )
  })
  AppIcon.displayName = `AppIcon(${Icon.displayName || 'Lucide'})`
  return AppIcon
}
