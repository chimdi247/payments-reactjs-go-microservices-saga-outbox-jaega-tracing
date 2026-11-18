import { useCallback, useEffect, useRef, useState } from "react"

/** Runs fn when deps change, and again on reload(). The newest call wins. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    const id = ++latest.current
    setLoading(true)
    fn()
      .then((v) => {
        if (id !== latest.current) return
        setData(v)
        setError(undefined)
      })
      .catch((e: unknown) => {
        if (id !== latest.current) return
        setError(e instanceof Error ? e : new Error(String(e)))
      })
      .finally(() => {
        if (id === latest.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** Calls fn every intervalMs while enabled, until it returns true ("done"). */
export function usePoll(fn: () => Promise<boolean | void>, intervalMs: number, enabled: boolean) {
  const saved = useRef(fn)
  saved.current = fn
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const loop = async () => {
      let done = false
      try {
        done = (await saved.current()) === true
      } catch {
        /* keep polling: the next call may work */
      }
      if (!stopped && !done) timer = setTimeout(loop, intervalMs)
    }
    void loop()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [intervalMs, enabled])
}
