import { alpha, createTheme, getContrastRatio, lighten, type Theme } from '@mui/material/styles'
import { DEFAULT_THEME_COLOR } from '@/theme-color'

export const fontSans = [
  '"Inter Variable"', '"Inter"', '"Noto Sans SC"', '"Source Han Sans SC"',
  '"Microsoft YaHei"', '"PingFang SC"', '"Helvetica Neue"', 'Arial', 'sans-serif',
].join(', ')

export const fontMono = [
  '"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace',
].join(', ')

/**
 * shadcn-admin 风格：白/灰画布、近黑主色、细边框、8/12px 圆角、Inter。
 * 主色仍是用户可配置的主题色，但默认是 shadcn 的近黑；旧的青绿会自动迁移到默认。
 */
export function buildTheme(mode: 'light' | 'dark', themeColor: string): Theme {
  const valid = /^#[0-9a-fA-F]{6}$/.test(themeColor)
  const legacyDefaults = ['#39776f', '#2383e2', '#1976d2', '#14665f', '#0f5b54']
  const accent = valid && !legacyDefaults.includes(themeColor.toLowerCase()) ? themeColor : DEFAULT_THEME_COLOR
  const dark = mode === 'dark'
  const neutral = accent.toLowerCase() === DEFAULT_THEME_COLOR.toLowerCase()
  let primary = neutral ? (dark ? '#FAFAFA' : '#18181B') : accent
  if (dark && !neutral) {
    for (let amount = 0.1; getContrastRatio(primary, '#09090B') < 4.6; amount += 0.1) {
      primary = lighten(accent, amount)
    }
  }

  const background = dark ? '#09090B' : '#FAFAFA'
  const paper = dark ? '#0C0C0E' : '#FFFFFF'
  const popover = dark ? '#0C0C0E' : '#FFFFFF'
  const border = dark ? '#27272A' : '#E4E4E7'
  const muted = dark ? '#27272A' : '#F4F4F5'
  const foreground = dark ? '#FAFAFA' : '#09090B'
  const mutedForeground = dark ? '#A1A1AA' : '#71717A'
  const disabledForeground = dark ? '#52525B' : '#A1A1AA'
  const contrastDark = '#09090B'
  const contrastLight = '#FAFAFA'
  // 按实际对比度选文字色，浅色自定义主色不会被强制配上白字。
  const primaryContrast = getContrastRatio(primary, contrastLight) >= getContrastRatio(primary, contrastDark)
    ? contrastLight
    : contrastDark
  const hover = dark ? '#18181B' : '#F4F4F5'
  const selected = dark ? '#27272A' : '#F4F4F5'
  const popoverShadow = dark
    ? '0 16px 48px rgba(0,0,0,0.65)'
    : '0 16px 48px rgba(9,9,11,0.10)'

  return createTheme({
    palette: {
      mode,
      primary: { main: primary, contrastText: primaryContrast },
      secondary: { main: mutedForeground },
      background: { default: background, paper },
      divider: border,
      text: { primary: foreground, secondary: mutedForeground, disabled: disabledForeground },
      success: { main: dark ? '#22C55E' : '#16A34A' },
      warning: { main: dark ? '#F59E0B' : '#D97706' },
      error: { main: dark ? '#EF4444' : '#DC2626' },
      action: {
        hover,
        selected,
        disabled: dark ? 'rgba(250,250,250,0.26)' : 'rgba(9,9,11,0.26)',
      },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: fontSans,
      fontSize: 14,
      h1: { fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.2 },
      h2: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25 },
      h3: { fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.35 },
      h4: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
      h5: { fontSize: 14, fontWeight: 600, lineHeight: 1.4 },
      h6: { fontSize: 14, fontWeight: 600, lineHeight: 1.4 },
      subtitle1: { fontSize: 14, fontWeight: 600 },
      subtitle2: { fontSize: 13, fontWeight: 600 },
      body1: { fontSize: 14, lineHeight: 1.5 },
      body2: { fontSize: 13.5, lineHeight: 1.5 },
      caption: { fontSize: 12.5, lineHeight: 1.45 },
      overline: { fontSize: 11, fontWeight: 500, letterSpacing: '0.02em' },
      button: { textTransform: 'none', fontWeight: 500, fontSize: 13.5 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            fontFamily: fontSans, color: foreground, backgroundColor: background,
            transition: 'background-color 200ms ease, color 200ms ease',
          },
          '#root': { height: '100%' },
          code: { fontFamily: fontMono },
          '::selection': { backgroundColor: dark ? 'rgba(250,250,250,0.20)' : 'rgba(24,24,27,0.12)' },
          '*': { scrollbarWidth: 'thin', scrollbarColor: `${dark ? 'rgba(250,250,250,0.20)' : 'rgba(9,9,11,0.20)'} transparent` },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: dark ? 'rgba(250,250,250,0.18)' : 'rgba(9,9,11,0.18)',
            borderRadius: 8,
            border: '2px solid transparent',
            backgroundClip: 'content-box',
          },
          '*::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            minWidth: 0, paddingInline: 14, borderRadius: 8, fontWeight: 500,
            transition: 'background-color 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease',
            '&:focus-visible': { outline: '2px solid', outlineColor: primary, outlineOffset: 2 },
          },
          sizeSmall: { height: 32, fontSize: 13, paddingInline: 12 },
          sizeMedium: { height: 36 },
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
          outlined: { borderColor: border, backgroundColor: paper, '&:hover': { borderColor: mutedForeground, backgroundColor: hover } },
          text: { '&:hover': { backgroundColor: hover } },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: 'background-color 150ms ease, color 150ms ease',
            '&:focus-visible': { outline: '2px solid', outlineColor: primary, outlineOffset: 2 },
          },
          sizeSmall: { width: 32, height: 32, borderRadius: 8 },
        },
      },
      MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
      MuiFormControl: { defaultProps: { size: 'small', variant: 'outlined' } },
      MuiSelect: { defaultProps: { size: 'small', variant: 'outlined' } },
      MuiInputLabel: {
        styleOverrides: {
          root: { fontSize: 13 },
          shrink: { fontWeight: 500, transform: 'translate(14px, -9px) scale(0.85)' },
        },
      },
      MuiInputBase: { styleOverrides: { root: { fontSize: 13.5 } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: paper,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: border },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: mutedForeground },
            '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(primary, 0.10)}` },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: primary, borderWidth: 1 },
            '&.MuiInputBase-sizeSmall': { height: 36 },
            '&.MuiInputBase-sizeSmall.MuiInputBase-multiline': { height: 'auto' },
          },
        },
      },
      MuiFormHelperText: { styleOverrides: { root: { fontSize: 12, marginLeft: 0, marginRight: 0 } } },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none', transition: 'background-color 200ms ease, border-color 200ms ease' },
          rounded: { borderRadius: 12 },
          outlined: { borderColor: border },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { borderRadius: 12, boxShadow: 'none', border: `1px solid ${border}` },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 12, border: `1px solid ${border}`, boxShadow: popoverShadow },
        },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: 16, fontWeight: 600 } } },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            paddingTop: 20,
            '.MuiDialogTitle-root + &': { paddingTop: 20 },
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { borderRadius: 8, boxShadow: popoverShadow, border: `1px solid ${border}`, padding: '4px', background: popover },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontSize: 13.5, minHeight: 36, borderRadius: 6,
            '&.Mui-selected': { backgroundColor: selected },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 6, fontWeight: 500 },
          sizeSmall: { height: 24, fontSize: 12 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: dark ? '#1F1F23' : '#F4F4F5' },
          sizeSmall: { padding: '12px 16px' },
          head: {
            fontSize: 13,
            fontWeight: 500,
            color: mutedForeground,
            backgroundColor: paper,
            borderBottom: `1px solid ${border}`,
          },
        },
      },
      MuiTableRow: { styleOverrides: { root: { '&:last-child td': { borderBottom: 0 } } } },
      MuiTabs: { styleOverrides: { root: { minHeight: 40 } } },
      MuiTab: { styleOverrides: { root: { minHeight: 40, py: 0, fontSize: 13, fontWeight: 500 } } },
      MuiToggleButtonGroup: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiToggleButton: {
        styleOverrides: {
          root: { textTransform: 'none', fontSize: 13, padding: '4px 10px', borderRadius: 8 },
          sizeSmall: { height: 32, paddingInline: 9 },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: { backgroundColor: foreground, color: dark ? '#09090B' : '#FAFAFA', fontSize: 12, borderRadius: 6, padding: '6px 8px' },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: { borderRadius: 8, minHeight: 38, transition: 'background-color 150ms ease, color 150ms ease' },
        },
      },
      MuiListItemIcon: { styleOverrides: { root: { minWidth: 32, color: 'inherit' } } },
      MuiListItemText: { styleOverrides: { primary: { fontSize: 13.5 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiCheckbox: { styleOverrides: { root: { padding: 8, '& .MuiSvgIcon-root': { fontSize: 18 } } } },
      MuiLinearProgress: { styleOverrides: { root: { height: 2, borderRadius: 2 } } },
      MuiSkeleton: { styleOverrides: { root: { backgroundColor: hover } } },
    },
  })
}
