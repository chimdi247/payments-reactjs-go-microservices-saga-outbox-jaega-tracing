// Reads one trace from Jaeger's query API (through /jaeger-api) and turns it
// into rows for the waterfall: a tree of spans, across every service.

export type SpanRow = {
  id: string
  parentId?: string
  service: string
  name: string
  kind: string // server, client, producer, consumer or internal
  start: number // microseconds since the trace began
  duration: number // microseconds
  depth: number
  error: boolean
  tags: Record<string, string>
  /** For a consumer span: how long its event waited, after the producer finished. */
  queueDelay?: number
}

export type TraceView = {
  traceId: string
  rows: SpanRow[]
  services: string[]
  duration: number // microseconds
  errors: number
  events: number // producer/consumer spans: hops over the message bus
}

type JTag = { key: string; value: unknown }
type JSpan = {
  spanID: string
  operationName: string
  references?: { refType: string; spanID: string }[]
  startTime: number
  duration: number
  tags?: JTag[]
  processID: string
}
type JTrace = { traceID: string; spans: JSpan[]; processes: Record<string, { serviceName: string }> }

/** null when Jaeger doesn't know the trace (yet): spans reach it a few seconds after they end. */
export async function fetchTrace(traceId: string): Promise<TraceView | null> {
  const res = await fetch(`/jaeger-api/traces/${encodeURIComponent(traceId)}`, { headers: { Accept: "application/json" } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Jaeger answered ${res.status}`)
  const body = (await res.json()) as { data?: JTrace[] | null }
  const trace = body.data?.[0]
  if (!trace || trace.spans.length === 0) return null
  return toView(trace)
}

function toView(t: JTrace): TraceView {
  const spans = t.spans
  const byId = new Map(spans.map((s) => [s.spanID, s]))
  const children = new Map<string, JSpan[]>()
  const roots: JSpan[] = []
  for (const s of spans) {
    const parent = s.references?.find((r) => byId.has(r.spanID))?.spanID
    if (parent) {
      const list = children.get(parent) ?? []
      list.push(s)
      children.set(parent, list)
    } else {
      roots.push(s)
    }
  }
  const byStart = (a: JSpan, b: JSpan) => a.startTime - b.startTime
  roots.sort(byStart)

  const origin = Math.min(...spans.map((s) => s.startTime))
  const end = Math.max(...spans.map((s) => s.startTime + s.duration))
  const rows: SpanRow[] = []
  const services: string[] = []

  const tagMap = (s: JSpan) => Object.fromEntries((s.tags ?? []).map((x) => [x.key, String(x.value)]))
  const visit = (s: JSpan, depth: number, parent?: JSpan) => {
    const tags = tagMap(s)
    const service = t.processes[s.processID]?.serviceName ?? "unknown"
    if (!services.includes(service)) services.push(service)
    const kind = tags["span.kind"] ?? "internal"
    const row: SpanRow = {
      id: s.spanID,
      parentId: parent?.spanID,
      service,
      name: s.operationName,
      kind,
      start: s.startTime - origin,
      duration: s.duration,
      depth,
      error: tags["error"] === "true" || tags["otel.status_code"] === "ERROR",
      tags,
    }
    if (kind === "consumer" && parent && tagMap(parent)["span.kind"] === "producer") {
      row.queueDelay = Math.max(0, s.startTime - (parent.startTime + parent.duration))
    }
    rows.push(row)
    for (const c of (children.get(s.spanID) ?? []).sort(byStart)) visit(c, depth + 1, s)
  }
  for (const r of roots) visit(r, 0)

  return {
    traceId: t.traceID,
    rows,
    services,
    duration: end - origin,
    errors: rows.filter((r) => r.error).length,
    events: rows.filter((r) => r.kind === "producer" || r.kind === "consumer").length,
  }
}

const KNOWN = ["gateway", "wallet", "auth", "transfer", "notification", "webhook"]

/** The CSS colour for a service: the same one on the tape, and in the waterfall. */
export function serviceColor(service: string): string {
  return `hsl(var(--svc-${KNOWN.includes(service) ? service : "web"}))`
}

export function jaegerUrl(traceId: string): string {
  // Jaeger's own UI is published next to the app, on its default port.
  return `${location.protocol}//${location.hostname}:16686/trace/${traceId}`
}
