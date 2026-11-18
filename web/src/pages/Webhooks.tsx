import * as React from "react"
import { RefreshCw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toaster"
import { CopyButton, EmptyState, ErrorNote, FieldError, Mono, PageHeader } from "@/components/common"
import { api, ApiError, type Delivery, type Endpoint } from "@/lib/api"
import { useAsync } from "@/lib/hooks"
import { formatDateTime } from "@/lib/utils"

const EVENTS = [
  { id: "transfer.completed.v1", label: "A transfer completed" },
  { id: "transfer.failed.v1", label: "A transfer failed or was reversed" },
  { id: "transfer.review_required.v1", label: "A transfer needs review" },
]

// nginx in the web container answers 204 here: a receiver that always says "got it".
const SINK = "http://web:8080/sink"

export default function WebhooksPage() {
  const endpoints = useAsync(() => api.get<{ endpoints: Endpoint[] }>("/v1/webhooks/endpoints", { quiet: true }).then((r) => r.data.endpoints ?? []), [])
  const [selected, setSelected] = React.useState("")
  const [secret, setSecret] = React.useState<Endpoint | null>(null)

  const list = endpoints.data ?? []
  const current = list.find((e) => e.id === selected) ?? list[0]

  return (
    <div>
      <PageHeader title="Webhooks" description="Get an HTTP call, signed with your secret, whenever one of your transfers changes. Failed calls are retried, and every attempt is logged." />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <CreateEndpoint
            onCreated={(e) => {
              setSecret(e)
              setSelected(e.id)
              endpoints.reload()
            }}
          />
          {secret?.secret && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
              <p className="font-medium">Your signing secret</p>
              <p className="mt-1 text-muted-foreground">Shown once. Copy it now: use it to verify the calls we send you.</p>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <Mono>{secret.secret}</Mono>
                <CopyButton text={secret.secret} />
              </div>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-base font-semibold">Your endpoints</h2>
          <ErrorNote error={endpoints.error} />
          {list.length === 0 && !endpoints.loading ? (
            <EmptyState title="No endpoints yet">Add one on the left. The built-in test receiver always answers "received".</EmptyState>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {list.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <button className="min-w-0 text-left" onClick={() => setSelected(e.id)} aria-pressed={current?.id === e.id}>
                    <p className="truncate font-medium">{e.url}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{e.event_types.join(", ")}</p>
                  </button>
                  <div className="flex items-center gap-2">
                    {current?.id === e.id && <Badge>Showing log</Badge>}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${e.url}`}
                      onClick={async () => {
                        try {
                          await api.del(`/v1/webhooks/endpoints/${e.id}`, { note: "delete endpoint" })
                          toast.success("Endpoint deleted")
                          endpoints.reload()
                        } catch (err) {
                          toast.error("Couldn't delete it", err instanceof Error ? err.message : String(err))
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {current && <Deliveries endpoint={current} />}
        </div>
      </div>
    </div>
  )
}

function CreateEndpoint({ onCreated }: { onCreated: (e: Endpoint) => void }) {
  const [url, setUrl] = React.useState(SINK)
  const [events, setEvents] = React.useState<string[]>(EVENTS.map((e) => e.id))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<ApiError | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<Endpoint>("/v1/webhooks/endpoints", { url: url.trim(), event_types: events }, { note: "add endpoint" })
      toast.success("Endpoint added")
      onCreated(data)
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "error", String(err), {}, ""))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h2 className="text-base font-semibold">Add an endpoint</h2>
      <div className="space-y-1.5">
        <Label htmlFor="url">URL we call</Label>
        <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!error?.fields.url} />
        <FieldError>{error?.fields.url}</FieldError>
        <p className="text-xs text-muted-foreground">The default is a test receiver inside this stack.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Tell me when</legend>
        {EVENTS.map((ev) => (
          <label key={ev.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[hsl(var(--primary))]"
              checked={events.includes(ev.id)}
              onChange={(e) => setEvents((prev) => (e.target.checked ? [...prev, ev.id] : prev.filter((x) => x !== ev.id)))}
            />
            {ev.label}
          </label>
        ))}
        <FieldError>{error?.fields.event_types}</FieldError>
      </fieldset>
      {error && Object.keys(error.fields).length === 0 && <ErrorNote error={error} />}
      <Button type="submit" className="w-full" disabled={busy || !url.trim() || events.length === 0}>
        {busy ? "Adding…" : "Add endpoint"}
      </Button>
    </form>
  )
}

function Deliveries({ endpoint }: { endpoint: Endpoint }) {
  const log = useAsync(
    () => api.get<{ deliveries: Delivery[] }>(`/v1/webhooks/deliveries?endpoint=${endpoint.id}`, { quiet: true }).then((r) => r.data.deliveries ?? []),
    [endpoint.id],
  )
  const rows = log.data ?? []

  return (
    <section className="mt-10" aria-labelledby="deliveries">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="deliveries" className="text-base font-semibold">
          Delivery log
        </h2>
        <Button variant="ghost" size="sm" onClick={log.reload}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>
      <ErrorNote error={log.error} />
      {rows.length === 0 && !log.loading ? (
        <EmptyState title="Nothing delivered yet">Send some money: each transfer event is delivered here.</EmptyState>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="text-right">Tries</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(d.created_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{d.event_type}</TableCell>
                  <TableCell>
                    <Badge variant={d.state === "succeeded" ? "success" : d.state === "failed" ? "destructive" : "warning"}>{d.state}</Badge>
                    {d.last_status > 0 && <span className="ml-2 text-xs text-muted-foreground">HTTP {d.last_status}</span>}
                    {d.last_error && (
                      <p className="mt-1 max-w-[18rem] truncate text-xs text-destructive" title={d.last_error}>
                        {d.last_error}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{d.attempts}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await api.post(`/v1/webhooks/deliveries/${d.id}/replay`, undefined, { note: "replay delivery" })
                          toast.success("Delivery queued again")
                          setTimeout(log.reload, 1500)
                        } catch (err) {
                          toast.error("Couldn't replay it", err instanceof Error ? err.message : String(err))
                        }
                      }}
                    >
                      Replay
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
