import { useCallback, useSyncExternalStore } from "react"
import { useSession } from "@/lib/session"

// Small localStorage-backed state, shared between components. The gateway has
// no "list my wallets" route, so the app remembers the wallets it opened for
// each user, and the recipients they saved.
const cache = new Map<string, unknown>()
const subs = new Map<string, Set<() => void>>()

function read<T>(key: string, initial: T): T {
  if (cache.has(key)) return cache.get(key) as T
  let v = initial
  try {
    const raw = localStorage.getItem(key)
    if (raw) v = JSON.parse(raw) as T
  } catch {
    /* unreadable: start empty */
  }
  cache.set(key, v)
  return v
}

function write<T>(key: string, v: T) {
  cache.set(key, v)
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* storage blocked */
  }
  subs.get(key)?.forEach((f) => f())
}

export function useStored<T>(key: string, initial: T) {
  const value = useSyncExternalStore(
    (cb) => {
      let set = subs.get(key)
      if (!set) subs.set(key, (set = new Set()))
      set.add(cb)
      return () => set!.delete(cb)
    },
    () => read(key, initial),
  )
  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = read(key, initial)
      write(key, typeof next === "function" ? (next as (p: T) => T)(prev) : next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return [value, update] as const
}

export type LocalWallet = { id: string; currency: string; createdAt: string }
export type Contact = { walletId: string; label: string; currency?: string }

const NO_WALLETS: LocalWallet[] = []
const NO_CONTACTS: Contact[] = []

export function useWallets() {
  const s = useSession()
  const key = `ledgerline.wallets.${s?.userId || s?.email || "anon"}`
  const [wallets, set] = useStored<LocalWallet[]>(key, NO_WALLETS)
  const add = useCallback((w: LocalWallet) => set((prev) => (prev.some((p) => p.id === w.id) ? prev : [...prev, w])), [set])
  const remove = useCallback((id: string) => set((prev) => prev.filter((p) => p.id !== id)), [set])
  return { wallets, add, remove }
}

export function useContacts() {
  const s = useSession()
  const key = `ledgerline.contacts.${s?.userId || s?.email || "anon"}`
  const [contacts, set] = useStored<Contact[]>(key, NO_CONTACTS)
  const save = useCallback(
    (c: Contact) => set((prev) => [...prev.filter((p) => p.walletId !== c.walletId), c].sort((a, b) => a.label.localeCompare(b.label))),
    [set],
  )
  const remove = useCallback((walletId: string) => set((prev) => prev.filter((p) => p.walletId !== walletId)), [set])
  return { contacts, save, remove }
}
