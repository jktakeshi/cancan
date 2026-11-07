import { useEffect, useMemo, useRef, useState } from 'react'
import iconRecord from '../assets/iconRecord.svg'
import { FloorRadar } from '../FloorGuide'
import { phraseTrail, teachPhrase } from '../movement'
import { phraseOverviews } from '../phraseSketches'
import type { RehearsalSession } from '../useRehearsalSession'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { CountCell } from '../ui/CountCell'
import { SegmentedControl } from '../ui/SegmentedControl'
import { AppHeader } from './AppHeader'
import { LearnStage } from './LearnStage'
import { StepIndicator, type FlowStep } from './StepIndicator'
import './Learn.css'

type ViewMode = 'video' | 'skeleton' | 'mirror'
type PlayRange = { startSec: number; endSec: number; count: number | null }

const speeds = [0.25, 0.5, 0.75, 1]
const youColor = '#ffe600'
const otherColor = '#626262'

type LearnProps = {
  session: RehearsalSession
  roleId: string
  phraseId: string
  /** Opens the recording dialog at the speed the learner was watching. */
  onRecord: (speed: number) => void
  onStep: (step: FlowStep) => void
  onHome: () => void
}

/** Step 3: watch the chosen phrase with the learner's dancer highlighted, count by count. */
export function Learn({ session, roleId, phraseId, onRecord, onStep, onHome }: LearnProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { phrases, roles, analysis, referenceCamera, meta, countGrid } = session
  const phraseIndex = Math.max(0, phrases.findIndex((item) => item.id === phraseId))
  const phrase = phrases[phraseIndex]
  const role = roles.find((item) => item.id === roleId) ?? roles[0]
  const track = analysis.tracks.find((item) => item.id === role.id)

  const [view, setView] = useState<ViewMode>('video')
  const [speed, setSpeed] = useState(0.5)
  const [showOthers, setShowOthers] = useState(true)
  const [looping, setLooping] = useState(true)
  const [range, setRange] = useState<PlayRange | null>(null)
  const [time, setTime] = useState(phrase.startSec)
  const [playing, setPlaying] = useState(false)
  const rangeRef = useRef(range)
  const loopingRef = useRef(looping)
  useEffect(() => { rangeRef.current = range; loopingRef.current = looping })

  const lessons = useMemo(() => teachPhrase(track, phrase, meta.aspect), [track, phrase, meta.aspect])
  const trail = useMemo(() => (track ? { color: youColor, startSec: phrase.startSec, endSec: phrase.endSec, ...phraseTrail(track, phrase) } : undefined), [track, phrase])
  const overview = useMemo(() => phraseOverviews(phrases, analysis.tracks, role.id, referenceCamera)[phraseIndex], [phrases, analysis.tracks, role.id, referenceCamera, phraseIndex])
  // The floor map needs the dancer's own path in this phrase; without it there is nothing honest to draw.
  const tracked = Boolean(overview?.sketch?.start || overview?.sketch?.end)
  const radarSelf = track ?{ track, role: { ...role, color: youColor, label: '' } } : null
  const radarOthers = useMemo(() => (showOthers ? analysis.tracks.filter((item) => item.id !== role.id).map((item) => ({ track: item, role: { ...role, id: item.id, color: otherColor, label: '' } })) : []), [analysis.tracks, role, showOthers])

  // One loop follows the video clock: it keeps playback inside the chosen range and refreshes the count.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const video = videoRef.current
      if (!video) return
      const current = rangeRef.current
      if (current && !video.paused && video.currentTime >= current.endSec) {
        if (loopingRef.current) video.currentTime = current.startSec
        else video.pause()
      }
      setTime((value) => (Math.abs(value - video.currentTime) > 0.03 ? video.currentTime : value))
      setPlaying((value) => (value === !video.paused ? value : !video.paused))
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed }, [speed])

  const play = (next: PlayRange) => {
    const video = videoRef.current
    if (!video) return
    setRange(next)
    rangeRef.current = next
    video.currentTime = next.startSec
    video.playbackRate = speed
    void video.play()
  }
  const playPhrase = () => play({ startSec: phrase.startSec, endSec: phrase.endSec, count: null })

  const inPhrase = time >= phrase.startSec - 0.05 && time < phrase.endSec + 0.05
  const activeLesson = inPhrase ? lessons.findLast((lesson) => time >= lesson.timeSec - 0.05) : undefined
  // Before count 1 the badge shows the count-in ("5, 6, 7, 8") when the music grid knows it.
  const grid = countGrid.grid
  const countIn = !inPhrase && grid && time < (grid.counts[0] ?? Infinity) - 0.05 ? grid.countIn.findLastIndex((mark) => time >= mark - 0.05) : -1
  const badge = activeLesson ? String(activeLesson.count) : countIn >= 0 && grid ? String(9 - grid.countIn.length + countIn) : null
  const cue = activeLesson ? activeLesson.cues.join(' · ') : playing ? 'Getting ready for count 1.' : 'Press play to watch the phrase, or tap a count below to loop it.'

  return <div className="learn">
    <AppHeader
      onHome={onHome}
      center={<StepIndicator current="learn" onSelect={onStep} />}
      end={<span className="learn-learning-as text-body-small text-muted">Learning as <Chip>{role.label}</Chip></span>}
    />
    <main className="learn-content">
      <div className="learn-title">
        <span className="text-mono text-muted">{session.rehearsal.name}</span>
        <h1 className="text-h1">Watch &amp; learn</h1>
      </div>
      <div className="learn-context">
        <h2 className="text-h3">Phrase {phraseIndex + 1} · counts {phraseIndex * 8 + 1}–{phraseIndex * 8 + 8}</h2>
        <Chip>{role.label}</Chip>
      </div>

      <div className="learn-columns">
        <section className="learn-player">
          <div className="learn-controls">
            <div className="learn-control-group">
              <SegmentedControl label="View" value={view} onChange={setView} options={[{ value: 'video', label: 'Video' }, { value: 'skeleton', label: 'Skeleton' }, { value: 'mirror', label: 'Mirror' }]} />
              <SegmentedControl label="Playback speed" value={speed} onChange={setSpeed} options={speeds.map((value) => ({ value, label: `${value}×` }))} />
            </div>
            <label className="learn-toggle">
              <span>Other dancers</span>
              <span className="learn-toggle-box">
                <input type="checkbox" checked={showOthers} onChange={(event) => setShowOthers(event.target.checked)} />
                <span className="pill" aria-hidden="true" />
                <span>{showOthers ? 'On' : 'Off'}</span>
              </span>
            </label>
          </div>

          <div className={`learn-stage is-${view}`}>
            <video ref={videoRef} src={session.rehearsal.url} playsInline preload="auto" onLoadedMetadata={(event) => { event.currentTarget.currentTime = phrase.startSec }} />
            <LearnStage videoRef={videoRef} tracks={analysis.tracks} roleId={role.id} showOthers={showOthers} mirrored={view === 'mirror'} trail={trail} />
            {view === 'mirror' && <span className="learn-tag">Mirrored · left and right match your reflection</span>}
            {badge && <div className="learn-count-badge" aria-live="off"><span>{activeLesson ? 'COUNT' : 'COUNT-IN'}</span><strong>{badge}</strong></div>}
            <p className="learn-cue">{cue}</p>
          </div>

          <div className="learn-playback">
            <Button size="medium" onClick={playPhrase}>Play phrase</Button>
            <Button size="medium" variant="secondary" disabled={!playing} onClick={() => videoRef.current?.pause()}>Pause</Button>
            <label className="learn-loop"><input type="checkbox" checked={looping} onChange={(event) => setLooping(event.target.checked)} /> Loop</label>
            {range?.count != null && <span className="text-caption text-muted">Looping count {range.count}. <button type="button" className="learn-link" onClick={playPhrase}>Back to the whole phrase</button></span>}
          </div>

          <div className="learn-counts" role="list" aria-label="Counts in this phrase">
            {lessons.map((lesson) => {
              const state = activeLesson?.count === lesson.count ? 'current' : range?.count === lesson.count ? 'looped' : 'default'
              return <div role="listitem" key={lesson.count} className="learn-count">
                <CountCell
                  count={lesson.count}
                  step={lesson.cues[0] ?? ''}
                  state={state}
                  unclear={!lesson.visible}
                  title={`${lesson.cues.join(' · ')}. Click to loop this count.`}
                  onClick={() => play({ startSec: lesson.timeSec, endSec: lesson.endSec, count: lesson.count })}
                />
              </div>
            })}
          </div>
          <p className="text-micro text-muted">Cues are measured from the dancer's pose. Left and right are your own, facing the front. Tap a count to loop it.</p>
        </section>

        <aside className="learn-side">
          <section className="learn-floor">
            <h2 className="text-h4">Floor path</h2>
            <div className="learn-floor-stage">
              <span className="edge top">UPSTAGE</span>
              {radarSelf && tracked ? <FloorRadar videoRef={videoRef} phrase={phrase} self={radarSelf} others={radarOthers} referenceCamera={referenceCamera} mapping={null} learnerSpot={null} mirrored={view === 'mirror'} /> : <p className="learn-floor-empty">{role.label} is not tracked in this phrase.</p>}
            </div>
            <p className="text-body-small text-muted">{overview?.travel}{tracked ? ' The dashed line is your path in this phrase and the big yellow dot is where you are now.' : ''}{tracked && view === 'mirror' ? ' Mirrored, like the video.' : ''}</p>
          </section>
          {!track && <p className="text-caption text-muted">{role.label} was not found in the video, so there is nothing to compare a take against. Pick another dancer or fix the tracking on step 1.</p>}
          <Button block className="learn-record" disabled={!track} onClick={() => { videoRef.current?.pause(); onRecord(speed) }} icon={<img src={iconRecord} width={18} height={18} alt="" />}>Record a practice take</Button>
        </aside>
      </div>
    </main>
  </div>
}
