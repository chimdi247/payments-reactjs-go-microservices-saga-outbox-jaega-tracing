import * as React from "react"
import { Link } from "react-router-dom"
import { ArrowUpRight, Check, CircleAlert, Clock, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { toast } from "@/components/ui/toaster"
import { EmptyState, ErrorNote, FieldError, Mono, PageHeader, StateBadge } from "@/components/common"
import { WalletSelect } from "@/components/WalletSelect"
import { api, ApiError, FINAL_STATES, type Transfer, type TransferState } from "@/lib/api"
import { usePoll } from "@/lib/hooks"
import { amountHint, formatMoney, parseAmount } from "@/lib/money"
import { useContacts, useWallets } from "@/lib/store"
import { cn, uuid } from "@/lib/utils"

type Sent = { transfer: Transfer; traceId: string; key: string; body: { from: string; to: string; amount: number; currency: string } }

export default function SendPage() {
  const { wallets } = useWallets()
  const { contacts, save } = useContacts()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [sent, setSent] = React.useState<Sent | null>(null)
  // The idempotency key belongs to one intention to pay: a retry reuses it, a new payment gets a new one.
  const key = React.useRef(uuid())

  const source = wallets.find((w) => w.id === from) ?? wallets[0]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!source) return
    const minor = parseAmount(amount, source.currency)
    if (minor === null) {
      setError(new ApiError(0, "invalid_input", "", { amount: `Enter an amount ${amountHint(source.currency)}.` }, ""))
      return
    }
    const body = { from: source.id, to: to.trim(), amount: minor, currency: source.currency }
    setBusy(true)
    setError(null)
    try {
      const reply = await api.post<Transfer>("/v1/transfers", body, { idempotencyKey: key.current, note: "send money" })
      setSent({ transfer: reply.data, traceId: reply.traceId, key: key.current, body })
      if (label.trim()) save({ walletId: body.to, label: label.trim(), currency: source.currency })
      key.current = uuid()
      setAmount("")
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "error", String(err), {}, ""))
    } finally {
      setBusy(false)
    }
  }

  if (wallets.length === 0) {
    return (
      <div>
        <PageHeader title="Send money" />
        <EmptyState title="You need a funded wallet first">
          <Link className="font-medium text-primary hover:underline" to="/">
            Open a wallet and deposit some money
          </Link>
          , then come back to pay someone.
        </EmptyState>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Send money" description="Payments run as a saga: the money is reserved first, then handed to the recipient, and handed back if anything goes wrong." />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <WalletSelect id="from" wallets={wallets} value={source?.id ?? ""} onChange={setFrom} />
            <FieldError>{error?.fields.from}</FieldError>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="to">Recipient's wallet ID</Label>
            {contacts.length > 0 && (
              <Select aria-label="Saved recipients" value="" onChange={(e) => e.target.value && setTo(e.target.value)}>
                <option value="">Choose a saved recipient…</option>
                {contacts.map((c) => (
                  <option key={c.walletId} value={c.walletId}>
                    {c.label}
                    {c.currency ? ` (${c.currency})` : ""}
                  </option>
                ))}
              </Select>
            )}
            <Input id="to" value={to} onChange={(e) => setTo(e.target.value)} className="font-mono text-[0.8125rem]" placeholder="Paste the wallet ID they shared with you" aria-invalid={!!error?.fields.to} />
            <FieldError>{error?.fields.to}</FieldError>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount in {source?.currency}</Label>
            <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={amountHint(source?.currency ?? "USD")} aria-invalid={!!error?.fields.amount} />
            <FieldError>{error?.fields.amount}</FieldError>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="label">Save this recipient as (optional)</Label>
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bob" />
          </div>

          {error && Object.keys(error.fields).length === 0 && <ErrorNote error={error} />}

          <Button type="submit" className="w-full" disabled={busy || !to.trim() || !amount}>
            {busy ? "Sending…" : "Send money"}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Large transfers to someone you haven't paid before are held for review, and too many in a short time are refused. Both show up in the progress panel.
          </p>
        </form>

        <div>
          {sent ? (
            <Progress sent={sent} />
          ) : (
            <EmptyState title="Nothing sent yet">After you send money, its progress appears here, step by step, with a link to its trace.</EmptyState>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Progress -----------------------------------------------------------------

type StepStatus = "done" | "active" | "todo" | "warn" | "bad"
type Step = { label: string; detail?: string; status: StepStatus }

function stepsFor(t: Transfer): Step[] {
  const s: TransferState = t.state
  switch (s) {
    case "pending":
      return [
        { label: "Accepted", status: "done" },
        { label: "Reserving the funds", status: "active" },
        { label: "Delivered to the recipient", status: "todo" },
      ]
    case "in_review":
      return [
        { label: "Accepted", status: "done" },
        { label: "Held for review", detail: "A person has to approve this transfer before the money moves.", status: "warn" },
        { label: "Delivered to the recipient", status: "todo" },
      ]
    case "funds_held":
      return [
        { label: "Accepted", status: "done" },
        { label: "Funds reserved", status: "done" },
        { label: "Delivering to the recipient", status: "active" },
      ]
    case "completed":
      return [
        { label: "Accepted", status: "done" },
        { label: "Funds reserved", status: "done" },
        { label: "Delivered to the recipient", status: "done" },
      ]
    case "failed":
      return [
        { label: "Accepted", status: "done" },
        { label: "Refused", detail: t.failure_reason || "Nothing moved.", status: "bad" },
      ]
    case "compensating":
      return [
        { label: "Accepted", status: "done" },
        { label: "Funds reserved", status: "done" },
        { label: "Giving the funds back", detail: t.failure_reason, status: "bad" },
      ]
    default:
      return [
        { label: "Accepted", status: "done" },
        { label: "Funds reserved", status: "done" },
        { label: "Reversed: the funds are back with you", detail: t.failure_reason, status: "bad" },
      ]
  }
}

function Progress({ sent }: { sent: Sent }) {
  const [transfer, setTransfer] = React.useState<Transfer>(sent.transfer)
  const [replays, setReplays] = React.useState(0)
  const startedAt = React.useRef(Date.now())

  // A new payment replaces the old one on screen.
  React.useEffect(() => {
    setTransfer(sent.transfer)
    startedAt.current = Date.now()
    setReplays(0)
  }, [sent.transfer.id])

  const final = FINAL_STATES.includes(transfer.state)
  // Fast while the saga runs. A review can wait for hours: after a minute, look every few seconds.
  const interval = Date.now() - startedAt.current > 60_000 ? 4000 : 1000
  usePoll(
    async () => {
      const { data } = await api.get<Transfer>(`/v1/transfers/${sent.transfer.id}`, { quiet: true })
      setTransfer(data)
      return FINAL_STATES.includes(data.state)
    },
    interval,
    !final,
  )

  async function replay() {
    try {
      const r = await api.post<Transfer>("/v1/transfers", sent.body, { idempotencyKey: sent.key, note: "retry, same key" })
      setReplays((n) => n + 1)
      if (r.headers.get("Idempotent-Replayed") === "true") {
        toast.info("Same payment, not a second one", "The server recognised the idempotency key and returned the original transfer.")
      }
    } catch (err) {
      toast.error("Retry failed", err instanceof Error ? err.message : String(err))
    }
  }

  const steps = stepsFor(transfer)
  return (
    <section aria-labelledby="progress-title" className="rounded-lg border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="progress-title" className="text-lg font-semibold">
            {formatMoney(transfer.amount, transfer.currency)}
          </h2>
          <Mono className="text-muted-foreground">to {transfer.to}</Mono>
        </div>
        <StateBadge state={transfer.state} />
      </div>

      <ol className="mt-6 space-y-4">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <StepIcon status={s.status} />
            <div>
              <p className={cn("text-sm font-medium", s.status === "todo" && "text-muted-foreground")}>{s.label}</p>
              {s.detail && <p className="mt-0.5 text-sm text-muted-foreground">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4">
        {sent.traceId && (
          <Button asChild size="sm">
            <Link to={`/traces/${sent.traceId}`}>
              Follow this payment's trace <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={replay}>
          <RotateCcw className="h-4 w-4" /> Send the same request again
        </Button>
        {replays > 0 && <span className="text-xs text-muted-foreground">Retried {replays}×: still one transfer.</span>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Transfer <Mono>{transfer.id}</Mono>
      </p>
    </section>
  )
}

function StepIcon({ status }: { status: StepStatus }) {
  const base = "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full"
  switch (status) {
    case "done":
      return (
        <span className={cn(base, "bg-success text-white")}>
          <Check className="h-3 w-3" />
        </span>
      )
    case "active":
      return (
        <span className={cn(base, "bg-primary text-primary-foreground")}>
          <Loader2 className="h-3 w-3 animate-spin" />
        </span>
      )
    case "warn":
      return (
        <span className={cn(base, "bg-warning text-white")}>
          <Clock className="h-3 w-3" />
        </span>
      )
    case "bad":
      return (
        <span className={cn(base, "bg-destructive text-white")}>
          <CircleAlert className="h-3 w-3" />
        </span>
      )
    default:
      return <span className={cn(base, "border-2 border-input")} />
  }
}
