import { useEffect, useRef, useState } from 'react'
import iconCheckSmall from '../assets/iconCheckSmall.svg'
import iconClose from '../assets/iconClose.svg'
import iconRecord from '../assets/iconRecord.svg'
import iconStop from '../assets/iconStop.svg'
import iconVideo from '../assets/iconVideo.svg'
import recordingIndicator from '../assets/recordingIndicator.svg'
import type { Phrase, PoseLandmark, RoleTarget } from '../domain'
import { cameraFor, floorConfig, floorPosition, learnerView, mappingFor, reviewPositions, toLearnerFloor, trackFloorAt, type FloorPoint, type LearnerView } from '../floor'
import { retargetPose, reviewTake } from '../movement'
import { poseAt, type ReferenceTrack } from '../referenceTracking'
import { drawSkeleton, prepareCanvas, videoContentRect } from '../skeleton'
import type { Take } from '../takes'
import { usePoseInput } from '../usePoseInput'
import type { RehearsalSession } from '../useRehearsalSession'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'
import { LearnStage } from './LearnStage'
import './RecordTake.css'

type Phase = 'idle' | 'countdown' | 'recording'

/** Counts of music played before count 1 when a take starts (the "5, 6, 7, 8"). */
const leadInCounts = 4
const speeds = [0.25, 0.5, 0.75, 1]
const floorScales = [1, 0.75, 0.5]
const learnerColor = '#3de0ff'
const ghostColor = '#ffe600'

function framing(landmarks: PoseLandmark[] | undefined) {
  if (!landmarks?.length) return { ok: false, text: "Can't see you yet. Step into the frame." }
  const seen = (index: number) => (landmarks[index]?.visibility ?? 0) >= 0.5
  if (![11, 12, 23, 24].every(seen)) return { ok: false, text: 'Face the camera so your shoulders and hips show' }
  if (!seen(27) || !seen(28)) return { ok: false, text: 'Step back so your feet are in view' }
  return { ok: true, text: 'Full body in frame' }
}

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

type RecordTakeProps = {
  session: RehearsalSession
  phrase: Phrase
  phraseNumber: number
  role: RoleTarget
  track: ReferenceTrack
  takeNumber: number
  initialSpeed: number
  onClose: () => void
  onFinished: (take: Take) => void
}

/**
 * Record a take in front of the webcam. The reference video in the corner is the clock: every
 * learner sample is stamped with the reference time it was captured at, which keeps the review
 * aligned with the choreography even in slow motion.
 */
