import type { Metadata } from 'next'
import { SalesView } from '@/components/sales/SalesView'

export const metadata: Metadata = { title: 'Sales' }

export default function SalesPage() {
  return <SalesView />
}
