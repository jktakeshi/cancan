import { scoreTone } from './score'
import './ui.css'

type ScoreBarProps = {
  label: string
  /** A 0 to 100 score, or null when the dimension could not be measured. */
  score: number | null
  /** Shown instead of a number when the score is null, and as a note under the bar otherwise. */
  detail?: string
  /** Replaces the number on the right, for measured ratios such as "5/8" or a category such as "Late" when there is no score. */
  valueLabel?: string
}

/** One separately judged dimension. A missing measurement shows an empty track instead of a made up value. */
export function ScoreBar({ label, score, detail, valueLabel }: ScoreBarProps) {
  const clamped = score === null ? 0 : Math.max(0, Math.min(100, Math.round(score)))
  return <div className={`ui-score-bar tone-${scoreTone(score)}`}>
    <div className="row">
      <span className="label">{label}</span>
      <span className="value">{valueLabel ?? (score === null ? 'n/a' : clamped)}</span>
    </div>
    <div className="track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score === null ? undefined : clamped}>
      {score !== null && <div className="fill" style={{ width: `${clamped}%` }} />}
    </div>
    {detail && <span className="detail">{detail}</span>}
  </div>
}
