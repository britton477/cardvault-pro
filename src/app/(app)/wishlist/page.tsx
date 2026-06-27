import type { Metadata } from 'next'
import { WishlistView } from '@/components/wishlist/WishlistView'

export const metadata: Metadata = { title: 'Wishlist — CardVault Pro' }

export default function WishlistPage() {
  return <WishlistView />
}
