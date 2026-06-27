import type { Metadata }       from 'next'
import { CalendarView }         from '@/components/calendar/CalendarView'
import { ObjectivesBoard }      from '@/components/calendar/ObjectivesBoard'

export const metadata: Metadata = { title: 'Calendar — CardVault Pro' }

export default function CalendarPage() {
  return (
    // flex with items-stretch (default) so both panels grow to the same height
    <div className="flex gap-5 items-stretch min-h-full">
      {/* Calendar — takes all remaining width */}
      <div className="flex-1 min-w-0">
        <CalendarView />
      </div>

      {/* Objectives panel — fixed width, stretches to match calendar height */}
      <div className="w-72 flex-shrink-0 flex flex-col">
        <ObjectivesBoard />
      </div>
    </div>
  )
}
