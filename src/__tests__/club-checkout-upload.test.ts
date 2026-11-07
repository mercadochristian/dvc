import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/features/club/server/gateway',()=>({db:vi.fn(),guard:vi.fn(),guest:vi.fn(),identity:vi.fn(),logFailure:vi.fn(),ORG:'00000000-0000-0000-0000-000000000001',rpc:vi.fn(),storage:vi.fn()}))
import { db, guest, identity, rpc, storage } from '@/features/club/server/gateway'
import { POST } from '@/app/api/club/upload/route'
import { GET } from '@/app/api/club/asset/route'
const id='11111111-1111-4111-8111-111111111111',method='22222222-2222-4222-8222-222222222222',receipt='33333333-3333-4333-8333-333333333333'
const pending=()=>({id,status:'holding',payment_status:'pending',amount:50000,expires_at:new Date(Date.now()+600000).toISOString(),created_at:'2026-11-04T00:00:00Z',bookings:[]})
const reserved=()=>({...pending(),status:'reserved',payment_status:'approved',receipt:{id:receipt,submitted_at:'2026-11-04T00:00:00Z'}})
function request(bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])){const form=new FormData();form.set('kind','checkout_receipt');form.set('checkout',id);form.set('method',method);form.set('file',new File([bytes],'receipt.png',{type:'image/png'}));return new Request('http://localhost/api/club/upload',{method:'POST',headers:{origin:'http://localhost'},body:form})}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(identity).mockResolvedValue({user:null,role:'player',developer:false});vi.mocked(guest).mockResolvedValue('a'.repeat(64));vi.mocked(db).mockResolvedValue([]);vi.mocked(storage).mockResolvedValue(new Response('synthetic image'));vi.mocked(rpc).mockImplementation(async name=>name==='dvc_checkout_read'?pending():name==='dvc_checkout_cleanup_candidates'?[]:name==='dvc_checkout_receipt'?reserved():name==='dvc_checkout_upload_release'?{committed:true,checkout:reserved()}:null)})
describe('combined checkout image upload API',()=>{
 it('returns the automatically approved combined checkout',async()=>{const response=await POST(request());expect(await response.json()).toMatchObject({checkout:{id,status:'reserved',payment_status:'approved'}})})
 it('never returns private image paths in the success body',async()=>{const response=await POST(request());expect(JSON.stringify(await response.json())).not.toContain('checkout-receipts/')})
 it('validates the image bytes before an attempt can reach Storage',async()=>{await POST(request(new TextEncoder().encode('<svg onload="alert(1)"></svg>')));expect(storage).not.toHaveBeenCalled()})
 it('rejects another owner before uploading',async()=>{vi.mocked(rpc).mockImplementation(async name=>name==='dvc_checkout_read'?null:[]);const response=await POST(request());expect(response.status).toBe(404)})
 it('does not grant administrators an implicit upload on someone else’s checkout',async()=>{vi.mocked(identity).mockResolvedValue({user:{id:method,email:'admin@example.test'},role:'admin',developer:false});vi.mocked(rpc).mockResolvedValue(null);const response=await POST(request());expect(response.status).toBe(404)})
 it('does not use a guest cookie as account ownership',async()=>{vi.mocked(identity).mockResolvedValue({user:{id:method,email:'actor@example.test'},role:'player',developer:false});await POST(request());expect(rpc).toHaveBeenCalledWith('dvc_checkout_read',expect.objectContaining({p_user:method,p_guest:null}))})
 it('treats a duplicate upload as success without another Storage write',async()=>{vi.mocked(rpc).mockImplementation(async name=>name==='dvc_checkout_read'?reserved():[]);await POST(request());expect(storage).not.toHaveBeenCalled()})
 it('keeps private checkout upload responses uncached',async()=>{const response=await POST(request());expect(response.headers.get('cache-control')).toBe('no-store')})
})
describe('combined checkout private receipt asset API',()=>{
 const asset=()=>new Request(`http://localhost/api/club/asset?kind=checkout_receipt&id=${id}`)
 it('denies an unrelated guest before reading a private object',async()=>{vi.mocked(rpc).mockResolvedValue(false);await GET(asset());expect(storage).not.toHaveBeenCalled()})
 it('allows the owner to read the committed private image',async()=>{vi.mocked(rpc).mockResolvedValue(true);vi.mocked(db).mockImplementation(async path=>path.startsWith('checkouts?')?[{id}]:[{path:`checkout-receipts/${id}/${receipt}.png`}]);const response=await GET(asset());expect(await response.text()).toBe('synthetic image')})
 it('keeps private receipt bytes private and uncached',async()=>{vi.mocked(rpc).mockResolvedValue(true);vi.mocked(db).mockImplementation(async path=>path.startsWith('checkouts?')?[{id}]:[{path:`checkout-receipts/${id}/${receipt}.png`}]);const response=await GET(asset());expect(response.headers.get('cache-control')).toBe('private, no-store')})
 it('scopes administrator asset access to this organization',async()=>{vi.mocked(identity).mockResolvedValue({user:{id:method,email:'admin@example.test'},role:'admin',developer:false});vi.mocked(rpc).mockResolvedValue(false);vi.mocked(db).mockResolvedValue([]);const response=await GET(asset());expect(response.status).toBe(404)})
 it('rejects a receipt path belonging to another checkout',async()=>{vi.mocked(rpc).mockResolvedValue(true);vi.mocked(db).mockImplementation(async path=>path.startsWith('checkouts?')?[{id}]:[{path:`checkout-receipts/${method}/${receipt}.png`}]);await GET(asset());expect(storage).not.toHaveBeenCalled()})
})
