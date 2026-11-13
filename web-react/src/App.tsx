import { lazy, Suspense, useEffect, useMemo } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { buildTheme } from '@/app/theme'
import { loadSession, useSession } from '@/session'
import { DialogHost, Toaster } from '@/ui/feedback'
import AppLayout from '@/layout/AppLayout'
import LoadingScreen from '@/ui/LoadingScreen'

const LoginPage = lazy(() => import('@/pages/Login'))
const CheckinPage = lazy(() => import('@/pages/Checkin'))
const TargetDetailPage = lazy(() => import('@/pages/TargetDetail'))
const TodosPage = lazy(() => import('@/pages/Todos'))
const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const TablesPage = lazy(() => import('@/pages/Tables'))
const TableRoutePage = lazy(() => import('@/pages/TableRoute'))
const NotesPage = lazy(() => import('@/pages/Notes'))
const MemosPage = lazy(() => import('@/pages/Memos'))
const TranslatePage = lazy(() => import('@/pages/Translate'))
const ImagesPage = lazy(() => import('@/pages/Images'))
const BookmarksPage = lazy(() => import('@/pages/Bookmarks'))
const SettingsPage = lazy(() => import('@/pages/Settings'))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = useSession()
  const location = useLocation()
  if (!session.loaded) return <LoadingScreen />
  if (!session.user) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }
  return <>{children}</>
}

function Root() {
  const session = useSession()
  const theme = useMemo(() => buildTheme(session.theme, session.themeColor), [session.theme, session.themeColor])

  useEffect(() => { void loadSession() }, [])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route index element={<Navigate to="/checkins" replace />} />
              <Route path="/today" element={<Navigate to="/checkins" replace />} />
              <Route path="/checkins" element={<CheckinPage />} />
              <Route path="/checkins/items/:targetId" element={<CheckinPage />} />
              <Route path="/checkins/shops" element={<CheckinPage />} />
              <Route path="/checkins/social" element={<CheckinPage />} />
              <Route path="/checkins/targets/:id" element={<TargetDetailPage />} />
              <Route path="/todos/:listId?" element={<TodosPage />} />
              <Route path="/dashboard" element={<Navigate to="/visualizations" replace />} />
              <Route path="/visualizations/:dashboardId?" element={<DashboardPage />} />
              <Route path="/data" element={<TablesPage />} />
              <Route path="/data/virtual/new" element={<Navigate to="/data" replace />} />
              <Route path="/data/:tableId/virtual/edit" element={<Navigate to="/data" replace />} />
              <Route path="/data/:tableId" element={<TableRoutePage />} />
              <Route path="/notes/:folderKey?" element={<NotesPage />} />
              <Route path="/memos" element={<MemosPage />} />
              <Route path="/translate" element={<TranslatePage />} />
              <Route path="/images" element={<ImagesPage />} />
              <Route path="/bookmarks" element={<BookmarksPage />} />
              <Route path="/tasks" element={<Navigate to="/checkins" replace />} />
              <Route path="/search" element={<Navigate to="/checkins" replace />} />
              <Route path="/activity" element={<Navigate to="/checkins" replace />} />
              <Route path="/trash" element={<Navigate to="/settings/trash" replace />} />
              <Route path="/settings/trash" element={<SettingsPage section="trash" />} />
              <Route path="/settings/navigation" element={<Navigate to="/settings" replace />} />
              <Route path="/settings/:section" element={<SettingsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/checkins" replace />} />
            </Route>
          </Routes>
        </Suspense>
        <Toaster />
        <DialogHost />
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default function App() {
  return <Root />
}
