/**
 * The handful of glyphs the navigation needs, as inline paths.
 *
 * An icon library would be a dependency and a bundle for six shapes we can
 * draw here. Paths are 24×24 outlines so they line up with any we add later.
 */

const PATHS = {
  orders: 'M4 3h11l5 5v13H4z M15 3v5h5 M8 12h8 M8 16h5',
  kitchen: 'M12 3c3 3.5 1 5 1 7a3 3 0 0 0 6 0c0 6-3 11-7 11s-7-4-7-9c0-3 2-5 4-6',
  customers: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M22 20v-2a4 4 0 0 0-3-3.9',
  dashboard: 'M3 20h18 M6 20V10 M12 20V4 M18 20v-7',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  rupee: 'M6 4h12 M6 9h12 M6 20l7-7c3 0 4-2 4-4 0-2-1-4-4-4H8',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 7v5l3 2',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M5.6 5.6l12.8 12.8',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, className = 'nav-icon' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].split(' M').map((segment, index) => (
        <path key={segment} d={index === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  )
}
