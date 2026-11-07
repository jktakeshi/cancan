import { useMemo } from 'react'
import iconArrow from '../assets/iconArrow.svg'
import { phraseOverviews } from '../phraseSketches'
import { phraseStatus, type PhraseProgress } from '../takes'
import type { RehearsalSession } from '../useRehearsalSession'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { PhraseCard } from '../ui/PhraseCard'
import { AppHeader } from './AppHeader'
import { StepIndicator, type FlowStep } from './StepIndicator'
import './PickPhrase.css'

type PickPhraseProps = {
  session: RehearsalSession
  roleId: string
  phraseId: string
  /** Latest saved take result per phrase for this role. */
  progress: Record<string, PhraseProgress>
  onPhraseChange: (phraseId: string) => void
  onLearn: (phraseId: string) => void
  onStep: (step: FlowStep) => void
  onHome: () => void
}

/** Step 2: the learner chooses which eight-count to learn, with where their dancer travels in each. */
export function PickPhrase({ session, roleId, phraseId, progress, onPhraseChange, onLearn, onStep, onHome }: PickPhraseProps) {
  const { phrases, roles, analysis, referenceCamera, countGrid } = session
  const role = roles.find((item) => item.id === roleId) ?? roles[0]
  const selectedIndex = Math.max(0, phrases.findIndex((item) => item.id === phraseId))
  const selected = phrases[selectedIndex]
  const overviews = useMemo(() => phraseOverviews(phrases, analysis.tracks, role.id, referenceCamera), [phrases, analysis.tracks, role.id, referenceCamera])
  const grid = countGrid.grid
  const phraseName = (index: number) => `Phrase ${index + 1}`
  const countRange = (index: number) => `${index * 8 + 1}–${index * 8 + 8}`
  const shortClip = (label: string) => label.includes('clip ends early')
  // The weakest practiced phrase is the one with the lowest latest score.
  const weakestIndex = phrases.reduce<number>((best, item, index) => {
    const score = progress[item.id]?.score
    if (score == null) return best
    const bestScore = best >= 0 ? progress[phrases[best].id]?.score ?? Infinity : Infinity
    return score < bestScore ? index : best
  }, -1)
  const statusChip = (id: string, index: number) => {
    const entry = progress[id]
    if (!entry || entry.score === null) return undefined
    const label = phraseStatus(entry) === 'solid' ? 'Solid' : index === weakestIndex ? 'Weakest' : 'Last take'
    return <Chip tone="neutral" dotColor={phraseStatus(entry) === 'solid' ? 'var(--status-solid)' : 'var(--status-progress)'}>{label} · {entry.score}</Chip>
  }

  const shiftGrid = (change: { beatsPerCount?: number; shiftCounts?: number }) => session.setGridOverrides((value) => ({
    ...value,
    ...(change.beatsPerCount !== undefined ? { beatsPerCount: change.beatsPerCount } : {}),
    ...(change.shiftCounts !== undefined ? { shiftCounts: (value.shiftCounts ?? 0) + change.shiftCounts } : {}),
  }))

  return <div className="pick-phrase">
    <AppHeader
      onHome={onHome}
      center={<StepIndicator current="phrase" onSelect={onStep} />}
      end={<span className="pick-phrase-learning-as text-body-small text-muted">Learning as <Chip>{role.label}</Chip></span>}
    />
    <main className="pick-phrase-content">
      <span className="text-mono text-muted">{session.rehearsal.name}</span>
      <div className="pick-phrase-title-row">
        <div className="pick-phrase-title">
          <h1 className="text-h1">Pick a phrase to practice</h1>
          <p className="text-body text-muted">Tap a phrase to choose it. Learning {phraseName(selectedIndex).toLowerCase()}, counts {countRange(selectedIndex)}.</p>
        </div>
        <div className="pick-phrase-shortcuts">
          {weakestIndex >= 0 && <Button variant="secondary" onClick={() => onLearn(phrases[weakestIndex].id)}>Fix weakest: {phraseName(weakestIndex)}</Button>}
          <Button onClick={() => onLearn(selected.id)} icon={<img src={iconArrow} width={20} height={20} alt="" />}>Learn {phraseName(selectedIndex).toLowerCase()}</Button>
        </div>
      </div>

      {session.phrasesArePlaceholder && <p className="pick-phrase-notice" role="status">
        {countGrid.status === 'error' ? `Beat detection failed: ${countGrid.error}. These phrases are placeholders.` : 'Listening for the beat. These phrases are placeholders until the counts are detected.'}
      </p>}

      <section className="pick-phrase-ruler" aria-label="Phrase timeline">
        <div className="ticks text-mono-small text-muted" aria-hidden="true">
          <span>COUNT 1</span>
          {phrases.map((_, index) => <span key={index}>{(index + 1) * 8}</span>)}
        </div>
        <div className="segments">
          {phrases.map((item, index) => <button
            key={item.id}
            type="button"
            className={`segment status-${phraseStatus(progress[item.id])} ${index === selectedIndex ? 'is-selected' : ''}`}
            aria-label={`${phraseName(index)}, counts ${countRange(index)}`}
            aria-pressed={index === selectedIndex}
            onClick={() => onPhraseChange(item.id)}
          />)}
        </div>
        <div className="legend text-micro text-muted">
          <span>Green = solid (80+)</span>
          <span>Light green = practiced</span>
          <span>Grey = not practiced yet</span>
          <span>Yellow outline = selected</span>
          <span>{formatSeconds(selected.startSec)}–{formatSeconds(selected.endSec)} s in the video</span>
        </div>
        <details className="pick-phrase-adjust">
          <summary>Counts look wrong?</summary>
          {grid && countGrid.bpm && <p className="text-micro text-muted">{Math.round(countGrid.bpm)} BPM music, {grid.beatsPerCount === 2 ? 'counted in half time' : grid.beatsPerCount === 1 ? 'one count per beat' : 'double time'} ({grid.countSec.toFixed(2)} s per count).{grid.countIn.length ? ` Count-in until ${grid.counts[0].toFixed(1)} s.` : ''}</p>}
          <div className="actions">
            <Button variant="secondary" size="medium" disabled={!grid} onClick={() => grid && shiftGrid({ beatsPerCount: Math.min(2, grid.beatsPerCount * 2) })}>Counts too fast</Button>
            <Button variant="secondary" size="medium" disabled={!grid} onClick={() => grid && shiftGrid({ beatsPerCount: Math.max(0.5, grid.beatsPerCount / 2) })}>Counts too slow</Button>
            <Button variant="secondary" size="medium" disabled={!grid} onClick={() => shiftGrid({ shiftCounts: -1 })}>Count 1 earlier</Button>
            <Button variant="secondary" size="medium" disabled={!grid} onClick={() => shiftGrid({ shiftCounts: 1 })}>Count 1 later</Button>
          </div>
        </details>
      </section>

      <section className="pick-phrase-grid" aria-label="Phrases">
        {phrases.map((item, index) => <PhraseCard
          key={item.id}
          name={phraseName(index)}
          counts={countRange(index)}
          sketch={overviews[index]?.sketch ?? null}
          description={overviews[index]?.travel}
          status={statusChip(item.id, index) ?? (shortClip(item.label) ? <Chip tone="neutral">Clip ends early</Chip> : undefined)}
          badge={index === selectedIndex ? <Chip>Selected</Chip> : undefined}
          selected={index === selectedIndex}
          onClick={() => onPhraseChange(item.id)}
        />)}
      </section>
      <p className="text-micro text-muted">Ring is where your dancer starts the phrase, filled dot is where they end. Grey dots are the other dancers at the end of the phrase. Directions are your own, facing the front.</p>
    </main>
  </div>
}

function formatSeconds(seconds: number) {
  return seconds.toFixed(1)
}
