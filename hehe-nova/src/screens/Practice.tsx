import { useMemo, useState } from 'react'
import iconRetry from '../assets/iconRetry.svg'
import { toLearnerFloor, trackFloorAt, type CountPosition, type FloorPoint } from '../floor'
import { poseAt } from '../referenceTracking'
import { formationSummary, primaryFix, rejudgeFormation, type Take } from '../takes'
import type { RehearsalSession } from '../useRehearsalSession'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { ScoreBar } from '../ui/ScoreBar'
import { SegmentedControl } from '../ui/SegmentedControl'
import { scoreTone } from '../ui/score'
import { AppHeader } from './AppHeader'
import { StepIndicator, type FlowStep } from './StepIndicator'
import { TakeCompare } from './TakeCompare'
import { TakeReplay } from './TakeReplay'
import './Practice.css'

type PracticeProps = {
  session: RehearsalSession
  take: Take
  onRetry: () => void
  onWatchAgain: () => void
  onNextPhrase: (() => void) | null
  onOpenWorkbench: () => void
  onStep: (step: FlowStep) => void
  onHome: () => void
}

/** Short labels for the categories the take review already reports in its timing and travel sentences. */
function timingLabel(text: string | null) {
  if (!text) return undefined
  if (text.includes('behind')) return 'Late'
  if (text.includes('ahead')) return 'Early'
  return 'On beat'
}
function travelLabel(text: string | null) {
  if (!text) return undefined
  if (text.startsWith('Good travel') || text.startsWith('You stayed in place, like')) return 'Matches'
  if (text.startsWith('Wrong direction')) return 'Wrong way'
  if (text.startsWith('Right direction')) return 'Too short'
  return 'Off path'
}

/** Top-down sketch of one count in the learner's room, seen like the mirrored webcam: the learner's left on the left. */
function LandingMap({ position, others }: { position: CountPosition | undefined; others: FloorPoint[] }) {
  if (!position?.actual || !position.target) return <div className="practice-landing-map is-empty">Stand on your start spot when a take begins so your floor position can be measured.</div>
  const points = [position.actual, position.target, ...others]
  const pad = 0.6
  const minX = Math.min(...points.map((p) => p.x)) - pad
  const maxX = Math.max(...points.map((p) => p.x)) + pad
  const minZ = Math.min(...points.map((p) => p.z)) - pad
  const maxZ = Math.max(...points.map((p) => p.z)) + pad
  const span = Math.max(maxX - minX, (maxZ - minZ) * 2, 2)
  // Mirrored: camera-right (+x, the learner's left) is drawn on the left. Far from the camera is at the top.
  const at = (p: FloorPoint) => ({ x: 50 - (p.x - (minX + maxX) / 2) / span * 100, y: 25 - (p.z - (minZ + maxZ) / 2) / span * 100 })
  const actual = at(position.actual)
  const target = at(position.target)
  return <svg className="practice-landing-map" viewBox="0 0 100 50" aria-label={`Count ${position.count}: ${position.instruction ?? 'on your spot'}`}>
    {others.map((point, index) => { const p = at(point); return <circle key={index} cx={p.x} cy={p.y} r={1.8} fill="var(--dancer-other)" /> })}
    <circle cx={target.x} cy={target.y} r={2.2} fill="var(--accent-role)" />
    <circle cx={actual.x} cy={actual.y} r={2.2} fill="none" stroke="var(--text-white)" strokeWidth={0.6} />
    <text x={50} y={48} textAnchor="middle" fontSize={2.6} fill="var(--text-muted)">FRONT (your camera)</text>
  </svg>
}

