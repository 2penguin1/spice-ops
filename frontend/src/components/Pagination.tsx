import type { Pagination as PaginationMeta } from '../api/types'

export function Pagination({
  meta,
  onPage,
  noun,
}: {
  meta: PaginationMeta
  onPage: (page: number) => void
  noun: string
}) {
  const { page, size, total, totalPages } = meta
  if (total === 0) return null

  const first = (page - 1) * size + 1
  const last = Math.min(page * size, total)

  return (
    <div className="pagination">
      <span>
        {first}–{last} of {total} {noun}
      </span>
      {totalPages > 1 && (
        <span className="pages">
          <button className="btn ghost small" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            Previous
          </button>
          <span className="num">
            {page} / {totalPages}
          </span>
          <button
            className="btn ghost small"
            onClick={() => onPage(page + 1)}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </span>
      )}
    </div>
  )
}
