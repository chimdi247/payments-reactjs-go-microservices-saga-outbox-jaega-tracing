import * as React from "react"
import { Check, Copy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn, copyText } from "@/lib/utils"
import type { TransferState } from "@/lib/api"

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-prose">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </header>
  )
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = React.useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("h-7 gap-1 px-2 text-xs", className)}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : label}
    </Button>
  )
}

/** An ID or hash: monospace, selectable, and never wider than the line. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("break-all font-mono text-[0.8125rem]", className)}>{children}</span>
}

const STATE_LABEL: Record<TransferState, string> = {
  pending: "Accepted",
  in_review: "Held for review",
  funds_held: "Funds held",
  completed: "Completed",
  compensating: "Giving funds back",
  failed: "Refused",
  reversed: "Reversed",
}

export function stateLabel(s: TransferState): string {
  return STATE_LABEL[s] ?? s
}

export function StateBadge({ state }: { state: TransferState }) {
  const variant = state === "completed" ? "success" : state === "failed" || state === "reversed" ? "destructive" : state === "in_review" ? "warning" : "default"
  return <Badge variant={variant}>{stateLabel(state)}</Badge>
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {msg}
    </p>
  )
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return <p className="mt-1 text-xs text-destructive">{children}</p>
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-input px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}
