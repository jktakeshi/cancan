import type { ReactNode } from 'react'
import './ui.css'

type ChipProps = {
  tone?: 'accent' | 'neutral'
  /** Optional small color square, used for status legends and role colors. */
  dotColor?: string
  className?: string
  children: ReactNode
}

/** Role tag and status badge. */
export function Chip({ tone = 'accent', dotColor, className = '', children }: ChipProps) {
  return <span className={`ui-chip tone-${tone} ${className}`}>
    {dotColor && <i className="dot" style={{ background: dotColor }} />}
    {children}
  </span>
}
