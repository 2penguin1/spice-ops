import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'

type State<T> = { data?: T; error?: ApiError; loading: boolean }

/**
 * Loads data when `deps` change, and again when `reload()` is called.
 *
 * A request whose deps changed before it resolved is discarded, so a fast
 * typist cannot end up seeing results for a search term they already replaced.
 *
 * TanStack Query is the right answer once there is a shared cache to
 * invalidate. Four screens do not need one.
 */
export function useApi<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ loading: true })
  const [nonce, setNonce] = useState(0)

  // Held in a ref so a new inline closure on every render does not re-trigger
  // the effect; `deps` alone decides when to reload. Written after render
  // rather than during it — a ref assigned mid-render can be discarded if
  // React renders again before committing.
  const loadRef = useRef(load)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, loading: true }))

    loadRef.current().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (error: unknown) =>
        !cancelled &&
        setState({
          error: error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', String(error), 0),
          loading: false,
        }),
    )

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { ...state, reload }
}

/** Debounces a value so typing in a search box does not fire a request per keystroke. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
