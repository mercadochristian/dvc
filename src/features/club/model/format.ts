export function money(cents: number) { return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100) }
export function dateLabel(value: string) { return new Date(value).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' }) }
export function timeLabel(value: string) { return new Date(value).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) }
export function manilaDate(value = new Date()) { return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) }
export function addDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
export function monday() { const today = manilaDate(); const day = new Date(`${today}T00:00:00Z`).getUTCDay(); return addDays(today, -(day + 6) % 7) }
