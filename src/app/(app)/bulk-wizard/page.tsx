import type { Metadata } from 'next'
import { BulkWizardView } from '@/components/bulk-wizard/BulkWizardView'

export const metadata: Metadata = { title: 'Bulk Wizard' }

export default function BulkWizardPage() {
  return <BulkWizardView />
}
