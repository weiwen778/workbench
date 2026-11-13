import { useSearchParams } from 'react-router-dom'
import { Box, Tab, Tabs } from '@mui/material'
import { Page, PageToolbar } from '@/ui/common'
import HotPanel from '@/feeds/HotPanel'
import SubscriptionsPanel from '@/feeds/SubscriptionsPanel'
import CommonPanel from '@/feeds/CommonPanel'

const TABS = [
  { key: 'hot', label: '热榜' },
  { key: 'subscriptions', label: '我的订阅' },
  { key: 'sources', label: '常用信息源' },
]

export default function FeedsPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((item) => item.key === params.get('tab')) ? params.get('tab')! : 'hot'

  return (
    <Page sx={{ p: 0, gap: 0, minHeight: 0 }}>
      <PageToolbar sx={{ px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Tabs
          value={tab}
          onChange={(_, value) => setParams(value === 'hot' ? {} : { tab: value }, { replace: true })}
          sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0, fontSize: 13 } }}
        >
          {TABS.map((item) => <Tab key={item.key} value={item.key} label={item.label} />)}
        </Tabs>
        <Box sx={{ flex: 1 }} />
      </PageToolbar>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'hot' ? <HotPanel /> : tab === 'subscriptions' ? <SubscriptionsPanel /> : <CommonPanel />}
      </Box>
    </Page>
  )
}
