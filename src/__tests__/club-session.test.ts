import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/headers',()=>({cookies:vi.fn()}))
import { seal, unseal, identity, guard } from '@/features/club/server/gateway'
import { cookies } from 'next/headers'
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks()})
describe('server session encryption',()=>{
  it('round trips token pairs',()=>{vi.stubEnv('DVC_SESSION_SECRET','a'.repeat(64));expect(unseal(seal({access_token:'access',refresh_token:'refresh'}))).toEqual({access_token:'access',refresh_token:'refresh'})})
  it('does not put raw tokens in the cookie',()=>{vi.stubEnv('DVC_SESSION_SECRET','a'.repeat(64));expect(seal({access_token:'secret-token'})).not.toContain('secret-token')})
  it('rejects tampered cookies',()=>{vi.stubEnv('DVC_SESSION_SECRET','a'.repeat(64));const sealed=seal({token:'x'});expect(unseal('AAAA'+sealed.slice(4))).toBeNull()})
  it('rejects cookies encrypted with another key',()=>{vi.stubEnv('DVC_SESSION_SECRET','a'.repeat(64));const sealed=seal({token:'x'});vi.stubEnv('DVC_SESSION_SECRET','b'.repeat(64));expect(unseal(sealed)).toBeNull()})
  it('does not issue sessions with short secret',()=>{vi.stubEnv('DVC_SESSION_SECRET','short');expect(()=>seal({token:'x'})).toThrow()})
})
describe('auth failure recovery',()=>{
  const set=vi.fn(),network=vi.fn()
  beforeEach(()=>{vi.stubEnv('DVC_SESSION_SECRET','a'.repeat(64));vi.stubEnv('SUPABASE_URL','https://example.supabase.co');vi.stubEnv('SUPABASE_ANON_KEY','anon');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','service');vi.stubGlobal('fetch',network);network.mockReset();set.mockReset();vi.mocked(cookies).mockResolvedValue({get:()=>({value:seal({access_token:'a',refresh_token:'r'})}),set} as never)})
  it('reports an auth outage instead of silently becoming a guest',async()=>{network.mockResolvedValue(new Response('{}',{status:503}));await expect(identity()).rejects.toMatchObject({status:503})})
  it('keeps the session cookie during refresh outage',async()=>{network.mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response('{}',{status:503}));await identity().catch(()=>undefined);expect(set).not.toHaveBeenCalled()})
  it('clears rejected refresh credentials',async()=>{network.mockResolvedValue(new Response('{}',{status:401}));await identity();expect(set).toHaveBeenCalledWith('dvc-auth','',expect.objectContaining({maxAge:0}))})
  it('ignores spoofable forwarding headers outside Vercel',async()=>{vi.stubEnv('VERCEL','');network.mockImplementation(async()=>new Response('true'));await guard(new Request('https://dvc.example/api',{headers:{'x-vercel-forwarded-for':'1.1.1.1'}}),'write');const a=JSON.parse(network.mock.calls[0][1].body).p_bucket;await guard(new Request('https://dvc.example/api',{headers:{'x-vercel-forwarded-for':'2.2.2.2'}}),'write');expect(JSON.parse(network.mock.calls[1][1].body).p_bucket).toBe(a)})
  it('blocks an exhausted shared rate bucket',async()=>{network.mockResolvedValue(new Response('false'));await expect(guard(new Request('https://dvc.example/api'),'write')).rejects.toMatchObject({status:429})})
})
