import type { ApiError } from '../api/client'

/**
 * Shows what went wrong and, where we can, what to do about it. The server's
 * message is already written for a person, so it is shown as-is.
 */
export function ErrorBanner({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="banner" role="alert">
      <div style={{ flex: 1 }}>
        {error.message} <code>{error.code}</code>
      </div>
      {onRetry && (
        <button type="button" className="link-btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
