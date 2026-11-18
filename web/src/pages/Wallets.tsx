import * as React from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toaster"
import { CopyButton, EmptyState, ErrorNote, FieldError, Mono, PageHeader } from "@/components/common"
import { api, ApiError, type Balance, type Deposit, type Wallet } from "@/lib/api"
import { useAsync } from "@/lib/hooks"
import { amountHint, CURRENCIES, formatMoney, parseAmount } from "@/lib/money"
import { useWallets, type LocalWallet } from "@/lib/store"
import { uuid } from "@/lib/utils"

export default function WalletsPage() {
  const { wallets, add } = useWallets()
  const [version, setVersion] = React.useState(0) // bumped after money moves, to refresh balances

  return (
    <div>
      <PageHeader title="Wallets" description="One wallet per currency. Money you deposit here is real ledger entries: every balance is the sum of its entries." />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="my-wallets">
          <h2 id="my-wallets" className="sr-only">
            Your wallets
          </h2>
          {wallets.length === 0 ? (
            <EmptyState title="No wallets yet">Open your first wallet on the right, then deposit some money into it.</EmptyState>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {wallets.map((w) => (
                <WalletRow key={w.id} wallet={w} version={version} onChanged={() => setVersion((v) => v + 1)} />
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-8">
          <OpenWallet existing={wallets} onOpened={add} />
          <AddExisting onAdded={add} />
        </div>
      </div>
    </div>
  )
}

function WalletRow({ wallet, version, onChanged }: { wallet: LocalWallet; version: number; onChanged: () => void }) {
  const balance = useAsync(() => api.get<Balance>(`/v1/wallets/${wallet.id}/balance`, { quiet: true }).then((r) => r.data), [wallet.id, version])
  const [open, setOpen] = React.useState(false)

  return (
    <li className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{wallet.currency} wallet</p>
          {balance.loading && !balance.data ? (
            <Skeleton className="mt-1 h-8 w-40" />
          ) : balance.error ? (
            <p className="mt-1 text-sm text-destructive">Couldn't load the balance.</p>
          ) : (
            <p className="mt-0.5 text-3xl font-semibold tracking-tight">{formatMoney(balance.data?.balance.amount ?? 0, wallet.currency)}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Mono className="text-muted-foreground">{wallet.id}</Mono>
            <CopyButton text={wallet.id} label="Copy ID" />
          </div>
        </div>
        <Button variant={open ? "secondary" : "outline"} size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Plus className="h-4 w-4" /> Deposit
        </Button>
      </div>
      {open && (
        <DepositForm
          wallet={wallet}
          onDone={() => {
            setOpen(false)
            onChanged()
          }}
        />
      )}
    </li>
  )
}

function DepositForm({ wallet, onDone }: { wallet: LocalWallet; onDone: () => void }) {
  const [amount, setAmount] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<ApiError | null>(null)
  // One key per form: sending the same deposit twice credits it once.
  const key = React.useRef(uuid())

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const minor = parseAmount(amount, wallet.currency)
    if (minor === null) {
      const msg = `Enter an amount ${amountHint(wallet.currency)}.`
      setError(new ApiError(0, "invalid_input", msg, { amount: msg }, ""))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<Deposit>(`/v1/wallets/${wallet.id}/deposits`, { amount: minor, currency: wallet.currency }, { idempotencyKey: key.current, note: "deposit" })
      toast.success("Deposit received", `${formatMoney(data.amount.amount, data.amount.currency)} added to your ${wallet.currency} wallet.`)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "error", String(err), {}, ""))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 rounded-md bg-muted/60 p-4" noValidate>
      <div className="min-w-40 flex-1 space-y-1.5">
        <Label htmlFor={`dep-${wallet.id}`}>Amount in {wallet.currency}</Label>
        <Input id={`dep-${wallet.id}`} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={amountHint(wallet.currency)} aria-invalid={!!error} />
        <FieldError>{error?.fields.amount ?? (error && Object.keys(error.fields).length === 0 ? error.message : undefined)}</FieldError>
      </div>
      <Button type="submit" disabled={busy || !amount}>
        {busy ? "Depositing…" : "Deposit"}
      </Button>
    </form>
  )
}

function OpenWallet({ existing, onOpened }: { existing: LocalWallet[]; onOpened: (w: LocalWallet) => void }) {
  const [currency, setCurrency] = React.useState<string>(CURRENCIES.find((c) => !existing.some((w) => w.currency === c)) ?? "USD")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  async function open(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<Wallet>("/v1/wallets", { currency }, { note: "open wallet" })
      onOpened({ id: data.id, currency: data.currency, createdAt: data.created_at })
      toast.success(`${data.currency} wallet opened`)
    } catch (err) {
      // One wallet per currency: say what to do instead.
      if (err instanceof ApiError && err.status === 409) setError(new Error(`You already have a ${currency} wallet. Add it by ID below to see it here.`))
      else setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open a wallet</CardTitle>
        <CardDescription>You can hold one wallet in each currency.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={open} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="currency">Currency</Label>
            <Select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <ErrorNote error={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Opening…" : "Open wallet"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function AddExisting({ onAdded }: { onAdded: (w: LocalWallet) => void }) {
  const [id, setId] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.get<Wallet>(`/v1/wallets/${id.trim()}`, { note: "look up wallet" })
      onAdded({ id: data.id, currency: data.currency, createdAt: data.created_at })
      setId("")
      toast.success(`${data.currency} wallet added`)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a wallet you already own</CardTitle>
        <CardDescription>Wallets you opened in another browser, or in the API, aren't listed by the server. Paste the ID to bring one back.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wallet-id">Wallet ID</Label>
            <Input id="wallet-id" value={id} onChange={(e) => setId(e.target.value)} className="font-mono text-[0.8125rem]" placeholder="0195f1c2-…" />
          </div>
          <ErrorNote error={error} />
          <Button type="submit" variant="outline" className="w-full" disabled={busy || !id.trim()}>
            {busy ? "Checking…" : "Add wallet"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
