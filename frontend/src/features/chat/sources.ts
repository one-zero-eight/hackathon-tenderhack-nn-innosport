export function pdfSourceUrl(path: string): string | null {
  if (!/^\/staticfiles\/[^/]+\.pdf#page=[1-9]\d*$/.test(path)) return null
  const baseUrl = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')
  return `${baseUrl}${path}`
}
