'use client'
// =============================================================================
// PageHeaderContext — lets view components push a title + subtitle into the
// TopBar without prop-drilling through the server layout.
// Usage:
//   const { setHeader } = usePageHeader()
//   useEffect(() => setHeader({ title: 'Stock', subtitle: '96 cards' }), [count])
// =============================================================================
import {
  createContext, useContext, useState, useCallback,
  type ReactNode,
} from 'react'

interface PageHeader {
  title:    string
  subtitle?: string
}

interface PageHeaderCtxValue extends PageHeader {
  setHeader: (h: PageHeader) => void
}

const PageHeaderCtx = createContext<PageHeaderCtxValue>({
  title:     '',
  subtitle:  undefined,
  setHeader: () => {},
})

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeaderState] = useState<PageHeader>({ title: '' })

  const setHeader = useCallback((h: PageHeader) => {
    setHeaderState(prev =>
      prev.title === h.title && prev.subtitle === h.subtitle ? prev : h,
    )
  }, [])

  return (
    <PageHeaderCtx.Provider value={{ ...header, setHeader }}>
      {children}
    </PageHeaderCtx.Provider>
  )
}

export function usePageHeader() {
  return useContext(PageHeaderCtx)
}
