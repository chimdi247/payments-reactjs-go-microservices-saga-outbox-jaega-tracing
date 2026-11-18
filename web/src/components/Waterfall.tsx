import * as React from "react"
import { ArrowRightLeft } from "lucide-react"
import { serviceColor, type SpanRow, type TraceView } from "@/lib/jaeger"
import { cn, formatDuration } from "@/lib/utils"

/**
 * One trace, as a waterfall: a row per span, indented under its parent, drawn
 * as a bar on a shared time axis and coloured by the service it ran in.
 * Hatched bars with an arrow are the hops over NATS: a producer in one
 * service, and a consumer in another, joined by the trace context in the
 * message headers.
 */
export function Waterfall({ trace }: { trace: TraceView }) {
  const [selected, setSelected] = React.useState<string | null>(null)
  const total = Math.max(trace.duration, 1)
  const picked = trace.rows.find((r) => r.id === selected)

  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {trace.services.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: serviceColor(s) }} />
            {s}
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="min-w-[680px]">
          <div className="flex border-b bg-muted/40 text-xs text-muted-foreground">
            <div className="w-[42%] px-3 py-2">Span</div>
            <div className="flex flex-1 justify-between px-3 py-2">
              <span>0</span>
              <span>{formatDuration(total / 1000 / 2)}</span>
              <span>{formatDuration(total / 1000)}</span>
            </div>
          </div>
          <ul role="list">
            {trace.rows.map((r) => (
              <Row key={r.id} row={r} total={total} active={r.id === selected} onSelect={() => setSelected(r.id === selected ? null : r.id)} />
            ))}
          </ul>
        </div>
      </div>

      {picked && <SpanDetails row={picked} />}
    </div>
  )
}

function Row({ row, total, active, onSelect }: { row: SpanRow; total: number; active: boolean; onSelect: () => void }) {
  const left = (row.start / total) * 100
  const width = Math.max((row.duration / total) * 100, 0.4)
  const isEvent = row.kind === "producer" || row.kind === "consumer"
  return (
    <li>
      <button onClick={onSelect} aria-pressed={active} className={cn("flex w-full items-center border-b text-left text-sm last:border-b-0 hover:bg-muted/50", active && "bg-accent")}>
        <div className="w-[42%] min-w-0 py-1.5 pr-2" style={{ paddingLeft: `${12 + row.depth * 14}px` }}>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: serviceColor(row.service) }} />
            <span className="truncate font-medium">{row.name}</span>
            {isEvent && <ArrowRightLeft className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="event" />}
            {row.error && <span className="shrink-0 rounded-sm bg-destructive/10 px-1 text-[0.6875rem] font-medium text-destructive">error</span>}
          </div>
          <div className="truncate pl-3.5 text-xs text-muted-foreground">{row.service}</div>
        </div>
        <div className="relative h-8 flex-1">
          <div
            className={cn("absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm", isEvent && "opacity-70")}
            style={{
              left: `${left}%`,
              width: `${width}%`,
              background: row.error ? "hsl(var(--destructive))" : serviceColor(row.service),
              backgroundImage: isEvent ? "repeating-linear-gradient(135deg, rgb(255 255 255 / .35) 0 3px, transparent 3px 6px)" : undefined,
            }}
          />
          <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 text-xs text-muted-foreground" style={{ left: `${Math.min(left + width, 86)}%` }}>
            {formatDuration(row.duration / 1000)}
          </span>
        </div>
      </button>
    </li>
  )
}

const SHOWN_TAGS = [
  "http.request.method",
  "http.method",
  "http.route",
  "http.response.status_code",
  "http.status_code",
  "rpc.service",
  "rpc.method",
  "rpc.grpc.status_code",
  "messaging.system",
  "messaging.destination.name",
  "db.statement",
  "db.query.text",
  "otel.status_description",
]

function SpanDetails({ row }: { row: SpanRow }) {
  const tags = SHOWN_TAGS.filter((k) => row.tags[k] !== undefined)
  return (
    <div className="mt-3 rounded-lg border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{row.name}</p>
        <p className="text-xs text-muted-foreground">
          {row.service} · {row.kind} · {formatDuration(row.duration / 1000)}
        </p>
      </div>
      {row.queueDelay !== undefined && (
        <p className="mt-2 text-muted-foreground">This event waited {formatDuration(row.queueDelay / 1000)} on NATS between the producer finishing and this consumer starting.</p>
      )}
      {tags.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {tags.map((k) => (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all font-mono text-xs">{row.tags[k]}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  )
}
