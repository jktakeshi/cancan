import { useMemo, useRef, useState } from 'react'
import iconCheck from '../assets/iconCheck.svg'
import { ReferenceOverlay } from '../PoseOverlay'
import type { ReferenceTrack } from '../referenceTracking'
import { referenceAnalysisConfig } from '../useReferenceAnalysis'
import type { RehearsalSession } from '../useRehearsalSession'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { Scrubber } from '../ui/Scrubber'
import { AppHeader } from './AppHeader'
import { StepIndicator } from './StepIndicator'
import './PickRole.css'

/** Accent for the learner's own dancer and grey for everyone else, as in the Figma frame. */
const youColor = '#ffe600'
const otherColor = '#626262'

/** Where a dancer first appears, described in camera terms because the clip is filmed from the front. */
function startDescription(track: ReferenceTrack | undefined, duration: number) {
  if (!track?.frames.length) return 'Not found in the video yet.'
  const x = track.frames[0].center.x
  const side = x < 0.38 ? 'on the left of the frame' : x > 0.62 ? 'on the right of the frame' : 'near the center of the frame'
  const seen = duration > 0 ? Math.min(100, Math.round(track.frames.length * referenceAnalysisConfig.stepSec / duration * 100)) : null
  return `Starts ${side}.${seen === null ? '' : ` Tracked in ${seen}% of the clip.`}`
}

type PickRoleProps = {
  session: RehearsalSession
  roleId: string
  onRoleChange: (roleId: string) => void
  onPick: (roleId: string) => void
  onHome: () => void
}

/** Step 1: the learner chooses whose part to learn by tapping a dancer or choosing from the list. */
export function PickRole({ session, roleId, onRoleChange, onPick, onHome }: PickRoleProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [fixing, setFixing] = useState(false)
  const { analysis, roles, phrases, phrasesArePlaceholder, meta } = session
  const role = roles.find((item) => item.id === roleId) ?? roles[0]
  const tracksById = useMemo(() => new Map(analysis.tracks.map((track) => [track.id, track])), [analysis.tracks])
  const selectedTrack = tracksById.get(role.id)
  const done = analysis.status === 'done'

  const overlayRoles = useMemo(() => roles.map((item) => item.id === role.id
    ? { id: item.id, label: `You · ${item.label}`, color: youColor }
    : { id: item.id, label: item.label, color: otherColor }), [roles, role.id])

  const tapDancer = (trackIndex: number) => {
    const track = analysis.tracks[trackIndex]
    if (!track) return
    if (fixing) {
      // Tracking fix: the person tapped at this moment is really the selected role.
      analysis.assignRole(role.id, trackIndex, videoRef.current?.currentTime ?? 0)
      setFixing(false)
    } else onRoleChange(track.id)
  }

  const countsLine = phrasesArePlaceholder ? 'Counts are still being detected' : `${phrases.length} phrases · ${phrases.length * 8} counts`

  const status = analysis.status === 'analyzing'
    ? `Finding dancers… ${analysis.progress}%${analysis.remainingSec !== null ? ` · about ${Math.max(1, Math.ceil(analysis.remainingSec / 60))} min left` : ''}`
    : analysis.status === 'error' ? `Dancer detection failed: ${analysis.error}`
      : session.loadError || (done ? '' : 'Loading the video…')

  return <div className="pick-role">
    <AppHeader onHome={onHome} center={<StepIndicator current="role" />} />
    <main className="pick-role-content">
      <section className="pick-role-video-column">
        <div className="pick-role-intro">
          <span className="text-mono text-muted">{session.rehearsal.name}</span>
          <h1 className="text-h1">Who are you in this piece?</h1>
          <p className="text-body text-muted">Tap your dancer in the frame, or pick a role on the right. We will follow only them.</p>
        </div>
        <div className="pick-role-frame">
          <div className="pick-role-stage">
            <video ref={videoRef} src={session.rehearsal.url} muted playsInline preload="auto" />
            {done && <ReferenceOverlay videoRef={videoRef} tracks={analysis.tracks} roles={overlayRoles} selectedRoleId={role.id} onPickDancer={tapDancer} />}
            {status && <span className="pick-role-tag">{status}</span>}
            {fixing && <span className="pick-role-tag is-fixing">Tap the person who is {role.label} right now</span>}
          </div>
          <Scrubber videoRef={videoRef} />
        </div>
        <p className="pick-role-hint">Not sure? Scrub to a moment where you remember your spot and tap yourself.</p>
      </section>

      <aside className="pick-role-roles" aria-labelledby="roles-title">
        <h2 id="roles-title" className="pick-role-roles-title">Roles in this piece</h2>
        <div className="pick-role-list" role="radiogroup" aria-label="Roles">
          {roles.map((item) => {
            const selected = item.id === role.id
            return <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`pick-role-card ${selected ? 'is-selected' : ''}`}
              onClick={() => onRoleChange(item.id)}
            >
              <span className="title-row"><span className="text-h4">{item.label}</span>{selected && <Chip>Selected</Chip>}</span>
              <span className="text-body-small text-muted">{done ? startDescription(tracksById.get(item.id), meta.duration) : 'Waiting for dancer detection.'}</span>
              <span className="text-mono-small text-muted">{countsLine}</span>
            </button>
          })}
        </div>

        <details className="pick-role-adjust">
          <summary>Adjust detection</summary>
          <label className="pick-role-count">
            <span>Dancers in the video</span>
            <input type="number" min={1} max={24} value={session.dancerCount} onChange={(event) => session.changeDancerCount(Number(event.target.value))} />
          </label>
          <div className="pick-role-adjust-actions">
            <Button variant="secondary" size="medium" disabled={analysis.status === 'analyzing'} onClick={session.redetect}>Re-detect dancers</Button>
            <Button variant="secondary" size="medium" disabled={!done} onClick={() => { videoRef.current?.pause(); setFixing((value) => !value) }}>{fixing ? 'Cancel fix' : `Wrong person is ${role.label}?`}</Button>
          </div>
          <p className="text-micro text-muted">A tracking fix only changes the stretch of video around the moment you tap.</p>
        </details>

        <Button block disabled={!done || !selectedTrack} onClick={() => onPick(role.id)} icon={<img src={iconCheck} width={20} height={20} alt="" />}>Pick {role.label}</Button>
        {done && !selectedTrack && <p className="text-micro text-muted">{role.label} was not found. Tap a dancer in the frame or use the tracking fix.</p>}
      </aside>
    </main>
  </div>
}
