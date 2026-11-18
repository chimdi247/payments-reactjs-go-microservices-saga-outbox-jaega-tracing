import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { ArrowLeftRight, History, Landmark, LogOut, Receipt, Send, Waypoints, Webhook } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TraceTape } from "@/components/TraceTape"
import { api } from "@/lib/api"
import { getSession, setSession, useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/", label: "Wallets", icon: Landmark, end: true },
  { to: "/send", label: "Send money", icon: Send },
  { to: "/convert", label: "Convert", icon: ArrowLeftRight },
  { to: "/activity", label: "Activity", icon: History },
  { to: "/webhooks", label: "Webhooks", icon: Webhook },
  { to: "/traces", label: "Traces", icon: Waypoints },
]

export function AppShell() {
  const session = useSession()
  const navigate = useNavigate()

  async function signOut() {
    const s = getSession()
    try {
      if (s) await api.post("/v1/auth/logout", { refresh_token: s.refreshToken }, { anonymous: true, note: "sign out" })
    } catch {
      /* the token may be gone already: signing out locally is what matters */
    }
    setSession(null)
    navigate("/login")
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-[1500px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_320px]">
      <nav aria-label="Main" className="flex flex-col border-b bg-card/60 p-3 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:p-4">
        <div className="mb-3 flex items-center justify-between lg:mb-8">
          <div className="flex items-center gap-2.5 px-1">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Receipt className="h-4 w-4" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Ledgerline</span>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={signOut} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-accent text-accent-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="mt-auto hidden border-t pt-4 lg:block">
          <p className="truncate px-1 text-sm font-medium" title={session?.email}>
            {session?.email}
          </p>
          <Button variant="ghost" size="sm" className="mt-1 justify-start px-1 text-muted-foreground" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </nav>

      <main className="min-w-0 px-4 py-8 sm:px-8 lg:py-10">
        <Outlet />
      </main>

      <TraceTape className="hidden h-screen px-4 py-8 xl:sticky xl:top-0 xl:flex" />
    </div>
  )
}
