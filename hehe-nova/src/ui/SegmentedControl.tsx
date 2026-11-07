import './ui.css'

type Option<T> = { value: T; label: string; disabled?: boolean }

type SegmentedControlProps<T extends string | number> = {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the whole group, such as "Playback speed". */
  label: string
  size?: 'regular' | 'small'
  className?: string
}

/** A row of Segment options where exactly one is active (view mode, speed, filter). */
export function SegmentedControl<T extends string | number>({ options, value, onChange, label, size = 'regular', className = '' }: SegmentedControlProps<T>) {
  return <div role="radiogroup" aria-label={label} className={`ui-segmented ${size === 'small' ? 'small' : ''} ${className}`}>
    {options.map((option) => <button
      key={String(option.value)}
      type="button"
      role="radio"
      aria-checked={option.value === value}
      disabled={option.disabled}
      className="ui-segment"
      onClick={() => onChange(option.value)}
    >{option.label}</button>)}
  </div>
}
