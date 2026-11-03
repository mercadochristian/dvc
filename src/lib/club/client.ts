export class RequestError extends Error {
  constructor(message: string, public reference?: string) { super(message) }
}
export async function read<T>(view: string, params: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`/api/club?${new URLSearchParams({ view, ...params })}`, { cache: 'no-store' })
  return unpack<T>(response)
}
export async function act<T = { id: string }>(action: string, data: unknown): Promise<T> {
  return unpack<T>(await fetch('/api/club', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) }))
}
export async function upload(data: FormData): Promise<{ path?: string }> {
  return unpack(await fetch('/api/club/upload', { method: 'POST', body: data }))
}
async function unpack<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new RequestError(value.error || 'Something went wrong. Try again', value.reference)
  return value as T
}
export function money(cents: number) { return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100) }
export function dateLabel(value: string) { return new Date(value).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' }) }
export function timeLabel(value: string) { return new Date(value).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) }
export function manilaDate(value = new Date()) { return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) }
export function addDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
export function monday() { const today = manilaDate(); const day = new Date(`${today}T00:00:00Z`).getUTCDay(); return addDays(today, -(day + 6) % 7) }
