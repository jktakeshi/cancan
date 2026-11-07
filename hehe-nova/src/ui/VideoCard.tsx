import type { ReactNode } from 'react'
import './ui.css'

export type PhraseProgress = 'solid' | 'progress' | 'weak' | 'none'

/** One segment per phrase, colored by how well that phrase is learned. */
export function PhraseProgressStrip({ phrases }: { phrases: PhraseProgress[] }) {
  return <div className="ui-phrase-progress" aria-hidden="true">
    {phrases.map((state, index) => <span key={index} className={state} />)}
  </div>
}

type VideoCardProps = {
  title: string
  /** Visual for the top area. Use our own rehearsal footage or leave it empty for a plain placeholder box. */
  thumbnail?: ReactNode
  /** Clip length such as "1:12". */
  length?: string
  roleLabel?: string
  meta?: ReactNode
  progress?: PhraseProgress[]
  next?: ReactNode
  onClick?: () => void
}

/** A rehearsal in the library. */
export function VideoCard({ title, thumbnail, length, roleLabel, meta, progress, next, onClick }: VideoCardProps) {
  const body = <>
    <div className="thumbnail">
      {thumbnail ?? <span className="overlay-tag top-left">No preview</span>}
      {roleLabel && <span className="ui-chip tone-accent">{roleLabel}</span>}
      {length && <span className="overlay-tag bottom-right">{length}</span>}
    </div>
    <div className="body">
      <span className="title">{title}</span>
      {meta && <span className="meta">{meta}</span>}
      {progress && progress.length > 0 && <PhraseProgressStrip phrases={progress} />}
      {next && <span className="next">{next}</span>}
    </div>
  </>
  return onClick
    ? <button type="button" className="ui-card ui-video-card" onClick={onClick}>{body}</button>
    : <article className="ui-card ui-video-card">{body}</article>
}
