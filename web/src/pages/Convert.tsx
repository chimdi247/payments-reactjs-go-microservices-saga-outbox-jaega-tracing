import * as React from "react"
import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { toast } from "@/components/ui/toaster"
import { EmptyState, ErrorNote, FieldError, PageHeader } from "@/components/common"
import { api, ApiError, type Quote } from "@/lib/api"
import { amountHint, formatMoney, parseAmount } from "@/lib/money"
import { useWallets } from "@/lib/store"
import { cn } from "@/lib/utils"

type Side = "sell" | "buy"

export default function ConvertPage() {
  const { wallets } = useWallets()
  const currencies = wallets.map((w) => w.currency)
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [side, setSide] = React.useState<Side>("sell")
  const [amount, setAmount] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [quote, setQuote] = React.useState<Quote | null>(null)
  const [done, setDone] = React.useState<{ quote: Quote; traceId: string } | null>(null)

  React.useEffect(() => {
    if (!from && currencies[0]) setFrom(currencies[0])
    if (!to && currencies[1]) setTo(currencies[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets.length])

  if (currencies.length < 2) {
    return (
      <div>
        <PageHeader title="Convert" />
        <EmptyState title="Converting needs two wallets">
          <Link className="font-medium text-primary hover:underline" to="/">
            Open wallets in two different currencies
          </Link>
          , fund one of them, and come back.
        </EmptyState>
      </div>
    )
  }

  const amountCurrency = side === "sell" ? from : to

  async function getQuote(e: React.FormEvent) {
    e.preventDefault()
    const minor = parseAmount(amount, amountCurrency)
    if (minor === null) {
      setError(new ApiError(0, "invalid_input", "", { amount: `Enter an amount ${amountHint(amountCurrency)}.` }, ""))
      return
    }
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const body = side === "sell" ? { from, to, sell_amount: minor } : { from, to, buy_amount: minor }
      const { data } = await api.post<Quote>("/v1/fx/quotes", body, { note: "fx quote" })
      setQuote(data)
    } catch (err) {
      setQuote(null)
      setError(err instanceof ApiError ? err : new ApiError(0, "error", String(err), {}, ""))
    } finally {
      setBusy(false)
    }
  }

  async function convert() {
    if (!quote) return
    setBusy(true)
    setError(null)
    try {
      // The quote's ID is the idempotency key: converting twice spends it once.
      const reply = await api.post<Quote>("/v1/fx/conversions", { quote_id: quote.id }, { idempotencyKey: quote.id, note: "fx convert" })
      setDone({ quote: reply.data, traceId: reply.traceId })
      setQuote(null)
      setAmount("")
      toast.success("Converted", `${formatMoney(reply.data.buy.amount, reply.data.buy.currency)} added to your ${reply.data.buy.currency} wallet.`)
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "error", String(err), {}, ""))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Convert" description="Ask for a quote, then convert before it expires. The rate is locked to the quote, and the fee is shown up front." />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <form onSubmit={getQuote} className="space-y-4" noValidate>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="from">Sell</Label>
              <Select id="from" value={from} onChange={(e) => setFrom(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
            <ArrowRight className="mb-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <div className="space-y-1.5">
              <Label htmlFor="to">Buy</Label>
              <Select id="to" value={to} onChange={(e) => setTo(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-sm font-medium">I know how much I want to</legend>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
              {(["sell", "buy"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={side === s}
                  onClick={() => setSide(s)}
                  className={cn("rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors", side === s && "bg-card text-foreground shadow-sm")}
                >
                  {s === "sell" ? `Sell (${from})` : `Buy (${to})`}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount in {amountCurrency}</Label>
            <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={amountHint(amountCurrency)} aria-invalid={!!error?.fields.amount} />
            <FieldError>{error?.fields.amount}</FieldError>
          </div>

          {error && Object.keys(error.fields).length === 0 && <ErrorNote error={error} />}

          <Button type="submit" className="w-full" disabled={busy || !amount || from === to}>
            {busy && !quote ? "Getting a quote…" : "Get a quote"}
          </Button>
          {from === to && <p className="text-xs text-muted-foreground">Pick two different currencies.</p>}
        </form>

        <div>
          {quote ? (
            <QuoteCard quote={quote} busy={busy} onConvert={convert} onExpire={() => setQuote(null)} />
          ) : done ? (
            <section className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold">Converted</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatMoney(done.quote.sell.amount, done.quote.sell.currency)} became {formatMoney(done.quote.buy.amount, done.quote.buy.currency)}.
              </p>
              {done.traceId && (
                <Button asChild size="sm" className="mt-4">
                  <Link to={`/traces/${done.traceId}`}>See the trace</Link>
                </Button>
              )}
            </section>
          ) : (
            <EmptyState title="No quote yet">Choose what to convert, and the quote appears here with its rate, fee and expiry.</EmptyState>
          )}
        </div>
      </div>
    </div>
  )
}

function QuoteCard({ quote, busy, onConvert, onExpire }: { quote: Quote; busy: boolean; onConvert: () => void; onExpire: () => void }) {
  const expires = new Date(quote.expires_at).getTime()
  const [left, setLeft] = React.useState(Math.max(0, Math.round((expires - Date.now()) / 1000)))

  React.useEffect(() => {
    const t = setInterval(() => {
      const s = Math.round((expires - Date.now()) / 1000)
      setLeft(Math.max(0, s))
      if (s <= 0) {
        clearInterval(t)
        toast.info("That quote expired", "Ask for a new one to see the current rate.")
        onExpire()
      }
    }, 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.id])

  return (
    <section className="rounded-lg border bg-card p-6" aria-labelledby="quote-title">
      <h2 id="quote-title" className="sr-only">
        Your quote
      </h2>
      <dl className="space-y-3 text-sm">
        <Line label="You sell" value={formatMoney(quote.sell.amount, quote.sell.currency)} />
        <Line label="You get" value={formatMoney(quote.buy.amount, quote.buy.currency)} strong />
        <Line label="Fee (included in what you sell)" value={formatMoney(quote.fee.amount, quote.fee.currency)} />
        <Line label="Rate" value={`1 ${quote.sell.currency} = ${quote.rate} ${quote.buy.currency}`} />
      </dl>
      <div className="mt-6 flex items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm text-muted-foreground">Expires in {left}s</p>
        <Button onClick={onConvert} disabled={busy || left === 0}>
          {busy ? "Converting…" : "Convert now"}
        </Button>
      </div>
    </section>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right", strong && "text-xl font-semibold")}>{value}</dd>
    </div>
  )
}
