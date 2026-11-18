import { Link } from "react-router-dom"
import { ArrowUpRight, Trash2 } from "lucide-react"
import { clearTape, useTape, type TapeEntry } from "@/lib/tape"
import { cn, formatDuration, formatTime, shortId } from "@/lib/utils"

function statusClass(status: number) {
  if (status === 0 || status >= 500) return "text-destructive"
  if (status >= 400) return "text-warning"
  return "text-success"
}

/**
 * The trace tape: a till-roll of every request this app made. Each line ends
 * with the trace its request started in the backend: open it to see the same
 * request cross the gateway, wallet, transfer, notification and webhook
 * services, and the events between them.
 */
export function TraceTape({ className }: { className?: string }) {
  const entries = useTape()
  return (
    <aside aria-label="Trace tape" className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between px-1 pb-2">
        <h2 className="text-sm font-semibold">Trace tape</h2>
        {entries.length > 0 && (
          <button onClick={clearTape} className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
      <div className="tape-paper min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 shadow-sm">
        {entries.length === 0 ? (
          <p className="py-6 text-sm leading-relaxed text-muted-foreground">Every request you make prints a line here, with a link to its trace.</p>
        ) : (
          <ol>
            {entries.map((e, i) => (
              <TapeLine key={e.id} entry={e} first={i === 0} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  )
}

function TapeLine({ entry: e, first }: { entry: TapeEntry; first: boolean }) {
  return (
    <li className={cn("py-2.5 font-mono text-xs", !first && "tape-rule")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="font-medium">{e.method}</span> {e.path}
        </span>
        <span className={cn("shrink-0 font-medium", statusClass(e.status))}>{e.status === 0 ? "ERR" : e.status}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-muted-foreground">
        <span>
          {formatTime(e.at)} · {e.ms > 0 ? formatDuration(e.ms) : "n/a"}
          {e.note ? ` · ${e.note}` : ""}
        </span>
        {e.traceId ? (
          <Link to={`/traces/${e.traceId}`} className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-primary hover:underline" title={`Trace ${e.traceId}`}>
            {shortId(e.traceId, 7)} <ArrowUpRight className="h-3 w-3" />
          </Link>
        ) : (
          <span>no trace</span>
        )}
      </div>
    </li>
  )
}
