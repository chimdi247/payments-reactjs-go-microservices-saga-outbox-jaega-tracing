import { addTapeEntry, routeOf } from "@/lib/tape"
import { getSession, setSession, userIdFromToken, type Session } from "@/lib/session"
import { uuid } from "@/lib/utils"

// Everything goes through /api, which nginx (or Vite) forwards to the gateway.
const BASE = "/api"

export class ApiError extends Error {
  status: number
  code: string
  fields: Record<string, string>
  traceId: string
  constructor(status: number, code: string, message: string, fields: Record<string, string>, traceId: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.fields = fields
    this.traceId = traceId
  }
}

type Options = {
  body?: unknown
  idempotencyKey?: string
  /** Act as someone else than the signed-in user (the Trace Lab does). */
  token?: string
  /** No Authorization header at all: sign up, sign in, refresh. */
  anonymous?: boolean
  /** Keep it off the trace tape: for polling. */
  quiet?: boolean
  /** What this call was for, in the tape's words. */
  note?: string
}

export type Reply<T> = { data: T; status: number; traceId: string; headers: Headers }

export type TokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
}

export function toSession(email: string, t: TokenResponse): Session {
  return {
    email,
    userId: userIdFromToken(t.access_token),
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  }
}

let refreshing: Promise<Session | null> | null = null

/** Trades the refresh token for a new pair. Refresh tokens rotate: use each once. */
async function refresh(): Promise<Session | null> {
  const s = getSession()
  if (!s) return null
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/v1/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: s.refreshToken }),
        })
        if (!res.ok) {
          setSession(null)
          return null
        }
        const next = toSession(s.email, (await res.json()) as TokenResponse)
        setSession(next)
        return next
      } catch {
        return null
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

function tape(method: string, path: string, status: number, ms: number, res: Response | null, note?: string) {
  addTapeEntry({
    id: uuid(),
    at: Date.now(),
    method,
    path: routeOf(path),
    status,
    ms,
    traceId: res?.headers.get("X-Trace-ID") ?? "",
    requestId: res?.headers.get("X-Request-ID") ?? "",
    note,
  })
}

async function send(method: string, path: string, o: Options, token: string | undefined) {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (o.body !== undefined) headers["Content-Type"] = "application/json"
  if (o.idempotencyKey) headers["Idempotency-Key"] = o.idempotencyKey
  if (token) headers["Authorization"] = `Bearer ${token}`
  const started = performance.now()
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    })
    return { res, ms: performance.now() - started }
  } catch {
    if (!o.quiet) tape(method, path, 0, performance.now() - started, null, o.note)
    throw new ApiError(0, "network", "Can't reach the API. Is the stack running?", {}, "")
  }
}

export async function request<T = unknown>(method: string, path: string, o: Options = {}): Promise<Reply<T>> {
  const pick = () => o.token ?? (o.anonymous ? undefined : getSession()?.accessToken)
  let { res, ms } = await send(method, path, o, pick())

  // An expired access token: refresh once, and say it again.
  if (res.status === 401 && !o.anonymous && !o.token && getSession()) {
    const next = await refresh()
    if (next) {
      const retried = await send(method, path, o, next.accessToken)
      res = retried.res
      ms = retried.ms
    }
  }

  const traceId = res.headers.get("X-Trace-ID") ?? ""
  if (!o.quiet) tape(method, path, res.status, ms, res, o.note)

  const text = await res.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `The request failed (${res.status}).`, e?.fields ?? {}, traceId)
  }
  return { data: json as T, status: res.status, traceId, headers: res.headers }
}

export const api = {
  get: <T,>(path: string, o?: Options) => request<T>("GET", path, o),
  post: <T,>(path: string, body?: unknown, o?: Options) => request<T>("POST", path, { ...o, body }),
  del: <T,>(path: string, o?: Options) => request<T>("DELETE", path, o),
}

/** A file the gateway streams, like a CSV statement, as a Blob. */
export async function download(path: string): Promise<Blob> {
  const get = (token?: string) => fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  let res = await get(getSession()?.accessToken)
  if (res.status === 401) {
    const next = await refresh()
    if (next) res = await get(next.accessToken)
  }
  tape("GET", path, res.status, 0, res, "statement")
  if (!res.ok) throw new ApiError(res.status, "error", `The statement failed (${res.status}).`, {}, "")
  return res.blob()
}

// ---- The gateway's API, as the app uses it ----------------------------------

export type Wallet = { id: string; owner_id: string; currency: string; created_at: string }
export type Balance = { wallet_id: string; balance: { amount: number; currency: string } }
export type Deposit = { transaction_id: string; wallet_id: string; amount: { amount: number; currency: string }; created_at: string }
export type TransferState = "pending" | "in_review" | "funds_held" | "completed" | "compensating" | "failed" | "reversed"
export type Transfer = {
  id: string
  from: string
  to: string
  amount: number
  currency: string
  state: TransferState
  failure_reason?: string
  created_at: string
  updated_at: string
}
export type Entry = {
  id: number
  transaction_id: string
  direction: "debit" | "credit"
  amount: { amount: number; currency: string }
  created_at: string
}
export type EntriesPage = { entries: Entry[]; next_cursor?: string }
export type Quote = {
  id: string
  sell: { amount: number; currency: string }
  buy: { amount: number; currency: string }
  fee: { amount: number; currency: string }
  rate: string
  expires_at: string
  transaction_id?: string
}
export type Endpoint = { id: string; url: string; event_types: string[]; created_at: string; secret?: string }
export type Delivery = {
  id: string
  event_id: string
  event_type: string
  state: string
  attempts: number
  last_status: number
  last_error: string
  last_response_ms: number
  next_attempt_at: string
  created_at: string
}

export const FINAL_STATES: TransferState[] = ["completed", "failed", "reversed"]
