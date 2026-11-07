import 'server-only'
import { ORG, db } from './gateway'

interface GameNotice {
  id: string
  lease_token: string
  recipient: string
  event: 'rescheduled' | 'cancelled'
  venue: string
  old_starts_at: string
  old_ends_at: string
  starts_at: string
  ends_at: string
}

type Outcome = 'sent' | 'retry' | 'defer' | 'error'

function transport() {
  const from = process.env.DVC_GAME_MAIL_FROM
  const key = process.env.DVC_GAME_MAIL_RESEND_KEY
  const testUrl = process.env.DVC_GAME_MAIL_TEST_URL
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost):\d+(?:\/[^\s]*)?$/
  if (testUrl) {
    if (from && loopback.test(testUrl) && loopback.test(process.env.SUPABASE_URL || '')) {
      return { from, url: testUrl, test: true }
    }
    return null
  }
  return from && key && process.env.SUPABASE_URL?.startsWith('https://')
    ? { from, url: 'https://api.resend.com/emails', key, test: false } : null
}

export function gameNoticeDeliveryConfigured() {
  return transport() !== null
}

const manilaDateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
})

function scheduleLabel(start: string, end: string) {
  return `${manilaDateTime.format(new Date(start))} to ${manilaDateTime.format(new Date(end))} Manila time`
}

function message(notice: GameNotice) {
  const schedule = scheduleLabel(notice.starts_at, notice.ends_at)
  return notice.event === 'cancelled'
    ? { subject: 'DVC game cancelled', text: `The DVC game at ${notice.venue} scheduled for ${schedule} has been cancelled.\n\nIf you paid for this game, contact the club about next steps.` }
    : { subject: 'DVC game schedule changed', text: `The schedule for your DVC game at ${notice.venue} has changed.\n\nPrevious schedule: ${scheduleLabel(notice.old_starts_at, notice.old_ends_at)}\nNew schedule: ${schedule}` }
}

async function send(notice: GameNotice, config: NonNullable<ReturnType<typeof transport>>, deadline: AbortSignal): Promise<Outcome> {
  if (config.test && !/@[^@]+\.(?:test|invalid)$/i.test(notice.recipient)) return 'error'
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `dvc-game-notice/${notice.id}`,
        ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
      },
      body: JSON.stringify({ from: config.from, to: [notice.recipient], ...message(notice) }),
      signal: AbortSignal.any([deadline, AbortSignal.timeout(4_000)]),
    })
    if (response.ok) {
      const result: { id?: unknown } | null = await response.json().catch(() => null)
      return typeof result?.id === 'string' && result.id.length > 0 ? 'sent' : 'retry'
    }
    if ([401, 403].includes(response.status)) return 'defer'
    if ([408, 409, 429].includes(response.status) || response.status >= 500) return 'retry'
    return 'error'
  } catch {
    return 'retry'
  }
}

export async function deliverGameNotices() {
  const config = transport()
  if (!config) return null
  const deadline = AbortSignal.timeout(45_000)
  const notices = await db<GameNotice[]>('rpc/dvc_claim_game_notices', {
    method: 'POST', body: JSON.stringify({ p_org: ORG }), signal: deadline,
  })
  const results = { sent: 0, retryRequested: 0, deferred: 0, error: 0, unsettled: 0 }
  for (const notice of notices) {
    if (deadline.aborted) {
      results.unsettled += notices.length - Object.values(results).reduce((count, value) => count + value, 0)
      break
    }
    const outcome = await send(notice, config, deadline)
    try {
      const settled = await db<boolean>('rpc/dvc_finish_game_notice', {
        method: 'POST',
        body: JSON.stringify({ p_org: ORG, p_id: notice.id, p_lease: notice.lease_token, p_outcome: outcome }),
        signal: deadline,
      })
      if (settled) {
        const counter = outcome === 'retry' ? 'retryRequested' : outcome === 'defer' ? 'deferred' : outcome
        results[counter]++
      }
      else results.unsettled++
    } catch {
      results.unsettled++
    }
  }
  return results
}
