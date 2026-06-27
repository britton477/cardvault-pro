import type { Metadata } from 'next'
import { StockView } from '@/components/stock/StockView'

export const metadata: Metadata = { title: 'Stock' }

export default function StockPage() {
  return <StockView />
}
