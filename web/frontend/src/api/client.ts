// Orval mutator: a single typed fetch wrapper every generated hook routes
// through. Centralises the API base URL and turns non-2xx into a typed error.

const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`API ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

export const customFetch = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const headers = new Headers(options.headers)
  // FormData must NOT carry an explicit Content-Type: the browser sets it
  // along with the multipart boundary. Only force JSON for non-FormData bodies.
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${BASE}${url}`, { ...options, headers })
  if (!res.ok) {
    throw new ApiError(res.status, await res.text().catch(() => ''))
  }
  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  return (contentType.includes('application/json') ? await res.json() : await res.text()) as T
}

/** Absolute URL for a binary media endpoint (video/audio `src`). */
export const mediaUrl = (path: string): string => `${BASE}${path}`
