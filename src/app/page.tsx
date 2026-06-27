import { redirect } from 'next/navigation'

// Root → redirect to dashboard (middleware handles auth gate)
export default function RootPage() {
  redirect('/dashboard')
}
