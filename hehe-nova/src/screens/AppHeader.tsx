import type { ReactNode } from 'react'
import { Brand } from '../ui/Brand'
import './AppHeader.css'

/** Top bar shared by every screen. The center slot holds the step indicator on the learning screens. */
export function AppHeader({ onHome, center, end }: { onHome?: () => void; center?: ReactNode; end?: ReactNode }) {
  return <header className="app-header">
    <Brand onClick={onHome} />
    <div className="app-header-center">{center}</div>
    <div className="app-header-end">{end}</div>
  </header>
}