/** Step 4: the result of one take, with one fix, separate dimension results, and a count-by-count comparison. */
export function Practice({ session, take, onRetry, onWatchAgain, onNextPhrase, onOpenWorkbench, onStep, onHome }: PracticeProps) {
  const { phrases, roles, analysis, referenceCamera, meta } = session
  const phraseIndex = Math.max(0, phrases.findIndex((item) => item.id === take.phraseId))
  const phrase = phrases[phraseIndex]
  const role = roles.find((item) => item.id === take.roleId) ?? roles[0]
  const track = analysis.tracks.find((item) => item.id === role.id)
  const { review, positions } = take
  const weakest = review.counts.filter((count) => count.score !== null).reduce<typeof review.counts[number] | null>((worst, count) => (!worst || count.score! < worst.score! ? count : worst), null)
  const [selectedCount, setSelectedCount] = useState(weakest?.count ?? 1)
  const [mode, setMode] = useState<'overlay' | 'side'>('overlay')
  const selected = review.counts.find((count) => count.count === selectedCount)
  const formation = formationSummary(positions)

  const landingCount = [...positions].reverse().find((entry) => entry.actual && entry.target)
  const mapping = take.mapping
  const landingOthers = landingCount && mapping
    ? analysis.tracks.filter((item) => item.id !== role.id).map((item) => trackFloorAt(item, phrase.counts[landingCount.count - 1].timeSec, referenceCamera)).filter((p): p is FloorPoint => p !== null).map((p) => toLearnerFloor(p, mapping))
    : []

  // Same captured take, judged against another dancer's spots. Only the formation target changes.
  const otherDancers = analysis.tracks.filter((item) => item.id !== role.id)
  const [compareId, setCompareId] = useState(otherDancers[0]?.id ?? '')
  const compared = useMemo(() => {
    const compareTrack = analysis.tracks.find((item) => item.id === compareId && item.id !== role.id)
    return compareTrack ? formationSummary(rejudgeFormation(take, phrase, compareTrack, referenceCamera)) : null
  }, [analysis.tracks, compareId, role.id, take, phrase, referenceCamera])

  const { fix, detail: fixDetail } = primaryFix(review, positions)

  return <div className="practice-screen">
    <AppHeader
      onHome={onHome}
      center={<StepIndicator current="practice" onSelect={onStep} />}
      end={<span className="practice-learning-as text-body-small text-muted">Learning as <Chip>{role.label}</Chip></span>}
    />
    <main className="practice-content">
      <div className="practice-title">
        <span className="text-mono text-muted">{session.rehearsal.name}</span>
        <h1 className="text-h1">Practice &amp; correct</h1>
      </div>

      <div className="practice-columns">
        <section className="practice-left">
          <div className="practice-context">
            <h2 className="text-h3">Take {take.number} · Phrase {phraseIndex + 1}, counts {phraseIndex * 8 + 1}–{phraseIndex * 8 + 8}</h2>
            <Chip>{role.label}</Chip>
            <Chip tone="neutral">{take.speed}× speed</Chip>
          </div>

          <TakeReplay rehearsalId={session.rehearsal.id} phraseNumber={phraseIndex + 1} take={take} fix={fix} />

          <div className="practice-stage">
            <TakeCompare
              target={track && selected ? poseAt(track, selected.snapshot?.referenceTimeSec ?? selected.timeSec + 0.08) : null}
              targetAspect={meta.aspect}
              learner={selected?.snapshot?.learner ?? null}
              learnerAspect={take.learnerAspect}
              mode={mode}
            />
            <span className="practice-tag">Count {selectedCount} · <b className="is-target">target</b> and <b className="is-you">you</b></span>
            <div className="practice-mode"><SegmentedControl label="Compare mode" value={mode} onChange={setMode} options={[{ value: 'overlay', label: 'Overlay' }, { value: 'side', label: 'Side by side' }]} /></div>
            {!selected?.snapshot && <p className="practice-stage-empty">Your pose was not captured clearly on this count.</p>}
            <div className="practice-beats" role="radiogroup" aria-label="Count to compare">
              {review.counts.map((count) => <button
                key={count.count}
                type="button"
                role="radio"
                aria-checked={count.count === selectedCount}
                className={`practice-beat tone-${scoreTone(count.score)} ${count.count === selectedCount ? 'is-selected' : ''}`}
                title={`Count ${count.count}: ${count.score ?? 'not scored'}`}
                onClick={() => setSelectedCount(count.count)}
              >{count.count}</button>)}
            </div>
          </div>
          {selected && <p className="practice-count-note text-body-small text-secondary">
            Count {selected.count}{selected.score !== null ? ` · ${selected.score}` : ''}: {selected.correction}.
            {(() => { const place = positions.find((entry) => entry.count === selected.count); return place?.errorM == null ? null : place.instruction ? ` Floor: ${place.instruction.charAt(0).toLowerCase()}${place.instruction.slice(1)}.` : ' Floor: on your spot.' })()}
          </p>}

          <div className="practice-actions">
            <Button onClick={onRetry} icon={<img src={iconRetry} width={20} height={20} alt="" />}>Retry phrase {phraseIndex + 1}</Button>
            <Button variant="secondary" onClick={onWatchAgain}>Watch it again at 0.5×</Button>
            {onNextPhrase && <Button variant="secondary" onClick={onNextPhrase}>Next phrase: Phrase {phraseIndex + 2}</Button>}
          </div>
          <p className="text-micro text-muted">Left and right are your own, facing the camera. <button type="button" className="practice-link" onClick={onOpenWorkbench}>Open the original workbench</button> for test videos and manual floor calibration.</p>
        </section>

        <aside className="practice-side">
          <section className="practice-fix">
            <span className="practice-fix-label">YOUR ONE FIX</span>
            <p className="text-fix">{fix}</p>
            {fixDetail && <p className="text-body-small text-secondary">{fixDetail}</p>}
          </section>

          <section className="practice-card">
            <h3 className="text-h4">This take</h3>
            <ScoreBar label="Timing" score={null} valueLabel={timingLabel(review.timing)} detail={review.timing ?? 'Not enough movement in this take to judge timing.'} />
            <ScoreBar label="Feet and travel" score={null} valueLabel={travelLabel(review.travel)} detail={review.travel ?? 'Travel could not be measured in this take.'} />
            <ScoreBar
              label="Formation position"
              score={formation.placed ? Math.round(formation.onSpot / formation.placed * 100) : null}
              valueLabel={formation.placed ? `${formation.onSpot}/${formation.placed}` : undefined}
              detail={formation.placed ? 'Counts where you stood on your spot.' : 'Your floor position could not be measured. Start the take on your starting spot with your feet in view.'}
            />
            <ScoreBar label="Body shape" score={review.score} detail="Average pose match across the counts." />
          </section>

          <section className="practice-card">
            <h3 className="text-h4">Where you landed</h3>
            <LandingMap position={landingCount} others={landingOthers} />
            <div className="practice-key text-caption text-muted">
              <span>Filled = your mark{landingCount ? ` on count ${landingCount.count}` : ''}</span>
              <span>Ring = where you landed</span>
            </div>
          </section>

          {take.mapping && otherDancers.length > 0 && <section className="practice-card">
            <h3 className="text-h4">Same take, another dancer</h3>
            <p className="text-caption text-muted">Your movement stays exactly the same. Only the spots you are judged against change.</p>
            <label className="practice-compare">
              <span>Judge as</span>
              <select value={compareId} onChange={(event) => setCompareId(event.target.value)}>
                {otherDancers.map((item) => <option key={item.id} value={item.id}>{roles.find((roleItem) => roleItem.id === item.id)?.label ?? item.id}</option>)}
              </select>
            </label>
            <p className="text-body-small">
              As {role.label}: on your spot for {formation.onSpot}/{formation.placed} counts.<br />
              As {roles.find((item) => item.id === compareId)?.label ?? compareId}: {compared && compared.placed ? `on the spot for ${compared.onSpot}/${compared.placed} counts.` : 'not tracked clearly enough to judge.'}
            </p>
          </section>}
        </aside>
      </div>
    </main>
  </div>
}
