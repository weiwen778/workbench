import { createTheme, type Theme } from '@mui/material/styles'
import { DEFAULT_THEME_COLOR } from '@/theme-color'

export const fontSans = [
  '"IBM Plex Sans Variable"', '"IBM Plex Sans"', '"Noto Sans SC"', '"Source Han Sans SC"',
  '"Microsoft YaHei"', '"PingFang SC"', '"Helvetica Neue"', 'Arial', 'sans-serif',
].join(', ')

export const fontMono = [
  '"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace',
].join(', ')

/** 工作台账风格：冷灰纸面、墨色、青绿主色、黄铜辅助色，紧凑直角。 */
export function buildTheme(mode: 'light' | 'dark', themeColor: string): Theme {
  const valid = /^#[0-9a-fA-F]{6}$/.test(themeColor)
  const legacyDefaults = ['#2383e2', '#1976d2']
  const primary = valid && !legacyDefaults.includes(themeColor.toLowerCase()) ? themeColor : DEFAULT_THEME_COLOR
  const dark = mode === 'dark'

  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      secondary: { main: dark ? '#C9A25B' : '#9A6B2F' },
      background: {
        default: dark ? '#0F1517' : '#F6F7F6',
        paper: dark ? '#171F22' : '#FFFFFF',
      },
      divider: dark ? '#2A373B' : '#E7EBE9',
      text: {
        primary: dark ? '#E4EBE9' : '#1A2426',
        secondary: dark ? '#9FB0B3' : '#5A6A6E',
        disabled: dark ? '#66777A' : '#93A2A5',
      },
      success: { main: dark ? '#69B08D' : '#2F7D5B' },
      warning: { main: dark ? '#D6A54A' : '#A86E18' },
      error: { main: dark ? '#E07062' : '#B3392E' },
      action: {
        hover: dark ? 'rgba(255,255,255,0.055)' : 'rgba(20,40,45,0.045)',
        selected: dark ? 'rgba(79,167,157,0.18)' : 'rgba(20,102,95,0.10)',
      },
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: fontSans,
      fontSize: 13.5,
      h1: { fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em' },
      h2: { fontSize: 23, fontWeight: 500, letterSpacing: '-0.02em' },
      h3: { fontSize: 19, fontWeight: 500, letterSpacing: '-0.015em' },
      h4: { fontSize: 16, fontWeight: 500 },
      h5: { fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' },
      h6: { fontSize: 13.5, fontWeight: 600 },
      subtitle1: { fontSize: 13.5, fontWeight: 600 },
      subtitle2: { fontSize: 12.5, fontWeight: 600 },
      body1: { fontSize: 13, lineHeight: 1.6 },
      body2: { fontSize: 12.5, lineHeight: 1.55 },
      caption: { fontSize: 11, lineHeight: 1.45 },
      overline: { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em' },
      button: { textTransform: 'none', fontWeight: 500, fontSize: 12.5 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { fontFamily: fontSans, backgroundColor: dark ? '#0F1517' : '#F2F4F3' },
          '#root': { height: '100%' },
          code: { fontFamily: fontMono },
          '*': { scrollbarWidth: 'thin', scrollbarColor: `${dark ? 'rgba(228,235,233,0.28)' : 'rgba(26,36,38,0.26)'} transparent` },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: dark ? 'rgba(228,235,233,0.26)' : 'rgba(26,36,38,0.24)',
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
          root: { minWidth: 0, paddingInline: 12 },
          sizeSmall: { height: 30, fontSize: 12.5, paddingInline: 10 },
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        },
      },
      MuiIconButton: {
        styleOverrides: { sizeSmall: { width: 30, height: 30, borderRadius: 6 } },
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
      MuiInputBase: { styleOverrides: { root: { fontSize: 12.5 } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: dark ? '#324044' : '#DCE3E0' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: dark ? '#46585C' : '#B9C6C3' },
          },
        },
      },
      MuiFormHelperText: { styleOverrides: { root: { fontSize: 11, marginLeft: 0, marginRight: 0 } } },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: 6 },
          outlined: { borderColor: dark ? '#2A373B' : '#E7EBE9' },
        },
      },
      MuiCard: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 10 } } },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            paddingTop: 20,
            // MUI 自带 `.MuiDialogTitle-root + & { paddingTop: 0 }`，会把浮动标签裁掉
            '.MuiDialogTitle-root + &': { paddingTop: 20 },
          },
        },
      },
      MuiMenu: { styleOverrides: { paper: { borderRadius: 8, border: `1px solid ${dark ? '#2A373B' : '#E7EBE9'}` } } },
      MuiMenuItem: { styleOverrides: { root: { fontSize: 12.5, minHeight: 32 } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 4, fontWeight: 500 }, sizeSmall: { height: 21, fontSize: 11 } } },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: dark ? '#2A373B' : '#EDF1EF' },
          sizeSmall: { padding: '7px 12px' },
          head: {
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            color: dark ? '#B9C7C8' : '#42565A',
            backgroundColor: dark ? '#1E2A2D' : '#E9EFEB',
            borderBottom: `1px solid ${dark ? '#3A4B4F' : '#C9D5D0'}`,
          },
        },
      },
      MuiTableRow: { styleOverrides: { root: { '&:last-child td': { borderBottom: 0 } } } },
      MuiTabs: { styleOverrides: { root: { minHeight: 36 } } },
      MuiTab: { styleOverrides: { root: { minHeight: 36, py: 0, fontSize: 12.5, fontWeight: 500 } } },
      MuiToggleButtonGroup: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiToggleButton: {
        styleOverrides: {
          root: { textTransform: 'none', fontSize: 12, padding: '3px 10px', borderRadius: 6 },
          sizeSmall: { height: 28, paddingInline: 9 },
        },
      },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 6, minHeight: 34 } } },
      MuiListItemIcon: { styleOverrides: { root: { minWidth: 30, color: 'inherit' } } },
      MuiListItemText: { styleOverrides: { primary: { fontSize: 12.5 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 6 } } },
    },
  })
}
