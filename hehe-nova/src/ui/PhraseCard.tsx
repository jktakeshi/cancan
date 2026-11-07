import type { ReactNode } from 'react'
import './ui.css'

/** A point on the mini map in normalized stage units: x runs left to right as seen from the audience, y runs upstage (0) to audience (1). */
export type StagePoint = { x: number; y: number }

export type FormationSketch = {
  others: StagePoint[]
  start?: StagePoint
  end?: StagePoint
}

const MAP_WIDTH = 100
const MAP_HEIGHT = 40
const INSET = 4

const toMap = (point: StagePoint) => ({
  x: INSET + point.x * (MAP_WIDTH - INSET * 2),
  y: INSET + 4 + point.y * (MAP_HEIGHT - INSET * 2 - 4),
})

/** Top down formation sketch: other dancers in grey, the role's start as a ring and its end as a filled dot. */
export function FormationMap({ sketch, emptyText = 'Formation appears after dancers are detected' }: { sketch: FormationSketch | null; emptyText?: string }) {
  if (!sketch) return <div className="ui-formation-map"><div className="map-empty">{emptyText}</div></div>
  const start = sketch.start && toMap(sketch.start)
  const end = sketch.end && toMap(sketch.end)
  return <div className="ui-formation-map">
    <span className="edge">Upstage</span>
    <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {sketch.others.map((point, index) => { const p = toMap(point); return <circle key={index} cx={p.x} cy={p.y} r={1.4} fill="var(--dancer-other)" /> })}
      {start && end && <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="var(--accent-role)" strokeWidth={0.4} strokeDasharray="1 1" />}
      {start && <circle cx={start.x} cy={start.y} r={1.4} fill="none" stroke="var(--accent-role)" strokeWidth={0.5} />}
      {end && <circle cx={end.x} cy={end.y} r={1.6} fill="var(--accent-role)" />}
    </svg>
  </div>
}

type PhraseCardProps = {
  name: string
  /** Count range label such as "1–8". */
  counts: string
  description?: string
  sketch: FormationSketch | null
  /** Left side of the footer, normally a status chip. */
  status?: ReactNode
  /** Right side of the footer, normally a selection chip such as "Start". */
  badge?: ReactNode
  selected?: boolean
  onClick?: () => void
}

/** One eight-count phrase with where the selected role travels. */
export function PhraseCard({ name, counts, description, sketch, status, badge, selected = false, onClick }: PhraseCardProps) {
  const body = <>
    <div className="title-row"><span className="name">{name}</span><span className="counts">{counts}</span></div>
    <FormationMap sketch={sketch} />
    {description && <p className="description">{description}</p>}
    {(status || badge) && <div className="footer"><span>{status}</span><span>{badge}</span></div>}
  </>
  return onClick
    ? <button type="button" className={`ui-card ui-phrase-card ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onClick}>{body}</button>
    : <div className={`ui-card ui-phrase-card ${selected ? 'selected' : ''}`}>{body}</div>
}
