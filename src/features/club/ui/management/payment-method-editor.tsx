'use client'
import { RequiredLabel, RequiredNote } from '../shared/required'
import { useRef, useState, type FormEvent } from 'react'
import { act, upload, RequestError } from '@/features/club/api/client'
import { type PaymentMethod } from '@/features/club/model/types'
import { ErrorNotice, Modal } from '../shared/primitives'
export function PaymentEditor({ method, close, saved }: { method?: PaymentMethod; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null)
  const pending = useRef(false)
  const creationRequest = useRef<string | null>(null)
  const uncertainCreate = useRef<Record<string, unknown> | null>(null)
  const uploaded = useRef<{ file: File; path: string; proof: string; uploadedAt: number } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    const f = new FormData(event.currentTarget)
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      if (uncertainCreate.current) {
        try {
          await act('payment.save', uncertainCreate.current)
          uncertainCreate.current = null
          saved()
          return
        } catch (error) {
          if (!(error instanceof RequestError) || !error.status || error.status >= 500) throw error
          uncertainCreate.current = null
          throw error
        }
      }
      let path = f.get('remove_qr') ? null : method?.qr_path || null
      let proof: string | undefined
      const picker = event.currentTarget.elements.namedItem('file')
      const file = picker instanceof HTMLInputElement ? picker.files?.[0] : undefined
      if (file?.size) {
        if (uploaded.current?.file !== file || Date.now() - uploaded.current.uploadedAt >= 55 * 60 * 1000) {
          const data = new FormData()
          data.set('kind', 'qr')
          data.set('file', file)
          if (method) data.set('payment_method', method.id)
          const response = await upload<{ path?: string; proof?: string }>(data)
          if (!response.path || !response.proof) throw new Error('The QR image could not be saved. Try again.')
          uploaded.current = { file, path: response.path, proof: response.proof, uploadedAt: Date.now() }
        }
        path = uploaded.current.path
        proof = uploaded.current.proof
      }
      if (!method && !creationRequest.current) creationRequest.current = crypto.randomUUID()
      const payload = {
        ...(method ? { id: method.id } : { request_id: creationRequest.current }),
        label: f.get('label'), account_name: f.get('account_name'), account_number: f.get('account_number'),
        qr_path: path, qr_proof: proof, enabled: f.get('enabled') === 'on',
      }
      if (!method) uncertainCreate.current = payload
      await act('payment.save', payload)
      uncertainCreate.current = null
      saved()
    } catch (error) {
      if (error instanceof RequestError && error.status && error.status < 500) uncertainCreate.current = null
      if (error instanceof RequestError && error.message === 'Upload a QR image for this payment method before saving') {
        uploaded.current = null
      }
      setError(error)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const checking = Boolean(uncertainCreate.current)
  return <Modal title={method ? 'Edit payment method' : 'Add payment method'} close={close} dismissible={!busy}><ErrorNotice error={error} />
    {uncertainCreate.current && <p className="club-note">The save result is unknown. Retry here to check the original request before making changes.</p>}
    <form onSubmit={submit} className="club-form"><RequiredNote /><label><RequiredLabel>Method</RequiredLabel><input name="label" disabled={busy || checking} required maxLength={100} placeholder="GCash or bank name" defaultValue={method?.label} /></label><label><RequiredLabel>Account name</RequiredLabel><input name="account_name" disabled={busy || checking} required maxLength={120} defaultValue={method?.account_name} /></label><label><RequiredLabel>Account number</RequiredLabel><input name="account_number" disabled={busy || checking} required maxLength={100} defaultValue={method?.account_number} /></label><label>QR image<input type="file" name="file" disabled={busy || checking} accept="image/png,image/jpeg,image/webp" /><small>PNG, JPEG or WebP · up to 3 MB</small></label>{method?.qr_path && <label className="club-check"><input type="checkbox" name="remove_qr" disabled={busy || checking} /> Remove current QR</label>}<label className="club-check"><input type="checkbox" name="enabled" disabled={busy || checking} defaultChecked={method?.enabled ?? true} /> Available to players</label><button className="club-button primary" disabled={busy}>{busy ? 'Saving…' : checking ? 'Check original save' : 'Save method'}</button></form></Modal>
}
