import type { Metadata } from 'next'
import { EbayListingsView } from '@/components/ebay/EbayListingsView'

export const metadata: Metadata = { title: 'eBay Listings — CardVault Pro' }

export default function EbayListingsPage() {
  return <EbayListingsView />
}
