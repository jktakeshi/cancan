import './ui.css'

type CountCellProps = {
  count: number | string
  /** Short cue for this count. Cues come from measured pose data, so they can be missing. */
  step: string
  state?: 'default' | 'looped' | 'current'
  /** Marks a count where the dancer could not be seen clearly. */
  unclear?: boolean
  onClick?: () => void
  title?: string
}

/** One count in the eight-count strip. */
export function CountCell({ count, step, state = 'default', unclear = false, onClick, title }: CountCellProps) {
  return <button type="button" className={`ui-count-cell is-${state} ${unclear ? 'is-unclear' : ''}`} aria-current={state === 'current' ? 'step' : undefined} onClick={onClick} title={title}>
    <span className="count">{count}</span>
    <span className="step">{step}</span>
  </button>
}
