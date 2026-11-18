import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CopyButton, ErrorNote, Mono, PageHeader } from "@/components/common"
import { Waterfall } from "@/components/Waterfall"
import { fetchTrace, jaegerUrl, type TraceView } from "@/lib/jaeger"
import { usePoll } from "@/lib/hooks"
import { formatDuration } from "@/lib/utils"

// Spans reach Jaeger a few seconds after they end, and a payment keeps making
// them after its HTTP answer: the saga, the events, the notification email.
// So look again for a while, until the trace stops growing.
const POLL_MS = 2500
const MAX_WAIT_MS = 90_000
const SETTLED_AFTER = 4 // polls with no new spans

export default function TraceDetailPage() {
  const { traceId = "" } = useParams()
  const [trace, setTrace] = React.useState<TraceView | null>(null)
  const [error, setError] = React.useState<unknown>(null)
  const [settled, setSettled] = React.useState(false)
  const [expired, setExpired] = React.useState(false)
  const [round, setRound] = React.useState(0)
  const state = React.useRef({ started: Date.now(), spans: -1, same: 0 })

  React.useEffect(() => {
    state.current = { started: Date.now(), spans: -1, same: 0 }
    setTrace(null)
    setError(null)
    setSettled(false)
    setExpired(false)
  }, [traceId, round])

  usePoll(
    async () => {
      const st = state.current
      try {
        const t = await fetchTrace(traceId)
        setError(null)
        if (t) {
          setTrace(t)
          st.same = t.rows.length === st.spans ? st.same + 1 : 0
          st.spans = t.rows.length
          if (st.same >= SETTLED_AFTER) {
            setSettled(true)
            return true
          }
        }
      } catch (err) {
        setError(err)
      }
      if (Date.now() - st.started > MAX_WAIT_MS) {
        setExpired(true)
        return true
      }
      return false
    },
    POLL_MS,
    !!traceId && !settled && !expired,
  )

  return (
    <div>
      <Link to="/traces" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All traces
      </Link>
      <PageHeader
        title="Trace"
        description={
          <span className="flex flex-wrap items-center gap-1">
            <Mono>{traceId}</Mono>
            <CopyButton text={traceId} />
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRound((r) => r + 1)}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={jaegerUrl(traceId)} target="_blank" rel="noreferrer">
                Open in Jaeger <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        }
      />

      <ErrorNote error={error} />

      {!trace ? (
        expired ? (
          <p className="rounded-lg border border-dashed border-input p-6 text-sm text-muted-foreground">
            Jaeger doesn't have this trace. The stack may have been restarted since: Jaeger keeps traces in memory.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Waiting for the services to report their spans…</p>
            <Skeleton className="h-40 w-full" />
          </div>
        )
      ) : (
        <>
          <dl className="mb-6 flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <Fact label="Duration" value={formatDuration(trace.duration / 1000)} />
            <Fact label="Spans" value={String(trace.rows.length)} />
            <Fact label="Services" value={String(trace.services.length)} />
            <Fact label="Event spans (NATS)" value={String(trace.events)} />
            <Fact label="Errors" value={String(trace.errors)} bad={trace.errors > 0} />
          </dl>
          <Waterfall trace={trace} />
          {!settled && <p className="mt-3 text-xs text-muted-foreground">Still listening for late spans…</p>}
        </>
      )}
    </div>
  )
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={bad ? "text-lg font-semibold text-destructive" : "text-lg font-semibold"}>{value}</dd>
    </div>
  )
}
