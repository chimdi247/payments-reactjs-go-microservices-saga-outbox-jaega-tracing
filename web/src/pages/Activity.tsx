import * as React from "react"
import { Link } from "react-router-dom"
import { ArrowDownLeft, ArrowUpRight, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toaster"
import { EmptyState, ErrorNote, Mono, PageHeader } from "@/components/common"
import { WalletSelect } from "@/components/WalletSelect"
import { api, download, type EntriesPage, type Entry } from "@/lib/api"
import { formatMoney } from "@/lib/money"
import { useWallets } from "@/lib/store"
import { cn, formatDateTime, shortId } from "@/lib/utils"

const PAGE = 15

function monthStart() {
  const d = new Date()
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10)
}
function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function ActivityPage() {
  const { wallets } = useWallets()
  const [walletId, setWalletId] = React.useState("")
  const [entries, setEntries] = React.useState<Entry[]>([])
  const [cursor, setCursor] = React.useState<string | undefined>()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)
  const [from, setFrom] = React.useState(monthStart())
  const [to, setTo] = React.useState(today())

  const wallet = wallets.find((w) => w.id === walletId) ?? wallets[0]

  async function load(reset: boolean) {
    if (!wallet) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ limit: String(PAGE) })
      if (!reset && cursor) qs.set("cursor", cursor)
      const { data } = await api.get<EntriesPage>(`/v1/wallets/${wallet.id}/entries?${qs}`, { note: "history" })
      setEntries((prev) => (reset ? data.entries : [...prev, ...data.entries]))
      setCursor(data.next_cursor || undefined)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    setEntries([])
    setCursor(undefined)
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.id])

  async function statement() {
    if (!wallet) return
    try {
      const blob = await download(`/v1/wallets/${wallet.id}/statement.csv?from=${from}&to=${to}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `statement-${wallet.currency}-${from}-${to}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error("Couldn't get the statement", err instanceof Error ? err.message : String(err))
    }
  }

  if (wallets.length === 0) {
    return (
      <div>
        <PageHeader title="Activity" />
        <EmptyState title="No wallets yet">
          <Link className="font-medium text-primary hover:underline" to="/">
            Open a wallet
          </Link>{" "}
          to see its ledger entries here.
        </EmptyState>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Activity" description="Every change to a balance is a ledger entry. Money in is a credit, money out is a debit." />

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="w-64 space-y-1.5">
          <Label htmlFor="wallet">Wallet</Label>
          <WalletSelect id="wallet" wallets={wallets} value={wallet?.id ?? ""} onChange={setWalletId} />
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="from">Statement from</Label>
            <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">to</Label>
            <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" onClick={statement}>
            <Download className="h-4 w-4" /> Download CSV
          </Button>
        </div>
      </div>

      <ErrorNote error={error} />

      {loading && entries.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title="No entries yet">Deposit some money, and it shows up here.</EmptyState>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Transaction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const incoming = e.direction === "credit"
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.created_at)}</TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1.5", incoming ? "text-success" : "text-foreground")}>
                        {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        {incoming ? "Money in" : "Money out"}
                      </span>
                    </TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right font-medium", incoming && "text-success")}>
                      {incoming ? "+" : "−"}
                      {formatMoney(e.amount.amount, e.amount.currency)}
                    </TableCell>
                    <TableCell>
                      <Mono className="text-muted-foreground">{shortId(e.transaction_id, 13)}</Mono>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {cursor && (
            <div className="border-t p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => load(false)} disabled={loading}>
                {loading ? "Loading…" : "Load older entries"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
