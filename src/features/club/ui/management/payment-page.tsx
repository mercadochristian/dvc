'use client'

import { useCollectionPage, useCursorPaging } from '../shared/use-collection-page'

export const PAYMENT_PAGE_SIZE = 25

export function usePaymentPage<Row>(
  owner: string, query: string, refresh: number, onAccessLost?: () => void, activeView = true,
  pageNumber = 1,
) {
  return useCollectionPage<Row>('management-payments', PAYMENT_PAGE_SIZE, owner, query, refresh, onAccessLost, activeView, pageNumber)
}

export { useCursorPaging as usePaymentPaging }
