import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, logFailure } from '@/features/club/server/gateway'

const network = vi.fn()
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://qa.invalid')
  vi.stubEnv('SUPABASE_ANON_KEY', 'unit-anon')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'unit-service')
  vi.stubEnv('DVC_SESSION_SECRET', 'unit-session-secret-with-more-than-thirty-two-characters')
  vi.stubGlobal('fetch', network)
  network.mockReset()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('database response handling', () => {
  it('accepts a successful empty 201 minimal insert', async () => {
    network.mockResolvedValue(new Response(null, { status: 201, headers: { 'Preference-Applied': 'return=minimal' } }))
    await expect(db('developer_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: '{}' })).resolves.toBeUndefined()
  })
  it('preserves 204 no-content success', async () => {
    network.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(db('rows', { method: 'DELETE' })).resolves.toBeUndefined()
  })
  it.each([200, 201])('decodes a JSON representation with status %i', async status => {
    network.mockResolvedValue(Response.json([{ id: 'unit-row' }], { status }))
    await expect(db('rows')).resolves.toEqual([{ id: 'unit-row' }])
  })
  it.each([false, 0, null, ''])('preserves a falsy JSON RPC value: %j', async value => {
    network.mockResolvedValue(Response.json(value))
    await expect(db('rpc/unit_value', { method: 'POST' })).resolves.toBe(value)
  })
  it.each(['not JSON', ' ', '{"incomplete":'])('rejects a nonempty malformed success body: %j', async body => {
    network.mockResolvedValue(new Response(body, { status: 201 }))
    await expect(db('rows')).rejects.toBeInstanceOf(SyntaxError)
  })
  it('preserves deliberate database conflict mapping', async () => {
    network.mockResolvedValue(Response.json({ code: 'P0001', message: 'Slots no longer available' }, { status: 400 }))
    await expect(db('rpc/unit_action')).rejects.toMatchObject({ message: 'Slots no longer available', status: 409, code: 'CONFLICT' })
  })
  it('keeps internal SQL details out of generic database errors', async () => {
    network.mockResolvedValue(Response.json({ code: '23505', message: 'private internal constraint' }, { status: 409 }))
    await expect(db('rows')).rejects.toMatchObject({ message: 'Could not complete that action', status: 502, code: 'DATABASE_ERROR' })
  })
  it('keeps non-JSON unsuccessful responses as generic database errors', async () => {
    network.mockResolvedValue(new Response('upstream failure', { status: 502 }))
    await expect(db('rows')).rejects.toMatchObject({ status: 502, code: 'DATABASE_ERROR' })
  })
  it('does not swallow network failures', async () => {
    const failure = new TypeError('unit network unavailable')
    network.mockRejectedValue(failure)
    await expect(db('rows')).rejects.toBe(failure)
  })
})

describe('minimal failure-event persistence acknowledgement', () => {
  it('does not report LOG_WRITE_FAILED for a successful minimal event insert', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    network.mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(new Response(null, { status: 201 }))
    await logFailure('unit-reference', 'workspace', 'ACCESS_DENIED', 'unit-actor')
    expect(consoleError.mock.calls.map(([line]) => JSON.parse(line))).toEqual([{ reference: 'unit-reference', action: 'workspace', code: 'ACCESS_DENIED' }])
    expect(network).toHaveBeenLastCalledWith('https://qa.invalid/rest/v1/developer_events', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Prefer: 'return=minimal' }) }))
  })
  it('still reports LOG_WRITE_FAILED for malformed nonempty insert acknowledgements', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    network.mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(new Response('invalid JSON', { status: 201 }))
    await logFailure('unit-reference', 'workspace', 'ACCESS_DENIED', 'unit-actor')
    expect(consoleError).toHaveBeenLastCalledWith(JSON.stringify({ reference: 'unit-reference', code: 'LOG_WRITE_FAILED' }))
  })
})
