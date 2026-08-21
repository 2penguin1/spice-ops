/** Placeholder rows, so the layout does not jump when data arrives. */
export function SkeletonRows({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}>
              <div className="skeleton" style={{ width: `${55 + ((row + column) % 4) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}
