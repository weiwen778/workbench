import { memo } from 'react'
import { Box, Button, LinearProgress, Typography, useTheme } from '@mui/material'
import { Direction } from '@/icons'
import { useNavigate } from 'react-router-dom'
import { aggregationLabels, chartPalette, formatDashboardNumber, isHexColor, type DashboardResult, type DashboardWidget, type ProgressValue } from '@/dashboard'
import { useSession } from '@/session'
import { BarChart, LineChart, PieChart } from '@mui/x-charts'

export default memo(function DashboardChart({ widget, result }: { widget: DashboardWidget; result: DashboardResult }) {
  const theme = useTheme()
  if (result.status === 'error') {
    return <Box sx={{ minHeight: 130, display: 'grid', placeItems: 'center', color: 'error.main', p: 2.5, textAlign: 'center', fontSize: 13 }}>{result.message}</Box>
  }
  if (widget.kind === 'progress') return <TaskProgress widget={widget} result={result} />
  const customColors = (widget.colors || []).filter(isHexColor)
  if (widget.kind === 'metric') {
    return (
      <Box sx={{ pt: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, overflowWrap: 'anywhere' }}>
          <Box component="strong" sx={{ fontSize: 'clamp(24px, 11cqw, 40px)', whiteSpace: 'nowrap', fontWeight: 600, fontVariantNumeric: 'tabular-nums', ...(customColors[0] ? { color: customColors[0] } : {}) }}>{formatDashboardNumber(result.value, widget.decimals)}</Box>
          <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>{widget.unit}</Typography>
        </Box>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.25 }}>{aggregationLabels[widget.aggregation]} · {result.matched_rows ?? 0} 条记录</Typography>
      </Box>
    )
  }

  const labels = (result.points || []).map((point) => point.label)
  const seriesData = (result.series?.length ? result.series : [{ name: aggregationLabels[widget.aggregation], points: result.points || [] }])
    .map((series) => ({
      name: series.name,
      values: series.points.map((point) => point.value === null || !Number.isFinite(Number(point.value)) ? null : Number(point.value)),
    }))
  const numbers = seriesData.flatMap((series) => series.values.filter((value): value is number => value !== null))
  if (!numbers.length) {
    return <Box sx={{ minHeight: 130, display: 'grid', placeItems: 'center', color: 'text.secondary', p: 2.5, textAlign: 'center', fontSize: 13 }}>暂无可统计的数据</Box>
  }
  if (widget.kind === 'pie' && numbers.some((value) => value < 0)) {
    return <Box sx={{ minHeight: 130, display: 'grid', placeItems: 'center', color: 'error.main', p: 2.5, textAlign: 'center', fontSize: 13 }}>饼图不支持负数，请改用柱状图或折线图</Box>
  }
  if (widget.kind === 'pie' && numbers.reduce((sum, value) => sum + value, 0) === 0) {
    return <Box sx={{ minHeight: 130, display: 'grid', placeItems: 'center', color: 'text.secondary', p: 2.5, textAlign: 'center', fontSize: 13 }}>当前合计为 0，无法计算占比</Box>
  }

  const border = theme.palette.divider
  const primary = theme.palette.primary.main
  const shortLabel = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(2) : Array.from(value).length > 8 ? Array.from(value).slice(0, 7).join('') + '…' : value
  const compact = (value: number) => Math.abs(value) >= 1e8 ? `${formatDashboardNumber(value / 1e8, 1)}亿` : Math.abs(value) >= 1e4 ? `${formatDashboardNumber(value / 1e4, 1)}万` : formatDashboardNumber(value, 1)
  const format = (value: string | number | null | undefined) => formatDashboardNumber(value, widget.decimals)
  const palette = chartPalette(primary)
  const pickColor = (index: number) => customColors[index] || palette[index % palette.length]
  const seriesColors = seriesData.map((_, index) => pickColor(index))
  const pieColors = labels.map((_, index) => pickColor(index))
  const seriesKeys = seriesData.map((_, index) => `series${index}`)
  const dataset = labels.map((label, index) => ({
    label,
    ...Object.fromEntries(seriesData.map((series, seriesIndex) => [seriesKeys[seriesIndex], series.values[index] ?? null])),
  }))
  const valueFormatter = (value: number | null) => `${format(value)}${widget.unit}`
  const legend = { direction: 'row' as const, position: { vertical: 'top' as const, horizontal: 'middle' as const }, hidden: seriesData.length <= 1 }
  const chartSx = {
    width: '100%',
    '& .MuiChartsLegend-root': { fontSize: 11 },
    '& .MuiChartsAxis-tickLabel': { fontSize: 11 },
    '& .MuiChartsAxis-label': { fontSize: 11 },
  }

  const chart = widget.kind === 'pie' ? (
    <PieChart
      height={300}
      colors={pieColors}
      series={[{
        type: 'pie',
        data: labels.map((label, index) => ({ id: index, value: Math.max(0, seriesData[0]?.values[index] ?? 0), label })),
        innerRadius: '35%',
        outerRadius: '65%',
        arcLabel: 'formattedValue',
        arcLabelMinAngle: 8,
        valueFormatter: (item: any) => `${format(item.value)}${widget.unit}`,
      }]}
      legend={{ direction: 'row', position: { vertical: 'bottom', horizontal: 'middle' } }}
      sx={chartSx}
    />
  ) : widget.kind === 'bar' ? (
    <BarChart
      dataset={dataset}
      xAxis={[{ dataKey: 'label', scaleType: 'band', valueFormatter: shortLabel }]}
      yAxis={[{ valueFormatter: compact }]}
      series={seriesData.map((series, index) => ({ dataKey: seriesKeys[index], label: series.name, valueFormatter }))}
      height={300}
      colors={seriesColors}
      grid={{ horizontal: true }}
      legend={legend}
      sx={chartSx}
    />
  ) : (
    <LineChart
      dataset={dataset}
      xAxis={[{ dataKey: 'label', scaleType: 'point', valueFormatter: shortLabel }]}
      yAxis={[{ valueFormatter: compact }]}
      series={seriesData.map((series, index) => ({ dataKey: seriesKeys[index], label: series.name, valueFormatter, connectNulls: false }))}
      height={300}
      colors={seriesColors}
      grid={{ horizontal: true }}
      legend={legend}
      sx={chartSx}
    />
  )

  return (
    <Box sx={{ width: '100%', minWidth: 0 }}>
      {chart}
      <Box component="details" sx={{ overflowX: 'auto', fontSize: 12, mt: 0.75, color: 'text.secondary' }}>
        <summary style={{ cursor: 'pointer' }}>查看具体数值</summary>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: `1px solid ${border}`, padding: 6 }}>日期／分类</th>
              {seriesData.map((series, index) => <th key={index} style={{ textAlign: 'right', borderBottom: `1px solid ${border}`, padding: 6 }}>{series.name}{widget.unit ? `（${widget.unit}）` : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, index) => (
              <tr key={index}>
                <td style={{ textAlign: 'left', borderBottom: `1px solid ${border}`, padding: 6 }}>{label}</td>
                {seriesData.map((series, seriesIndex) => <td key={seriesIndex} style={{ textAlign: 'right', borderBottom: `1px solid ${border}`, padding: 6 }}>{format(series.values[index])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  )
})

function TaskProgress({ widget, result }: { widget: DashboardWidget; result: DashboardResult }) {
  const navigate = useNavigate()
  const session = useSession()
  if (!result.progress) return null
  const progress = result.progress
  const accent = (widget.colors || []).find(isHexColor)
  const unit = widget.unit || (widget.progress?.mode === 'tasks' ? '项' : '')
  const format = (value: string) => formatDashboardNumber(value, widget.decimals)
  const percent = (value: ProgressValue) => value.percentage === null ? '—' : `${formatDashboardNumber(value.percentage, 1)}%`
  const clamped = (value: ProgressValue) => Math.max(0, Math.min(100, Number(value.percentage) || 0))
  const open = (group?: ProgressValue) => {
    navigate(`/data/${widget.table_id}?filters=${JSON.stringify([...(result.drilldown_filters || []), ...(group?.filter ? [group.filter] : [])])}`)
  }
  const caption = progress.state === 'empty' ? '暂无任务'
    : progress.state === 'no_target' ? '暂无有效目标'
      : progress.state === 'complete' ? '目标已完成'
        : widget.progress?.mode === 'tasks' ? '任务完成进度' : '数量完成进度'

  return (
    <Box sx={{ pt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2.25, mb: 1.75, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>{caption}</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
            <Box component="strong" sx={{ fontSize: 30, fontWeight: 650, lineHeight: 1.2 }}>{format(progress.actual)}</Box>
            <Typography component="span" sx={{ fontSize: 14, color: 'text.secondary' }}>/ {format(progress.target)} {unit}</Typography>
          </Box>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
            {progress.percentage === null ? '目标为零，暂不计算完成率' : `剩余 ${format(progress.remaining)} ${unit}`}
            {widget.progress?.mode === 'tasks' && widget.progress.due_field ? ` · 逾期未完成 ${progress.overdue_rows} 项` : ''}
          </Typography>
        </Box>
        {widget.progress?.display !== 'circle' ? <Typography sx={{ fontSize: 25, fontWeight: 600, color: accent || 'primary.main' }}>{percent(progress)}</Typography> : null}
      </Box>
      <LinearProgress variant="determinate" value={clamped(progress)} sx={{ height: 12, borderRadius: 6, bgcolor: 'action.hover', ...(accent ? { '& .MuiLinearProgress-bar': { bgcolor: accent } } : {}) }} />
      {result.progress_groups?.length ? (
        <Box sx={{ display: 'grid', gap: 2, borderTop: 1, borderColor: 'divider', pt: 2.25, mt: 2.75 }}>
          {result.progress_groups.map((group, index) => (
            <Box key={index}>
              <Box component="button" onClick={() => open(group)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, width: '100%', border: 0, bgcolor: 'transparent', p: 0, pb: 0.875, font: 'inherit', textAlign: 'left', color: 'text.primary', cursor: 'pointer', fontSize: 13 }}>
                <span>{group.label}</span>
                <Box component="span" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0, fontSize: 12, color: 'text.secondary' }}>
                  {format(group.actual)} / {format(group.target)} {unit} · {percent(group)} <Direction sx={{ fontSize: 14 }} />
                </Box>
              </Box>
              <LinearProgress variant="determinate" value={clamped(group)} sx={{ height: 7, borderRadius: 4, bgcolor: 'action.hover', ...(accent ? { '& .MuiLinearProgress-bar': { bgcolor: accent } } : {}) }} />
            </Box>
          ))}
        </Box>
      ) : null}
      <Button size="small" onClick={() => open()} sx={{ mt: 1.75, color: session.themeColor }}>查看来源记录</Button>
    </Box>
  )
}
