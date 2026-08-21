// oxlint-disable react-hooks/exhaustive-deps, react/set-state-in-effect --
// this hook takes its dependency list from the caller and sets state when a
// request resolves. Neither is statically checkable, and both are the point.
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'

type State<T> = { data?: T; error?: ApiError; loading: boolean }

/**
 * Loads when `deps` change, and again on `reload()`.
 *
 * A response whose deps already changed is dropped, so a fast typist never sees
 * results for a search term they have replaced.
 */
export function useApi<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ loading: true })
  const [nonce, setNonce] = useState(0)

  // A ref, so a fresh closure each render does not re-trigger the effect —
  // `deps` alone decides that. Assigned after render, not during: a ref written
  // mid-render is discarded if React renders again before committing.
  const loadRef = useRef(load)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let cancelled = false

    // Keep whatever is on screen and mark it stale, rather than blanking it —
    // a refetch should not flash the page back to a skeleton.
    setState((current) => (current.loading ? current : { ...current, loading: true }))

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
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { ...state, reload }
}

/** Holds a value still, so typing does not fire a request per keystroke. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
