import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/club/server',()=>({ db:vi.fn(),guard:vi.fn(),guest:vi.fn(),identity:vi.fn(),logFailure:vi.fn(),ORG:'00000000-0000-0000-0000-000000000001',rpc:vi.fn(),storage:vi.fn() }))
import { db,guest,identity,rpc,storage } from '@/lib/club/server'
import { POST } from '@/app/api/club/upload/route'
const id='11111111-1111-4111-8111-111111111111',method='22222222-2222-4222-8222-222222222222'
function request(kind='receipt',mime='image/png',bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])){
  const data=new FormData();data.set('kind',kind);data.set('booking',id);data.set('method',method);data.set('file',new File([bytes],'receipt.png',{type:mime}))
  return new Request('http://localhost/api/club/upload',{method:'POST',headers:{origin:'http://localhost'},body:data})
}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(identity).mockResolvedValue({user:null,role:'player',developer:false});vi.mocked(guest).mockResolvedValue('a'.repeat(64));vi.mocked(storage).mockResolvedValue(new Response('{}'));vi.mocked(db).mockResolvedValue([]);vi.mocked(rpc).mockImplementation(async name=>name==='dvc_owned'?true:name==='dvc_bookings'?[{id,status:'holding',expires_at:new Date(Date.now()+600000).toISOString()}]:null)})
describe('receipt uploads',()=>{
  it('blocks another guest before uploading',async()=>{vi.mocked(rpc).mockResolvedValue(false);const r=await POST(request());expect(r.status).toBe(404)})
  it('does not put a forbidden file into Storage',async()=>{await POST(request('receipt','image/svg+xml',new TextEncoder().encode('<svg onload="alert(1)"></svg>')));expect(storage).not.toHaveBeenCalled()})
  it('does not trust a PNG filename with SVG contents',async()=>{const r=await POST(request('receipt','image/png',new TextEncoder().encode('<svg onload="alert(1)"></svg>')));expect(r.status).toBe(400)})
  it('does not upload after hold expiry',async()=>{vi.mocked(rpc).mockImplementation(async name=>name==='dvc_owned'?true:name==='dvc_bookings'?[{id,status:'holding',expires_at:'2020-01-01T00:00:00Z'}]:null);const r=await POST(request());expect(r.status).toBe(409)})
  it('reserves through the transactional receipt RPC',async()=>{vi.mocked(db).mockImplementation(async()=>[{path:vi.mocked(storage).mock.calls[0][0].replace('object/dvc-private/','')}]);const r=await POST(request());expect(r.status).toBe(200)})
  it('retains the image when the receipt RPC response is lost',async()=>{vi.mocked(rpc).mockImplementation(async name=>{if(name==='dvc_receipt')throw new Error('transport lost');return name==='dvc_owned'?true:[{id,status:'holding',expires_at:new Date(Date.now()+600000).toISOString()}]});await POST(request());expect(storage).toHaveBeenCalledTimes(1)})
  it('retains the image if a post-commit database read fails',async()=>{vi.mocked(db).mockRejectedValue(new Error('database unavailable'));await POST(request());expect(storage).toHaveBeenCalledTimes(1)})
  it('removes a proven unused image after another request won submission',async()=>{vi.mocked(db).mockResolvedValue([{path:'another-committed-path'}]);await POST(request());expect(storage).toHaveBeenLastCalledWith(expect.stringContaining('object/dvc-private/receipts/'),{method:'DELETE'})})
  it('allows only admins to upload payment QR',async()=>{const r=await POST(request('qr'));expect(r.status).toBe(403)})
  it('allows admin QR upload',async()=>{vi.mocked(identity).mockResolvedValue({user:{id,email:'admin@example.com'},role:'admin',developer:false});const r=await POST(request('qr'));expect(r.status).toBe(200)})
  it('never returns a private receipt path to players',async()=>{const r=await POST(request());expect(await r.json()).not.toHaveProperty('path')})
})
