// Local email substitute. This never sends email or modifies the outbox.
// Node 22+: node --experimental-strip-types scripts/e2e/render-booking-email.mjs <message-id>
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflight, artifactDirectory } from './target-guard.mjs'
import { createBookingLinkToken } from '../../src/features/club/server/booking-link-token.ts'

const target = preflight()
const id = process.argv[2]
if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Supply a local outbox message ID')
const query = new URLSearchParams({ id: `eq.${id}`, organization_id: `eq.${target.organizationId}`, select: 'id,recipient,payload' })
const response = await fetch(`${target.supabaseUrl}/rest/v1/booking_confirmation_outbox?${query}`, {
  headers: { apikey: target.serviceRoleKey, Authorization: `Bearer ${target.serviceRoleKey}` },
})
if (!response.ok) throw new Error('Could not read local outbox')
const [message] = await response.json()
if (!message?.payload?.checkout_reference || !Array.isArray(message.payload.games)) throw new Error('Guest checkout confirmation not found')
if (!/@example\.(test|invalid)$/.test(message.recipient)) throw new Error('Use a synthetic QA recipient')
const origin = process.env.DVC_BOOKING_EMAIL_LOCAL_ORIGIN || target.appUrl
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw new Error('Booking email preview requires a local origin')
const url = new URL('/club/booking-link', origin)
url.hash = createBookingLinkToken(message.id, target.organizationId, target.sessionSecret)
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const schedule = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
const time = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', timeStyle: 'short' })
const games = message.payload.games.map(game => `<li style="margin:12px 0"><strong>${escape(game.venue)}</strong><br>${schedule.format(new Date(game.starts_at))}–${time.format(new Date(game.ends_at))} Manila time</li>`).join('')
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Your DVC booking is confirmed</title><body style="margin:0;padding:24px;background:#101314;color:#f1f2ed;font:16px/1.5 system-ui"><main style="max-width:520px;margin:auto;padding:24px;background:#191d1f;border-radius:12px"><p style="color:#eccb73">Dreamers Volleyball Club</p><h1>Your booking is confirmed</h1><ul style="padding-left:20px">${games}</ul><p><a style="display:inline-block;padding:10px 16px;border-radius:8px;background:#eccb73;color:#191b16;font-weight:600" href="${escape(url.href)}">Open my booking</a></p><p>Sign in with the email you used to book to save this checkout to your account. This link is valid for 7 days.</p></main></body></html>`
const output = join(artifactDirectory(), target.runId, 'local-mail')
await mkdir(output, { recursive: true, mode: 0o700 })
await writeFile(join(output, `${id}.html`), html, { flag: 'wx', mode: 0o600 })
console.log('Synthetic confirmation email saved in the run’s local-mail directory.')
