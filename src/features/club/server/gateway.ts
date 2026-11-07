import 'server-only'
import { cookies } from 'next/headers'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import type { StaffRole } from '../model/types'
import { ClubError } from '../model/validation'

export const ORG = process.env.DVC_ORGANIZATION_ID || '00000000-0000-0000-0000-000000000001'
export function configured() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_ANON_KEY && (process.env.DVC_SESSION_SECRET?.length || 0) >= 32) }
export function config() {
  if (!configured()) throw new ClubError('App setup is not complete yet', 503, 'SETUP_REQUIRED')
  const url = process.env.SUPABASE_URL!.replace(/\/$/, '')
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url)) throw new ClubError('Check server configuration', 503, 'SETUP_REQUIRED')
  return { url, key: process.env.SUPABASE_SERVICE_ROLE_KEY!, anon: process.env.SUPABASE_ANON_KEY! }
}
export function seal(value: unknown): string {
  if ((process.env.DVC_SESSION_SECRET?.length || 0) < 32) throw new ClubError('Check session configuration', 503)
  const key = createHash('sha256').update(process.env.DVC_SESSION_SECRET!).digest(), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url')
}
export function unseal<T>(value: string): T | null {
  try {
    if (!process.env.DVC_SESSION_SECRET) return null
    const bytes = Buffer.from(value, 'base64url'), key = createHash('sha256').update(process.env.DVC_SESSION_SECRET).digest()
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(-16))
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString()) as T
  } catch { return null }
}
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' }
export async function setCookie(name: string, value: string, maxAge = 2592000) { (await cookies()).set(name, value, { ...cookieOptions, maxAge }) }
export async function setAuthSession(pair: TokenPair, remember: boolean) {
  const value = seal({ access_token: pair.access_token, refresh_token: pair.refresh_token, remember })
  if (remember) await setCookie('dvc-auth', value)
  else (await cookies()).set('dvc-auth', value, cookieOptions)
}
export function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
export async function guest(create = false): Promise<string | null> {
  const jar = await cookies(); let token = jar.get('dvc-guest')?.value
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    if (!create) return null
    token = randomBytes(32).toString('hex'); await setCookie('dvc-guest', token, 31536000)
  }
  return hash(token)
}
export async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = config()
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers }, cache: 'no-store' })
  if (!res.ok) {
    // Database's deliberate exceptions are user-facing; never expose SQL/internal details.
    const error = await res.json().catch(() => ({}))
    if (error.code === '42501') throw new ClubError('Access denied', 403, 'ACCESS_DENIED')
    if (error.code === 'P0001' && typeof error.message === 'string') throw new ClubError(error.message, 409, 'CONFLICT')
    throw new ClubError('Could not complete that action', 502, 'DATABASE_ERROR')
  }
  if (res.status === 204) return undefined as T
  // PostgREST minimal writes can return 201 with no body. Nonempty bodies
  // must still be valid JSON so malformed upstream responses remain failures.
  const body = await res.text()
  return body.length === 0 ? undefined as T : JSON.parse(body) as T
}
export function rpc<T>(name: string, args: Record<string, unknown>) { return db<T>(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }) }
export async function guard(request: Request, scope: 'write' | 'upload' | 'auth', max = 60, bucketNamespace?: 'email') {
  config()
  // Only trust Vercel's platform-provided address on Vercel. Other deployments
  // share a conservative bucket until a trusted proxy integration is supplied.
  const candidate = process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() : ''
  const address = candidate && isIP(candidate) ? candidate : 'shared'
  const bucket = createHmac('sha256', process.env.DVC_SESSION_SECRET!).update(bucketNamespace ? `${bucketNamespace}:${address}` : address).digest('hex')
  if (!await rpc<boolean>('dvc_limit', { p_bucket: bucket, p_scope: scope, p_max: max })) throw new ClubError('Too many requests. Try again later', 429, 'RATE_LIMITED')
}
interface AuthUser { id: string; email?: string; email_confirmed_at?: string; user_metadata?: { full_name?: string }; identities?: { provider: string; identity_data?: { email?: string; email_verified?: boolean } }[] }
interface TokenPair { access_token: string; refresh_token: string; remember?: boolean }
export async function authRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const { url, anon } = config()
  let res: Response
  try { res = await fetch(`${url}/auth/v1/${path}`, { ...init, headers: { apikey: anon, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers }, cache: 'no-store' }) }
  catch { throw new ClubError('Sign-in service unavailable. Try again', 503, 'AUTH_UNAVAILABLE') }
  if (res.status >= 500 || res.status === 429) throw new ClubError('Sign-in service unavailable. Try again', 503, 'AUTH_UNAVAILABLE')
  if (!res.ok) throw new ClubError('Please sign in again', 401, 'AUTH_REQUIRED')
  return res.status === 204 ? undefined as T : await res.json()
}
export async function identity() {
  const raw = (await cookies()).get('dvc-auth')?.value
  let pair = raw ? unseal<TokenPair>(raw) : null
  let user: AuthUser | null = null
  if (pair?.access_token && pair.refresh_token) {
    try { user = await authRequest<AuthUser>('user', {}, pair.access_token) }
    catch (error) {
      if (!(error instanceof ClubError) || error.status !== 401) throw error
      try {
        const remember = pair.remember !== false
        pair = await authRequest<TokenPair>('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: pair.refresh_token }) })
        await setAuthSession(pair, remember)
        user = await authRequest<AuthUser>('user', {}, pair.access_token)
      } catch (refreshError) {
        if (!(refreshError instanceof ClubError) || refreshError.status !== 401) throw refreshError
        await setCookie('dvc-auth', '', 0)
      }
    }
  }
  const role = user ? await rpc<StaffRole>('dvc_role', { p_org: ORG, p_user: user.id }) : 'player'
  return { user, role, developer: role === 'developer' }
}
export async function logFailure(reference: string, action: string, code: string, actor: string | null) {
  // A second transaction records failures even when the business transaction rolled back.
  console.error(JSON.stringify({ reference, action, code }))
  if (!configured()) return
  try {
    if (!await rpc<boolean>('dvc_limit', { p_bucket: hash('global-error-log'), p_scope: 'log', p_max: 1000 })) return
    await db('developer_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: ORG, reference_id: reference, actor_id: actor, kind: 'error', action, details: { code } }) })
  }
  catch { console.error(JSON.stringify({ reference, code: 'LOG_WRITE_FAILED' })) }
}
export async function storage(path: string, init: RequestInit = {}) {
  const { url, key } = config()
  const response = await fetch(`${url}/storage/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, ...init.headers }, cache: 'no-store' })
  if (!response.ok) throw new ClubError('Image service unavailable. Try again', 502, 'STORAGE_ERROR')
  return response
}
