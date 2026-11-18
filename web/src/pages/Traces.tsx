import * as React from "react"
import { Link } from "react-router-dom"
import { ArrowUpRight, Check, CircleAlert, ExternalLink, Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState, PageHeader } from "@/components/common"
import { api, FINAL_STATES, toSession, type Balance, type Deposit, type TokenResponse, type Transfer, type Wallet } from "@/lib/api"
import { formatMoney } from "@/lib/money"
import { useTape } from "@/lib/tape"
import { cn, formatTime, shortId, sleep, uuid } from "@/lib/utils"

type StepState = "todo" | "running" | "done" | "failed"
type LabStep = { label: string; state: StepState; traceId?: string; detail?: string }

const PLAN = [
  "Sign up Alice",
  "Sign up Bob",
  "Sign Alice in",
  "Sign Bob in",
  "Open Alice's USD wallet",
  "Open Bob's USD wallet",
  "Alice deposits $100.00",
  "Alice sends Bob $12.50",
  "Wait for the payment to settle",
  "Check Bob's balance",
]

export default function TracesPage() {
  const tape = useTape()
  const [steps, setSteps] = React.useState<LabStep[]>(PLAN.map((label) => ({ label, state: "todo" })))
  const [running, setRunning] = React.useState(false)
  const [paymentTrace, setPaymentTrace] = React.useState("")

  const recent = React.useMemo(() => {
    const seen = new Set<string>()
    return tape.filter((e) => e.traceId && !seen.has(e.traceId) && !!seen.add(e.traceId)).slice(0, 8)
  }, [tape])

  function patch(i: number, p: Partial<LabStep>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...p } : s)))
  }

  /**
   * A whole payment between two throwaway users, step by step. Everything goes
   * through the gateway, like any client: the trace it leaves behind runs from
   * the gateway to the wallet over gRPC, then on to the notification and
   * webhook services over NATS, long after the HTTP answer was sent.
   */
  async function run() {
    setRunning(true)
    setPaymentTrace("")
    setSteps(PLAN.map((label) => ({ label, state: "todo" })))
    const tag = uuid().slice(0, 6)
    const password = uuid()
    const alice = { email: `lab-${tag}-alice@example.com`, password }
    const bob = { email: `lab-${tag}-bob@example.com`, password }
    let i = 0
    const step = async <T,>(fn: () => Promise<{ traceId: string; value: T; detail?: string }>): Promise<T> => {
      patch(i, { state: "running" })
      try {
        const r = await fn()
        patch(i, { state: "done", traceId: r.traceId || undefined, detail: r.detail })
        i++
        return r.value
      } catch (err) {
        patch(i, { state: "failed", detail: err instanceof Error ? err.message : String(err) })
        throw err
      }
    }

    try {
      await step(async () => ({ traceId: (await api.post("/v1/auth/register", alice, { anonymous: true, note: "lab" })).traceId, value: null }))
      await step(async () => ({ traceId: (await api.post("/v1/auth/register", bob, { anonymous: true, note: "lab" })).traceId, value: null }))
      const aTok = await step(async () => {
        const r = await api.post<TokenResponse>("/v1/auth/login", alice, { anonymous: true, note: "lab" })
        return { traceId: r.traceId, value: toSession(alice.email, r.data).accessToken }
      })
      const bTok = await step(async () => {
        const r = await api.post<TokenResponse>("/v1/auth/login", bob, { anonymous: true, note: "lab" })
        return { traceId: r.traceId, value: toSession(bob.email, r.data).accessToken }
      })
      const aWallet = await step(async () => {
        const r = await api.post<Wallet>("/v1/wallets", { currency: "USD" }, { token: aTok, note: "lab" })
        return { traceId: r.traceId, value: r.data.id }
      })
      const bWallet = await step(async () => {
        const r = await api.post<Wallet>("/v1/wallets", { currency: "USD" }, { token: bTok, note: "lab" })
        return { traceId: r.traceId, value: r.data.id }
      })
      await step(async () => {
        const r = await api.post<Deposit>(`/v1/wallets/${aWallet}/deposits`, { amount: 10000, currency: "USD" }, { token: aTok, idempotencyKey: uuid(), note: "lab" })
        return { traceId: r.traceId, value: null }
      })
      const transfer = await step(async () => {
        const r = await api.post<Transfer>("/v1/transfers", { from: aWallet, to: bWallet, amount: 1250, currency: "USD" }, { token: aTok, idempotencyKey: uuid(), note: "lab payment" })
        setPaymentTrace(r.traceId)
        return { traceId: r.traceId, value: r.data }
      })
      await step(async () => {
        let t = transfer
        for (let n = 0; n < 40 && !FINAL_STATES.includes(t.state); n++) {
          await sleep(750)
          t = (await api.get<Transfer>(`/v1/transfers/${transfer.id}`, { token: aTok, quiet: true })).data
        }
        if (t.state !== "completed") throw new Error(`The payment ended as "${t.state}"${t.failure_reason ? `: ${t.failure_reason}` : ""}.`)
        return { traceId: "", value: null, detail: "Completed" }
      })
      await step(async () => {
        const r = await api.get<Balance>(`/v1/wallets/${bWallet}/balance`, { token: bTok, note: "lab" })
        return { traceId: r.traceId, value: null, detail: `Bob has ${formatMoney(r.data.balance.amount, r.data.balance.currency)}` }
      })
    } catch {
      /* the failing step shows its own error */
    } finally {
      setRunning(false)
    }
  }

  const host = location.hostname
  const finished = steps.every((s) => s.state === "done")

  return (
    <div>
      <PageHeader
        title="Traces"
        description="Every request gets a trace ID from the gateway. A payment's trace follows it from the gateway to the wallet, then over NATS to the notification and webhook services."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={`${location.protocol}//${host}:16686`} target="_blank" rel="noreferrer">
              Jaeger <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="lab">
          <h2 id="lab" className="text-lg font-semibold">
            Run a payment end to end
          </h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Creates two throwaway users, funds one, pays the other, and waits for the payment to settle. It uses the same API as the rest of the app, so you can then read the whole journey as one trace.
          </p>

          <Button className="mt-4" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running…" : steps.some((s) => s.state !== "todo") ? "Run it again" : "Run the payment"}
          </Button>

          <ol className="mt-6 divide-y rounded-lg border bg-card">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full",
                    s.state === "done" && "bg-success text-white",
                    s.state === "running" && "bg-primary text-primary-foreground",
                    s.state === "failed" && "bg-destructive text-white",
                    s.state === "todo" && "border-2 border-input",
                  )}
                >
                  {s.state === "done" && <Check className="h-3 w-3" />}
                  {s.state === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                  {s.state === "failed" && <CircleAlert className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn(s.state === "todo" && "text-muted-foreground")}>{s.label}</p>
                  {s.detail && <p className={cn("text-xs", s.state === "failed" ? "text-destructive" : "text-muted-foreground")}>{s.detail}</p>}
                </div>
                {s.traceId && (
                  <Link to={`/traces/${s.traceId}`} className="inline-flex shrink-0 items-center gap-0.5 font-mono text-xs text-primary hover:underline">
                    {shortId(s.traceId, 7)} <ArrowUpRight className="h-3 w-3" />
                  </Link>
                )}
              </li>
            ))}
          </ol>

          {finished && paymentTrace && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border bg-accent/60 p-4">
              <p className="text-sm">The payment settled. Its trace has the whole journey, including the events that fired afterwards.</p>
              <Button asChild size="sm">
                <Link to={`/traces/${paymentTrace}`}>
                  Open the payment's trace <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`${location.protocol}//${host}:8025`} target="_blank" rel="noreferrer">
                  See the emails <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          )}
        </section>

        <section aria-labelledby="recent">
          <h2 id="recent" className="text-lg font-semibold">
            Recent in this session
          </h2>
          {recent.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="No traces yet">Make a request, and its trace is listed here.</EmptyState>
            </div>
          ) : (
            <ul className="mt-3 divide-y rounded-lg border bg-card">
              {recent.map((e) => (
                <li key={e.id}>
                  <Link to={`/traces/${e.traceId}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">
                        {e.method} {e.path}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatTime(e.at)}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-primary">{shortId(e.traceId, 7)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
