import { useSearchParams } from 'react-router-dom'

/**
 * Filters kept in the URL so a view can be shared and reopened.
 *
 * Changing a filter replaces the history entry instead of pushing one —
 * otherwise every keystroke in a search box becomes a Back step, and getting
 * out of a search means pressing Back once per character. Paging still pushes,
 * because going back a page is a move a person means to undo.
 */
export function useFilterParams() {
  const [params, setParams] = useSearchParams()

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params)

    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }

    const paging = 'page' in changes
    if (!paging) next.delete('page')

    setParams(next, { replace: !paging })
  }

  return {
    params,
    update,
    clear: () => setParams(new URLSearchParams(), { replace: true }),
    /** Never NaN: a hand-edited ?page=abc should show page one, not an error. */
    page: Math.max(1, Number(params.get('page')) || 1),
  }
}
