import { useSyncExternalStore } from "react"

// Every request the app makes prints a line on the trace tape: what was
// called, how it went, and the ID of the trace it started in the backend.
export type TapeEntry = {
  id: string
  at: number
  method: string
  path: string // with IDs shown as {id}
  status: number // 0 when the request never got an answer
  ms: number
  traceId: string
  requestId: string
  note?: string
}

const MAX = 80
const KEY = "ledgerline.tape"
const listeners = new Set<() => void>()
let entries: TapeEntry[] = load()

function load(): TapeEntry[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as TapeEntry[]) : []
  } catch {
    return []
  }
}

function emit() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export function addTapeEntry(e: TapeEntry) {
  entries = [e, ...entries].slice(0, MAX)
  emit()
}

export function clearTape() {
  entries = []
  emit()
}

export function useTape(): TapeEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => entries,
  )
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export function routeOf(path: string): string {
  return path.split("?")[0].replace(UUID, "{id}")
}
