'use client'
// Sets the TopBar title for the Dashboard page (server component can't use hooks).
import { useEffect } from 'react'
import { usePageHeader } from '@/components/layout/PageHeaderContext'

export function DashboardHeader() {
  const { setHeader } = usePageHeader()
  useEffect(() => {
    setHeader({ title: 'Dashboard', subtitle: 'Your business at a glance' })
  }, [setHeader])
  return null
}
