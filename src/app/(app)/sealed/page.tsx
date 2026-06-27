import type { Metadata } from 'next'
import { SealedView } from '@/components/sealed/SealedView'

export const metadata: Metadata = { title: 'Sealed Products' }

export default function SealedPage() {
  return <SealedView />
}
