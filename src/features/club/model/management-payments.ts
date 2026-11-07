import type { Booking, Checkout, ClubGame } from './types'

export type PaymentGame = Pick<ClubGame, 'id' | 'venue' | 'starts_at' | 'maps_url'>

interface PaymentRecord {
  id: string
  created_at: string
}

export interface CheckoutPaymentRecord extends PaymentRecord {
  kind: 'checkout'
  organizer: string
  contact: string
  amount: number
  status: Checkout['status']
  payment_status: Checkout['payment_status']
  receipt: { submitted_at: string; method: string } | null
}

export interface LegacyPaymentRecord extends PaymentRecord {
  kind: 'legacy'
  booking: Booking
  game: PaymentGame
}

export type ManagementPayment = CheckoutPaymentRecord | LegacyPaymentRecord

export interface PaymentPage<Row> {
  rows: Row[]
  next_cursor: string | null
}
