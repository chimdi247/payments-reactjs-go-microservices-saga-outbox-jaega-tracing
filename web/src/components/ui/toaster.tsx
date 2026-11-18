import * as React from "react"
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

// A very small toast system: toast.success("Wallet opened") from anywhere.
type Kind = "success" | "error" | "info"
type Item = { id: number; kind: Kind; title: string; body?: string }

let items: Item[] = []
let next = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function push(kind: Kind, title: string, body?: string) {
  const id = next++
  items = [...items, { id, kind, title, body }].slice(-4)
  emit()
  setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4500)
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id)
  emit()
}

export const toast = {
  success: (title: string, body?: string) => push("success", title, body),
  error: (title: string, body?: string) => push("error", title, body),
  info: (title: string, body?: string) => push("info", title, body),
}

export function Toaster() {
  const list = React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => items,
  )
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,380px)] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0"
      role="status"
      aria-live="polite"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-md border bg-card p-3 shadow-lg animate-in fade-in-0 slide-in-from-bottom-2",
            t.kind === "error" && "border-destructive/40",
          )}
        >
          {t.kind === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
          {t.kind === "error" && <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
          {t.kind === "info" && <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.title}</p>
            {t.body && <p className="mt-0.5 break-words text-sm text-muted-foreground">{t.body}</p>}
          </div>
          <button className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
