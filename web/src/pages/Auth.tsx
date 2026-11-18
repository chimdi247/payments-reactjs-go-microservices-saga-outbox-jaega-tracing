import * as React from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorNote, FieldError } from "@/components/common"
import { api, ApiError, toSession, type TokenResponse } from "@/lib/api"
import { setSession } from "@/lib/session"
import { cn } from "@/lib/utils"

type Mode = "signin" | "signup"

export default function AuthPage() {
  const [mode, setMode] = React.useState<Mode>("signin")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<ApiError | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? "/"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const creds = { email: email.trim(), password }
      if (mode === "signup") await api.post("/v1/auth/register", creds, { anonymous: true, note: "sign up" })
      const { data } = await api.post<TokenResponse>("/v1/auth/login", creds, { anonymous: true, note: "sign in" })
      setSession(toSession(creds.email, data))
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "error", String(err), {}, ""))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-12 px-6 py-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div>
        <div className="mb-10 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
            <Receipt className="h-[18px] w-[18px]" />
          </span>
          <span className="text-xl font-semibold tracking-tight">Ledgerline</span>
        </div>

        <h1 className="text-3xl font-semibold leading-tight tracking-tight">{mode === "signin" ? "Sign in to your wallets" : "Create your account"}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Hold money in dollars, euros, pounds or yen, send it to anyone with a wallet, and follow every payment through the services that handle it.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error?.fields.email} placeholder="you@example.com" />
            <FieldError>{error?.fields.email}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error?.fields.password}
            />
            <FieldError>{error?.fields.password}</FieldError>
            {mode === "signup" && <p className="text-xs text-muted-foreground">Use a long passphrase: four random words is plenty.</p>}
          </div>

          {error && Object.keys(error.fields).length === 0 && <ErrorNote error={error} />}

          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin")
              setError(null)
            }}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>

      <SampleTape className="hidden lg:block" />
    </div>
  )
}

// What the app does, shown as the thing it prints: one payment, followed across services.
const SAMPLE = [
  { svc: "gateway", op: "POST /v1/transfers", ms: "38 ms" },
  { svc: "transfer", op: "insert transfer, write outbox", ms: "9 ms", depth: 1 },
  { svc: "transfer", op: "saga: reserve funds", ms: "21 ms", depth: 1 },
  { svc: "wallet", op: "gRPC Hold", ms: "14 ms", depth: 2 },
  { svc: "transfer", op: "publish transfer.completed.v1", ms: "3 ms", depth: 1, event: true },
  { svc: "notification", op: "process transfer.completed.v1", ms: "46 ms", depth: 2, event: true },
  { svc: "webhook", op: "deliver to your endpoint", ms: "12 ms", depth: 2, event: true },
]

function SampleTape({ className }: { className?: string }) {
  return (
    <div className={cn("tape-paper px-7 pb-10 pt-7 shadow-sm", className)} aria-hidden>
      <p className="text-sm font-semibold">One payment, one trace</p>
      <p className="mt-1 text-xs text-muted-foreground">An illustration of what the app follows for a transfer to a friend.</p>
      <ul className="mt-5 font-mono text-xs">
        {SAMPLE.map((r, i) => (
          <li key={i} className={cn("flex items-baseline justify-between gap-3 py-2", i > 0 && "tape-rule")}>
            <span className="flex min-w-0 items-baseline gap-2" style={{ paddingLeft: `${(r.depth ?? 0) * 14}px` }}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `hsl(var(--svc-${r.svc}))` }} />
              <span className="truncate">{r.op}</span>
              {r.event && <span className="shrink-0 text-[0.6875rem] text-muted-foreground">event</span>}
            </span>
            <span className="shrink-0 text-muted-foreground">{r.ms}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
