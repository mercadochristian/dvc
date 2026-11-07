import 'server-only'
import type { ManagementPayment, PaymentGame, PaymentPage } from '../model/management-payments'
import { isAdministrator } from '../model/permissions'
import type { Booking, StaffRole } from '../model/types'
import { ClubError, uuid } from '../model/validation'
import { ORG, rpc, seal, unseal } from './gateway'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 50
const PAYMENT_FILTERS = ['approved', 'rejected', 'review', 'missing']
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
type PageKey = { time: string; id: string; kind: 'checkout' | 'legacy' | 'game' | 'booking' }
type Cursor = { v: 1; scope: string; key: PageKey }

function parameter(q: URLSearchParams, key: string) {
  if (q.getAll(key).length > 1) throw new ClubError('Duplicate payment filter')
  return q.get(key) || null
}

function paymentCursor(encoded: string | null, scope: string): PageKey | null {
  if (encoded === null) return null
  if (encoded.length < 20 || encoded.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new ClubError('Invalid payment cursor. Reload the list')
  }
  const cursor = unseal<Cursor>(encoded)
  if (cursor?.v !== 1 || cursor.scope !== scope || !cursor.key ||
      !['checkout', 'legacy', 'game', 'booking'].includes(cursor.key.kind) ||
      !STAMP.test(cursor.key.time) || !Number.isFinite(Date.parse(cursor.key.time))) {
    throw new ClubError('Invalid payment cursor. Reload the list')
  }
  return { ...cursor.key, id: uuid(cursor.key.id).toLowerCase() }
}

function paymentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new ClubError('Choose a valid game date')
  }
  return value
}

async function page<Row>(name: string, args: Record<string, unknown>, scope: string, cursor: string | null): Promise<PaymentPage<Row>> {
  const key = paymentCursor(cursor, scope)
  try {
    const response = await rpc<{ rows: Row[]; next_key: PageKey | null }>(name, {
      ...args,
      p_after_time: key?.time ?? null,
      p_after_id: key?.id ?? null,
      ...(name === 'dvc_management_payments' ? { p_after_kind: key?.kind ?? null } : {}),
    })
    return { rows: response.rows, next_cursor: response.next_key ? seal({ v: 1, scope, key: response.next_key }) : null }
  } catch (error) {
    if (error instanceof ClubError && error.message === 'Payment management access denied') {
      throw new ClubError('Access denied', 403, 'ACCESS_DENIED')
    }
    throw error
  }
}

export async function readManagementPayments(q: URLSearchParams, role: StaffRole, actor: string | null) {
  if (!actor || !isAdministrator(role)) throw new ClubError('Access denied', 403, 'ACCESS_DENIED')
  const size = parameter(q, 'limit')
  if (size && (!/^\d{1,2}$/.test(size) || Number(size) < 1 || Number(size) > MAX_PAGE_SIZE)) {
    throw new ClubError('Choose between 1 and 50 payments per page')
  }
  const limit = size ? Number(size) : DEFAULT_PAGE_SIZE
  const encoded = parameter(q, 'after')
  const scope = JSON.stringify([ORG, actor, 'management-payments', limit])
  const mode = parameter(q, 'mode')
  const args = { p_org: ORG, p_user: actor, p_limit: limit }
  if (mode === 'games') {
    const date = paymentDate(parameter(q, 'date') || '')
    return page<PaymentGame>('dvc_management_payment_games', { ...args, p_date: date }, JSON.stringify([scope, mode, date]), encoded)
  }
  if (mode === 'checkout') {
    const checkout = uuid(parameter(q, 'checkout')).toLowerCase()
    return page<Booking>('dvc_management_checkout_bookings', { ...args, p_checkout: checkout }, JSON.stringify([scope, mode, checkout]), encoded)
  }
  if (mode !== null) throw new ClubError('Invalid payments view')
  const query = (parameter(q, 'query') || '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (query.length > 120 || query.includes('\u0000')) throw new ClubError('Search must be at most 120 characters')
  const status = parameter(q, 'status')
  if (status && !PAYMENT_FILTERS.includes(status)) throw new ClubError('Invalid payment status')
  const gameInput = parameter(q, 'game')
  const game = gameInput ? uuid(gameInput).toLowerCase() : null
  return page<ManagementPayment>('dvc_management_payments', {
    ...args, p_query: query, p_status: status, p_game: game,
  }, JSON.stringify([scope, query, status, game]), encoded)
}
