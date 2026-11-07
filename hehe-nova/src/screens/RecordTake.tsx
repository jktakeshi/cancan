import { useEffect, useMemo, useRef, useState } from 'react'
import iconCheckSmall from '../assets/iconCheckSmall.svg'
import iconClose from '../assets/iconClose.svg'
import iconRecord from '../assets/iconRecord.svg'
import iconStop from '../assets/iconStop.svg'
import iconVideo from '../assets/iconVideo.svg'
import recordingIndicator from '../assets/recordingIndicator.svg'
import type { Phrase, PoseLandmark, RoleTarget } from '../domain'
import { cameraFor, fitScaleToView, floorConfig, floorPosition, learnerView, moveInstruction, reviewPositions, toLearnerFloor, trackFloorAt, type FloorMapping, type FloorPoint, type LearnerView } from '../floor'
import { drawFormationHologram } from '../floorDrawing'
import { retargetPose, reviewTake } from '../movement'
import { poseAt, type ReferenceTrack } from '../referenceTracking'
import { drawSkeleton, prepareCanvas, videoContentRect } from '../skeleton'
import { recorderMimeType } from '../takeVideos'
import type { Take } from '../takes'
import { usePoseInput } from '../usePoseInput'
import type { RehearsalSession } from '../useRehearsalSession'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'
import { LearnStage } from './LearnStage'
import './RecordTake.css'

type Phase = 'idle' | 'countdown' | 'recording' | 'finishing'

/** Counts of music played before count 1 when a take starts (the "5, 6, 7, 8"). */
const leadInCounts = 4
const speeds = [0.25, 0.5, 0.75, 1]
const learnerColor = '#3de0ff'
const ghostColor = '#ffe600'
/** Width of the saved take video; the stage is scaled to it. */
const recordingWidth = 960

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
 *
 * Floor guidance needs no room measurements: the learner's start spot anchors the formation, and
 * the formation is shrunk until every dancer stays inside the webcam view (see fitScaleToView).
 * What the learner sees, overlays and music included, is recorded so the take can be replayed.
 */
