import { createHmac, timingSafeEqual } from 'node:crypto'

const lifetime = 7 * 24 * 60 * 60
const tokenPattern = /^([a-f0-9-]{36})\.(\d{10})\.([a-f0-9]{64})$/

function signature(payload: string, organization: string, secret: string) {
  return createHmac('sha256', secret).update(`guest-checkout-link:v1:${organization}:${payload}`).digest('hex')
}

export function createBookingLinkToken(message: string, organization: string, secret: string, now = Date.now()) {
  if (secret.length < 32) throw new Error('Booking link signing is unavailable')
  const payload = `${message}.${Math.floor(now / 1000) + lifetime}`
  return `${payload}.${signature(payload, organization, secret)}`
}

export function verifyBookingLinkToken(token: unknown, organization: string, secret: string, now = Date.now()) {
  if (typeof token !== 'string' || secret.length < 32) return null
  const match = tokenPattern.exec(token)
  if (!match) return null
  const [, message, expires, mac] = match
  if (Number(expires) <= Math.floor(now / 1000)) return null
  const expected = signature(`${message}.${expires}`, organization, secret)
  return timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex')) ? { message, expires: Number(expires) } : null
}
