import type { ReactNode } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { AppShell } from "@/components/AppShell"
import { useSession } from "@/lib/session"
import ActivityPage from "@/pages/Activity"
import AuthPage from "@/pages/Auth"
import ConvertPage from "@/pages/Convert"
import SendPage from "@/pages/Send"
import TraceDetailPage from "@/pages/TraceDetail"
import TracesPage from "@/pages/Traces"
import WalletsPage from "@/pages/Wallets"
import WebhooksPage from "@/pages/Webhooks"

function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession()
  const location = useLocation()
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

export default function App() {
  const session = useSession()
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route
        element={
          <RequireSession>
            <AppShell />
          </RequireSession>
        }
      >
        <Route index element={<WalletsPage />} />
        <Route path="send" element={<SendPage />} />
        <Route path="convert" element={<ConvertPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="traces" element={<TracesPage />} />
        <Route path="traces/:traceId" element={<TraceDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