export function RecordTake({ session, phrase, phraseNumber, role, track, takeNumber, initialSpeed, onClose, onFinished }: RecordTakeProps) {
  const pose = usePoseInput()
  const webcamRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const referenceRef = useRef<HTMLVideoElement>(null)
  const referenceBoxRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timersRef = useRef<number[]>([])
  const phaseRef = useRef<Phase>('idle')
  /** Start spot and webcam geometry: live while idle, frozen when a take starts. */
  const anchorRef = useRef<{ spot: FloorPoint; view: LearnerView } | null>(null)
  const mappingRef = useRef<FloorMapping | null>(null)
  const compositeRef = useRef<HTMLCanvasElement | null>(null)
  const recorderRef = useRef<{ recorder: MediaRecorder; chunks: Blob[]; mimeType: string } | null>(null)
  const [phase, setPhaseState] = useState<Phase>('idle')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [cameraLabel, setCameraLabel] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [speed, setSpeed] = useState(initialSpeed)
  const [showGhost, setShowGhost] = useState(true)
  const [showOthers, setShowOthers] = useState(true)
  const [mirrorReference, setMirrorReference] = useState(true)
  const [fitScale, setFitScale] = useState<number | null>(null)
  const [moveHint, setMoveHint] = useState<string | null>(null)
  const drawnSampleRef = useRef<unknown>(null)
  const [recordStartedAt, setRecordStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next) }

  // Every dancer's floor position over the phrase, and the role's start spot, in reference meters.
  const referenceFloor = useMemo(() => {
    const points: FloorPoint[] = []
    for (const item of session.analysis.tracks) {
      for (let time = phrase.startSec; time <= phrase.endSec + 1e-9; time += 0.25) {
        const point = trackFloorAt(item, time, session.referenceCamera)
        if (point) points.push(point)
      }
    }
    let origin: FloorPoint | null = null
    for (let offset = 0; offset <= 1 && !origin; offset += 0.1) origin = trackFloorAt(track, phrase.startSec + offset, session.referenceCamera)
    return { points, origin }
  }, [session.analysis.tracks, session.referenceCamera, phrase, track])

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
      if (recorderRef.current?.recorder.state === 'recording') recorderRef.current.recorder.stop()
      streamRef.current?.getTracks().forEach((item) => item.stop())
      streamRef.current = null
    }
  }, [startPose, stopPose])

  const learnerCamera = () => {
    const webcam = webcamRef.current
    return cameraFor(webcam?.videoWidth || 1280, webcam?.videoHeight || 720, floorConfig.learnerHfovDeg)
  }

  /** Re-measure the start spot from the learner's current pose (smoothed while idle). */
  const measureAnchor = (landmarks: PoseLandmark[] | undefined, smooth: boolean) => {
    if (!landmarks?.length) return
    const camera = learnerCamera()
    const spot = floorPosition(landmarks, camera, 0.5)
    const view = learnerView(landmarks, camera)
    if (!spot || !view) return
    const previous = smooth ? anchorRef.current : null
    const blend = (a: number, b: number) => (previous ? a + (b - a) * 0.2 : b)
    anchorRef.current = {
      spot: previous ? { x: blend(previous.spot.x, spot.x), z: blend(previous.spot.z, spot.z) } : spot,
      view: previous ? { camera: view.camera, heightM: blend(previous.view.heightM, view.heightM) } : view,
    }
  }

  /** The formation mapped into the learner's room, scaled so every dancer stays in view. */
  const currentMapping = (): FloorMapping | null => {
    const anchor = anchorRef.current
    const { origin, points } = referenceFloor
    if (!anchor || !origin) return null
    const scale = fitScaleToView(points, origin, anchor.spot, anchor.view)
    return { anchor: anchor.spot, origin, scale }
  }

  const startRecorder = () => {
    const mimeType = recorderMimeType()
    if (!mimeType || typeof MediaRecorder === 'undefined') return
    const composite = document.createElement('canvas')
    const webcam = webcamRef.current
    composite.width = recordingWidth
    composite.height = Math.round(recordingWidth * (webcam?.videoHeight || 720) / (webcam?.videoWidth || 1280))
    compositeRef.current = composite
    const stream = composite.captureStream(30)
    // The music comes from the reference video, so the saved take plays with sound.
    try {
      const reference = referenceRef.current as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null
      reference?.captureStream?.().getAudioTracks().forEach((item) => stream.addTrack(item))
    } catch {
      // Recording without sound is still useful.
    }
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 })
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    recorder.start(500)
    recorderRef.current = { recorder, chunks, mimeType }
  }

  const stopRecorder = (): Promise<Take['recording']> => new Promise((resolve) => {
    const active = recorderRef.current
    recorderRef.current = null
    if (!active || active.recorder.state === 'inactive') { resolve(undefined); return }
    active.recorder.onstop = () => {
      const blob = new Blob(active.chunks, { type: active.mimeType })
      resolve(blob.size ? { blob, url: URL.createObjectURL(blob), mimeType: active.mimeType } : undefined)
    }
    active.recorder.stop()
  })

  /** One frame of the saved video: what the learner sees, plus the reference corner. */
  const drawComposite = () => {
    const composite = compositeRef.current
    const webcam = webcamRef.current
    const overlay = canvasRef.current
    const ctx = composite?.getContext('2d')
    if (!composite || !webcam || !overlay || !ctx) return
    const { width, height } = composite
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    ctx.save()
    ctx.translate(width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(webcam, 0, 0, width, height)
    ctx.restore()
    const rect = videoContentRect(webcam)
    const ratio = overlay.width / Math.max(1, overlay.clientWidth)
    if (rect.width > 0) ctx.drawImage(overlay, rect.left * ratio, rect.top * ratio, rect.width * ratio, rect.height * ratio, 0, 0, width, height)
    const reference = referenceRef.current
    const box = referenceBoxRef.current
    if (reference?.videoWidth && box) {
      const boxWidth = width * 0.26
      const boxHeight = boxWidth * reference.videoHeight / reference.videoWidth
      const x = width - boxWidth - 12
      const y = 12
      ctx.save()
      if (mirrorReference) { ctx.translate(x + boxWidth, y); ctx.scale(-1, 1) } else ctx.translate(x, y)
      ctx.drawImage(reference, 0, 0, boxWidth, boxHeight)
      ctx.restore()
      const stage = box.querySelector('canvas')
      if (stage?.width) ctx.drawImage(stage, x, y, boxWidth, boxHeight)
      ctx.strokeStyle = ghostColor
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, boxWidth, boxHeight)
    }
  }

  const finishTake = async () => {
    if (phaseRef.current !== 'recording') return
    setPhase('finishing')
    referenceRef.current?.pause()
    const recording = await stopRecorder()
    const webcam = webcamRef.current
    const learnerAspect = webcam?.videoWidth && webcam.videoHeight ? webcam.videoWidth / webcam.videoHeight : 16 / 9
    const samples = [...pose.samplesRef.current]
    const camera = learnerCamera()
    const mapping = mappingRef.current
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
      recording,
    })
  }

  const startTake = () => {
    const reference = referenceRef.current
    if (!reference) return
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    // Where the learner stands now is where the role starts; freeze it and the fitted scale.
    measureAnchor(pose.latest?.landmarks, false)
    mappingRef.current = currentMapping()
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
      startRecorder()
      setRecordStartedAt(performance.now())
      setPhase('recording')
    }, 2100))
  }

  const cancelTake = () => {
    timersRef.current.forEach(clearTimeout)
    setCountdown(null)
    referenceRef.current?.pause()
    void stopRecorder()
    setPhase('idle')
  }

  // Live overlay: the other dancers as grey holograms on the floor, your spot, the target ghost on
  // your body, and your own skeleton. Redrawn by the frame loop whenever a new pose arrives.
  const drawOverlay = () => {
    const canvas = canvasRef.current
    const webcam = webcamRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas)
    if (!ctx || !webcam || !pose.latest?.landmarks.length) return
    const rect = videoContentRect(webcam)
    const webcamAspect = webcam.videoWidth / Math.max(1, webcam.videoHeight)
    const time = referenceRef.current?.currentTime ?? phrase.startSec
    if (phaseRef.current === 'idle') {
      measureAnchor(pose.latest.landmarks, true)
      mappingRef.current = currentMapping()
      const scale = mappingRef.current?.scale ?? null
      setFitScale((value) => (value === null || scale === null || Math.abs(value - scale) > 0.03 ? scale : value))
    }
    const anchor = anchorRef.current
    const mapping = mappingRef.current
    if (showOthers && anchor && mapping) {
      const at = (item: ReferenceTrack, when: number) => { const point = trackFloorAt(item, when, session.referenceCamera); return point ? toLearnerFloor(point, mapping) : null }
      const target = at(track, Math.max(time, phrase.startSec))
      const nextCount = phrase.counts.find((mark) => mark.timeSec > time + 0.05)
      const others = session.analysis.tracks.filter((item) => item.id !== track.id).flatMap((item) => {
        const spot = at(item, time)
        const label = session.roles.find((candidate) => candidate.id === item.id)?.label.replace(/^Dancer /, '') ?? ''
        return spot ? [{ label, spot, pose: poseAt(item, time) }] : []
      })
      if (target) {
        drawFormationHologram(ctx, {
          rect, view: anchor.view, referenceCamera: session.referenceCamera, mirrored: true, others, target,
          next: nextCount ? at(track, nextCount.timeSec) : null,
          learnerSpot: floorPosition(pose.latest.landmarks, anchor.view.camera, 0.5),
          pulse: (performance.now() / 1200) % 1,
        })
      }
    }
    const reference = showGhost ? poseAt(track, time) : null
    const ghost = reference ? retargetPose(reference, session.meta.aspect, pose.latest.landmarks, webcamAspect) : null
    if (ghost) drawSkeleton(ctx, ghost, rect, { color: ghostColor, emphasis: true, mirrored: true, minVisibility: 0.3, alpha: 0.55 })
    drawSkeleton(ctx, pose.latest.landmarks, rect, { color: learnerColor, emphasis: true, mirrored: true, minVisibility: 0.5 })

    // Floor instruction while dancing, in steps toward the role's current spot.
    const learnerHere = anchor ? floorPosition(pose.latest.landmarks, anchor.view.camera, 0.5) : null
    const targetHere = mapping && phaseRef.current === 'recording' ? trackFloorAt(track, Math.max(time, phrase.startSec), session.referenceCamera) : null
    const hint = showOthers && learnerHere && targetHere && mapping ? moveInstruction(learnerHere, toLearnerFloor(targetHere, mapping)) : null
    setMoveHint((value) => (value === hint ? value : hint))
  }

  // One frame loop: ends the take after count 8, records the composite, and keeps the idle buffer short.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const reference = referenceRef.current
      if (pose.latest !== drawnSampleRef.current) {
        drawnSampleRef.current = pose.latest
        drawOverlay()
      }
      if (phaseRef.current === 'recording') {
        setNow(performance.now())
        drawComposite()
        if (reference && (reference.currentTime >= phrase.endSec + 0.15 || reference.ended)) void finishTake()
      } else if (pose.samplesRef.current.length > 300) pose.trimSamples(30)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })

  const frameCheck = framing(pose.latest?.landmarks)
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
            : <span className="text-label-small">{phase === 'countdown' ? 'Get ready' : phase === 'finishing' ? 'Saving your take…' : 'Ready'}</span>}
        </div>

        <div ref={referenceBoxRef} className={`record-reference ${mirrorReference ? 'is-mirrored' : ''}`}>
          <video ref={referenceRef} src={session.rehearsal.url} playsInline preload="auto" onLoadedMetadata={(event) => { event.currentTarget.currentTime = phrase.startSec }} />
          <LearnStage videoRef={referenceRef} tracks={[track]} roleId={role.id} showOthers={false} mirrored={mirrorReference} />
          <span className="record-reference-label text-mono-small">{speed}× · {role.label}</span>
        </div>

        {cameraLabel && <div className="record-camera"><img src={iconVideo} width={15} height={15} alt="" /><span>You · {cameraLabel}</span></div>}
        <div className={`record-framing ${frameCheck.ok ? 'is-ok' : 'is-warn'}`}>
          {frameCheck.ok && <img src={iconCheckSmall} width={16} height={16} alt="" />}
          <span>{pose.status === 'loading' ? 'Starting the camera…' : frameCheck.text}</span>
        </div>
        {moveHint && <div className="record-move-hint">{moveHint}</div>}

        {countdown !== null && <div className="record-big-count is-lead">{countdown}</div>}
      </div>

      <div className="record-controls">
        {busy
          ? <Button disabled={phase === 'finishing'} onClick={cancelTake} icon={<img src={iconStop} width={20} height={20} alt="" />}>Cancel take</Button>
          : <Button disabled={!!cameraError || pose.status !== 'ready'} onClick={startTake} icon={<img src={iconRecord} width={18} height={18} alt="" />}>Start take</Button>}
        <p className="text-caption text-muted">
          Stand where you start this phrase, then press start. The grey figures are the other dancers, fitted so everyone stays in your camera{fitScale !== null && fitScale < 0.98 ? ` (spacing shown at ${Math.round(fitScale * 100)}%)` : ''}; the green spot is yours. Your take is recorded with the overlays so you can replay it.
        </p>
      </div>

      <details className="record-adjust">
        <summary>Take settings</summary>
        <div className="record-adjust-row">
          <span>Speed</span>
          <SegmentedControl size="small" label="Take speed" value={speed} onChange={(value) => { if (!busy) setSpeed(value) }} options={speeds.map((value) => ({ value, label: `${value}×`, disabled: busy }))} />
        </div>
        <label className="record-adjust-row"><span>Mirror the reference (moves like your reflection)</span><input type="checkbox" checked={mirrorReference} onChange={(event) => setMirrorReference(event.target.checked)} /></label>
        <label className="record-adjust-row"><span>Other dancers and your floor spot</span><input type="checkbox" checked={showOthers} onChange={(event) => setShowOthers(event.target.checked)} /></label>
        <label className="record-adjust-row"><span>Target ghost on your body</span><input type="checkbox" checked={showGhost} onChange={(event) => setShowGhost(event.target.checked)} /></label>
      </details>
    </section>
  </div>
}