export function RecordTake({ session, phrase, phraseNumber, role, track, takeNumber, initialSpeed, onClose, onFinished }: RecordTakeProps) {
  const pose = usePoseInput()
  const webcamRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const referenceRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timersRef = useRef<number[]>([])
  const phaseRef = useRef<Phase>('idle')
  const anchorRef = useRef<{ spot: FloorPoint; view: LearnerView } | null>(null)
  const [phase, setPhaseState] = useState<Phase>('idle')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [cameraLabel, setCameraLabel] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [speed, setSpeed] = useState(initialSpeed)
  const [floorScale, setFloorScale] = useState(1)
  const [showGhost, setShowGhost] = useState(true)
  const [referenceTime, setReferenceTime] = useState(phrase.startSec)
  const [recordStartedAt, setRecordStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next) }

  const { start: startPose, stop: stopPose } = pose
  // The camera starts as soon as the dialog opens so the learner can frame themselves first.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
        if (cancelled) { stream.getTracks().forEach((item) => item.stop()); return }
        streamRef.current = stream
        setCameraLabel(stream.getVideoTracks()[0]?.label ?? '')
        const video = webcamRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        void startPose(video, () => (referenceRef.current?.currentTime ?? 0) * 1000)
      } catch (caught) {
        setCameraError(caught instanceof Error && caught.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in the address bar, then open this again.'
          : 'Could not start the camera. Check that no other app is using it.')
      }
    })()
    const timers = timersRef.current
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      stopPose()
      streamRef.current?.getTracks().forEach((item) => item.stop())
      streamRef.current = null
    }
  }, [startPose, stopPose])

  const learnerCamera = () => {
    const webcam = webcamRef.current
    return cameraFor(webcam?.videoWidth || 1280, webcam?.videoHeight || 720, floorConfig.learnerHfovDeg)
  }

  const finishTake = () => {
    referenceRef.current?.pause()
    const webcam = webcamRef.current
    const learnerAspect = webcam?.videoWidth && webcam.videoHeight ? webcam.videoWidth / webcam.videoHeight : 16 / 9
    const samples = [...pose.samplesRef.current]
    const camera = learnerCamera()
    const anchor = anchorRef.current
    const mapping = anchor ? mappingFor(track, phrase, session.referenceCamera, anchor.spot, floorScale) : null
    const positions = mapping
      ? reviewPositions(samples, phrase, camera, (timeSec) => { const reference = trackFloorAt(track, timeSec, session.referenceCamera); return reference ? toLearnerFloor(reference, mapping) : null })
      : []
    setPhase('idle')
    onFinished({
      number: takeNumber,
      phraseId: phrase.id,
      roleId: role.id,
      speed,
      review: reviewTake(samples, track, phrase, session.meta.aspect, learnerAspect),
      positions,
      samples,
      learnerAspect,
      learnerCamera: camera,
      mapping,
    })
  }

  const startTake = () => {
    const reference = referenceRef.current
    if (!reference) return
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    // Where the learner stands when the take starts is where the role starts this phrase.
    const landmarks = pose.latest?.landmarks
    const camera = learnerCamera()
    const spot = landmarks?.length ? floorPosition(landmarks, camera, 0.5) : null
    const view = landmarks?.length ? learnerView(landmarks, camera) : null
    anchorRef.current = spot && view ? { spot, view } : null
    reference.pause()
    const countSec = phrase.counts[1].timeSec - phrase.counts[0].timeSec
    const leadSec = Math.min(phrase.startSec, countSec * leadInCounts)
    reference.currentTime = phrase.startSec - leadSec
    setPhase('countdown')
    ;[3, 2, 1].forEach((value, index) => timersRef.current.push(window.setTimeout(() => setCountdown(value), index * 700)))
    timersRef.current.push(window.setTimeout(() => {
      setCountdown(null)
      pose.trimSamples()
      reference.playbackRate = speed
      void reference.play()
      setRecordStartedAt(performance.now())
      setPhase('recording')
    }, 2100))
  }

  const cancelTake = () => {
    timersRef.current.forEach(clearTimeout)
    setCountdown(null)
    referenceRef.current?.pause()
    setPhase('idle')
  }

  // One frame loop: ends the take after count 8, keeps the idle buffer short, and redraws the overlay.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const reference = referenceRef.current
      if (reference) setReferenceTime((value) => (Math.abs(value - reference.currentTime) > 0.03 ? reference.currentTime : value))
      if (phaseRef.current === 'recording') {
        setNow(performance.now())
        if (reference && (reference.currentTime >= phrase.endSec + 0.15 || reference.ended)) finishTake()
      } else if (pose.samplesRef.current.length > 300) pose.trimSamples(30)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })

  // Live overlay: the learner in the skeleton accent and, optionally, the target pose fitted onto their body.
  useEffect(() => {
    const canvas = canvasRef.current
    const webcam = webcamRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas)
    if (!ctx || !webcam || !pose.latest?.landmarks.length) return
    const rect = videoContentRect(webcam)
    const webcamAspect = webcam.videoWidth / Math.max(1, webcam.videoHeight)
    const reference = showGhost ? poseAt(track, referenceRef.current?.currentTime ?? phrase.startSec) : null
    const ghost = reference ? retargetPose(reference, session.meta.aspect, pose.latest.landmarks, webcamAspect) : null
    if (ghost) drawSkeleton(ctx, ghost, rect, { color: ghostColor, emphasis: true, mirrored: true, minVisibility: 0.3, alpha: 0.55 })
    drawSkeleton(ctx, pose.latest.landmarks, rect, { color: learnerColor, emphasis: true, mirrored: true, minVisibility: 0.5 })
  })

  const frameCheck = framing(pose.latest?.landmarks)
  const inPhrase = referenceTime >= phrase.startSec - 0.05 && referenceTime < phrase.endSec + 0.05
  const currentCount = inPhrase ? phrase.counts.findLast((mark) => referenceTime >= mark.timeSec - 0.05)?.count : undefined
  const countSec = phrase.counts[1].timeSec - phrase.counts[0].timeSec
  const countIn = phase === 'recording' && referenceTime < phrase.startSec - 0.02
    ? 9 - Math.min(leadInCounts, Math.ceil((phrase.startSec - referenceTime) / countSec - 0.01))
    : null
  const busy = phase !== 'idle'

  return <div className="record-backdrop" role="presentation">
    <section className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="record-title">
      <header className="record-header">
        <div>
          <h2 id="record-title" className="text-h3">Record yourself</h2>
          <p className="text-body-small text-muted">Phrase {phraseNumber} · {role.label} · take {takeNumber}</p>
        </div>
        <button type="button" className="record-close" aria-label="Close recording" onClick={() => { cancelTake(); onClose() }}><img src={iconClose} width={18} height={18} alt="" /></button>
      </header>

      <div className="record-stage">
        <video ref={webcamRef} className="record-webcam" muted playsInline />
        <canvas ref={canvasRef} className="record-overlay" />
        {cameraError && <p className="record-error" role="alert">{cameraError}</p>}
        {!cameraError && pose.status === 'loading' && <p className="record-loading">Loading the pose model…</p>}

        <div className="record-status">
          {phase === 'recording'
            ? <><img src={recordingIndicator} width={8} height={8} alt="" /><span className="text-label-small">Recording</span><i /><span className="text-mono">{clock((now - recordStartedAt) / 1000)}</span></>
            : <span className="text-label-small">{phase === 'countdown' ? 'Get ready' : 'Ready'}</span>}
        </div>

        <div className="record-reference">
          <video ref={referenceRef} src={session.rehearsal.url} playsInline preload="auto" onLoadedMetadata={(event) => { event.currentTarget.currentTime = phrase.startSec }} />
          <LearnStage videoRef={referenceRef} tracks={[track]} roleId={role.id} showOthers={false} mirrored={false} />
          <span className="record-reference-label text-mono-small">{speed}× · {countIn ? `count-in ${countIn}` : currentCount ? `count ${currentCount} of 8` : `${role.label}`}</span>
        </div>

        {cameraLabel && <div className="record-camera"><img src={iconVideo} width={15} height={15} alt="" /><span>You · {cameraLabel}</span></div>}
        <div className={`record-framing ${frameCheck.ok ? 'is-ok' : 'is-warn'}`}>
          {frameCheck.ok && <img src={iconCheckSmall} width={16} height={16} alt="" />}
          <span>{pose.status === 'loading' ? 'Starting the camera…' : frameCheck.text}</span>
        </div>

        {(countdown !== null || countIn !== null || (phase === 'recording' && currentCount)) && <div className={`record-big-count ${countdown !== null || countIn !== null ? 'is-lead' : ''}`}>{countdown ?? countIn ?? currentCount}</div>}
      </div>

      <div className="record-controls">
        {busy
          ? <Button onClick={cancelTake} icon={<img src={iconStop} width={20} height={20} alt="" />}>Cancel take</Button>
          : <Button disabled={!!cameraError || pose.status !== 'ready'} onClick={startTake} icon={<img src={iconRecord} width={18} height={18} alt="" />}>Start take</Button>}
        <p className="text-caption text-muted">A 5, 6, 7, 8 count-in plays before each take. Your results open by themselves after count 8. Stand on your starting spot when you press start.</p>
      </div>

      <details className="record-adjust">
        <summary>Take settings</summary>
        <div className="record-adjust-row">
          <span>Speed</span>
          <SegmentedControl size="small" label="Take speed" value={speed} onChange={(value) => { if (!busy) setSpeed(value) }} options={speeds.map((value) => ({ value, label: `${value}×`, disabled: busy }))} />
        </div>
        <div className="record-adjust-row">
          <span>Room size</span>
          <SegmentedControl size="small" label="Room size" value={floorScale} onChange={(value) => { if (!busy) setFloorScale(value) }} options={floorScales.map((value) => ({ value, label: value === 1 ? 'Full stage' : `${value * 100}% stage`, disabled: busy }))} />
        </div>
        <label className="record-adjust-row"><span>Target ghost on your body</span><input type="checkbox" checked={showGhost} onChange={(event) => setShowGhost(event.target.checked)} /></label>
      </details>
    </section>
  </div>
}
