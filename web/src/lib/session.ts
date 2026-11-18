import { useSyncExternalStore } from "react"

// The signed-in user. Tokens live in localStorage so a reload keeps you signed
// in. Fine for a demo: a production app would keep them out of reach of scripts.
export type Session = {
  email: string
  userId: string
  accessToken: string
  refreshToken: string
  expiresAt: number // ms since the epoch
}

const KEY = "ledgerline.session"
const listeners = new Set<() => void>()
let current: Session | null = read()

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function getSession(): Session | null {
  return current
}

export function setSession(s: Session | null) {
  current = s
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked: the session lasts until reload */
  }
  listeners.forEach((l) => l())
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/** The user's ID is the `sub` claim of the access token. */
export function userIdFromToken(token: string): string {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const claims = JSON.parse(atob(part)) as { sub?: string }
    return claims.sub ?? ""
  } catch {
    return ""
  }
}
