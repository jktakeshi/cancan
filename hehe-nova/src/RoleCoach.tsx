import { useEffect, useMemo, useRef, useState } from 'react'
import type { Phrase, PoseLandmark, RoleTarget } from './domain'
import { cameraFor, floorConfig, floorPosition, learnerView, mappingFor, moveInstruction, reviewPositions, toLearnerFloor, trackFloorAt, type Camera, type CountPosition, type FloorPoint, type LearnerView } from './floor'
import { FloorRadar } from './FloorGuide'
import { drawFloorGuide, drawFormationHologram, rolePath, type Dancer } from './floorDrawing'
import { formationPositionsAt, type Formation } from './formations'
import { FormationDiagram } from './FormationsPanel'
import { fitPoseToBox, retargetPose, reviewTake, teachPhrase, type TakeReview } from './movement'
import { poseAt, type ReferenceTrack } from './referenceTracking'
import { drawSkeleton, prepareCanvas, videoContentRect } from './skeleton'
import { usePoseInput } from './usePoseInput'
import './RoleCoach.css'

type VideoRef = React.RefObject<HTMLVideoElement | null>
type Props = {
  phrase: Phrase
  role: RoleTarget
  track: ReferenceTrack | undefined
  /** Every tracked dancer with their role, for formation views. */
  dancers: Dancer[]
  referenceRef: VideoRef
  analysisDone: boolean
  /** When set, practice shows the formation hologram instead of the choreography overlays. */
  formationGuide: { formations: Formation[]; dancerId: string } | null
  /** Reference camera model (calibrated to the floor when possible). */
  referenceCamera: Camera
}
type TakePhase = 'idle' | 'countdown' | 'recording' | 'review'

const LEARNER_COLOR = '#ffffff'
const SPEEDS = [0.5, 0.75, 1]
const FLOOR_SCALES = [1, 0.75, 0.5]
/** Counts of music played before count 1 when a take starts (the "5, 6, 7, 8"). */
const LEAD_IN_COUNTS = 4

/** Reference playback time, refreshed every animation frame while it changes. */
function useVideoTime(videoRef: VideoRef) {
  const [time, setTime] = useState(0)
  const [size, setSize] = useState({ width: 1280, height: 720 })
  useEffect(() => {
    let frame = 0
    let last = -1
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const video = videoRef.current
      if (!video) return
      if (Math.abs(video.currentTime - last) > 0.03) {
        last = video.currentTime
        setTime(video.currentTime)
      }
      if (video.videoWidth && video.videoHeight) setSize((current) => (current.width === video.videoWidth && current.height === video.videoHeight ? current : { width: video.videoWidth, height: video.videoHeight }))
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [videoRef])
  return { time, aspect: size.width / size.height, size }
}

/** The selected dancer alone, centered and enlarged, following reference playback. */
function SoloFigure({ track, videoRef, aspect, color, mirrored }: { track: ReferenceTrack | undefined; videoRef: VideoRef; aspect: number; color: string; mirrored: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas) return
      const ctx = prepareCanvas(canvas)
      if (!ctx || !video || !track) return
      const pose = poseAt(track, video.currentTime)
      const fitted = pose && fitPoseToBox(pose, aspect, canvas.clientWidth / Math.max(1, canvas.clientHeight))
      if (fitted) drawSkeleton(ctx, fitted, { left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight }, { color, emphasis: true, mirrored, minVisibility: 0.2 })
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [track, videoRef, aspect, color, mirrored])
  return <canvas ref={canvasRef} className="solo-figure" />
}

/** Target (role color) and learner (white) overlaid at one count, both normalized to the same body size. */
function CompareFigure({ reference, referenceAspect, learner, learnerAspect, color, mirrored }: { reference: PoseLandmark[] | null; referenceAspect: number; learner: PoseLandmark[] | null; learnerAspect: number; color: string; mirrored: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas)
    if (!ctx) return
    const box = { left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight }
    const boxAspect = box.width / Math.max(1, box.height)
    const target = reference && fitPoseToBox(reference, referenceAspect, boxAspect)
    const actual = learner && fitPoseToBox(learner, learnerAspect, boxAspect)
    if (target) drawSkeleton(ctx, target, box, { color, emphasis: true, mirrored, minVisibility: 0.2, alpha: 0.85 })
    if (actual) drawSkeleton(ctx, actual, box, { color: LEARNER_COLOR, emphasis: false, mirrored, minVisibility: 0.4, alpha: 0.95 })
  }, [reference, referenceAspect, learner, learnerAspect, color, mirrored])
  return <canvas ref={canvasRef} className="compare-figure" />
}

function visibilityMessage(landmarks: PoseLandmark[] | undefined) {
  if (!landmarks?.length) return { ok: false, text: "I can't see you — step into the frame" }
  const seen = (index: number) => (landmarks[index]?.visibility ?? 0) >= 0.5
  if (![11, 12, 23, 24].every(seen)) return { ok: false, text: 'Face the camera so your shoulders and hips are visible' }
  if (!seen(27) || !seen(28)) return { ok: false, text: 'Step back so your feet are in view' }
  return { ok: true, text: 'Full body visible' }
}

const scoreClass = (score: number | null) => (score === null ? 'none' : score >= 80 ? 'good' : score >= 60 ? 'ok' : 'bad')

export function RoleCoach({ phrase, role, track, dancers, referenceRef, analysisDone, formationGuide, referenceCamera }: Props) {
  const { time, aspect } = useVideoTime(referenceRef)
  const self: Dancer | null = track ? { track, role } : null
  const others = useMemo(() => dancers.filter((dancer) => dancer.track !== track), [dancers, track])
  const lessons = useMemo(() => teachPhrase(track, phrase, aspect), [track, phrase, aspect])
  const [mirrored, setMirrored] = useState(true)
  const [speed, setSpeed] = useState(0.75)
  const [looping, setLooping] = useState(false)
  const activeCount = time >= phrase.startSec && time < phrase.endSec + 0.05 ? lessons.findLast((lesson) => time >= lesson.timeSec)?.count : undefined

  // ---- reference playback ------------------------------------------------------------------
  const playModeRef = useRef<'none' | 'phrase' | 'count'>('none')
  const playEndRef = useRef(0)
  const playStartRef = useRef(0)
  const loopingRef = useRef(looping)
  useEffect(() => { loopingRef.current = looping }, [looping])

  const playRange = (startSec: number, endSec: number, mode: 'phrase' | 'count') => {
    const video = referenceRef.current
    if (!video) return
    playModeRef.current = mode
    playStartRef.current = startSec
    playEndRef.current = endSec
    video.currentTime = startSec
    video.playbackRate = speed
    void video.play()
  }

  // ---- webcam practice -----------------------------------------------------------------------
  const pose = usePoseInput()
  const webcamRef = useRef<HTMLVideoElement>(null)
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [showGhost, setShowGhost] = useState(true)
  const [takePhase, setTakePhase] = useState<TakePhase>('idle')
  const takePhaseRef = useRef<TakePhase>('idle')
  const [countdown, setCountdown] = useState<number | null>(null)
  const timersRef = useRef<number[]>([])
  const [review, setReview] = useState<TakeReview | null>(null)
  const [learnerAspect, setLearnerAspect] = useState(4 / 3)
  const [selectedCount, setSelectedCount] = useState<number | null>(null)
  const setPhase = (phase: TakePhase) => { takePhaseRef.current = phase; setTakePhase(phase) }

  // ---- floor guidance --------------------------------------------------------------------------
  const [showFloor, setShowFloor] = useState(true)
  const [floorScale, setFloorScale] = useState(1)
  /** The learner's start spot and the webcam geometry solved there. */
  const [anchor, setAnchor] = useState<{ spot: FloorPoint; view: LearnerView } | null>(null)
  const [positions, setPositions] = useState<CountPosition[]>([])
  const mapping = useMemo(() => (anchor && track ? mappingFor(track, phrase, referenceCamera, anchor.spot, floorScale) : null), [anchor, track, phrase, referenceCamera, floorScale])
  const path = useMemo(() => (track ? rolePath(track, phrase, referenceCamera) : []), [track, phrase, referenceCamera])

  // Formation mode: the learner's start spot is their own dancer's spot at the phrase start.
  const formationRoom = useMemo(() => {
    if (!formationGuide || !anchor) return null
    const start = formationPositionsAt(phrase.startSec, formationGuide.formations)?.positions[formationGuide.dancerId]
    return start ? { anchor: anchor.spot, origin: start, scale: floorScale } : null
  }, [formationGuide, anchor, phrase.startSec, floorScale])
  /** Formation spots in the learner's room at a reference time. */
  const formationTargets = (timeSec: number) => {
    if (!formationGuide || !formationRoom) return null
    const { formations, dancerId } = formationGuide
    const state = formationPositionsAt(timeSec, formations)
    const mine = state?.positions[dancerId]
    if (!state || !mine) return null
    const countSec = phrase.counts[1].timeSec - phrase.counts[0].timeSec
    // Show the next spot during a transition, or up to two counts before a change begins.
    const upcoming = state.from !== state.to ? state.next : state.next && state.next.startSec - timeSec <= countSec * 2 + 0.1 ? state.next : null
    const nextMine = upcoming ? upcoming.positions[dancerId] : null
    return {
      target: toLearnerFloor(mine, formationRoom),
      next: nextMine ? toLearnerFloor(nextMine, formationRoom) : null,
      others: Object.entries(state.positions).filter(([id]) => id !== dancerId).map(([id, point]) => {
        const owner = dancers.find((dancer) => dancer.track.id === id)
        return { label: owner?.role.label.replace(/^Dancer /, '') ?? id, spot: toLearnerFloor(point, formationRoom), pose: owner ? poseAt(owner.track, timeSec) : null }
      }),
    }
  }
  const learnerCamera = () => {
    const webcam = webcamRef.current
    return cameraFor(webcam?.videoWidth || 1280, webcam?.videoHeight || 720, floorConfig.learnerHfovDeg)
  }
  /** Use where the learner stands now as the role's start spot. */
  const markStartSpot = () => {
    const landmarks = pose.latest?.landmarks
    if (!landmarks?.length) return null
    const camera = learnerCamera()
    const spot = floorPosition(landmarks, camera, 0.5)
    const view = learnerView(landmarks, camera)
    if (!spot || !view) return null
    const next = { spot, view }
    setAnchor(next)
    return next
  }

  const stopCamera = () => {
    pose.stop()
    streamRef.current?.getTracks().forEach((item) => item.stop())
    streamRef.current = null
    setCameraOn(false)
  }

  const startCamera = async () => {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      streamRef.current = stream
      setCameraOn(true)
      const video = webcamRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      // Every learner sample is stamped with the reference video's clock, which is what makes
      // review a direct comparison at equal choreography time — even in slow motion.
      void pose.start(video, () => (referenceRef.current?.currentTime ?? 0) * 1000)
    } catch (caught) {
      setCameraError(caught instanceof Error && caught.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the address bar and try again.' : 'Could not start the camera.')
      stopCamera()
    }
  }

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout)
    streamRef.current?.getTracks().forEach((item) => item.stop())
  }, [])

  const finishTake = () => {
    referenceRef.current?.pause()
    playModeRef.current = 'none'
    const webcam = webcamRef.current
    const nextAspect = webcam?.videoWidth && webcam.videoHeight ? webcam.videoWidth / webcam.videoHeight : learnerAspect
    setLearnerAspect(nextAspect)
    const samples = [...pose.samplesRef.current]
    if (track) setReview(reviewTake(samples, track, phrase, aspect, nextAspect))
    const targetAt = formationGuide
      ? (timeSec: number) => formationTargets(timeSec)?.target ?? null
      : (timeSec: number) => { const reference = track && mapping ? trackFloorAt(track, timeSec, referenceCamera) : null; return reference && mapping ? toLearnerFloor(reference, mapping) : null }
    setPositions(reviewPositions(samples, phrase, learnerCamera(), targetAt))
    setSelectedCount(null)
    setPhase('review')
  }

  const startTake = () => {
    const video = referenceRef.current
    if (!video || !track) return
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setReview(null)
    setPhase('countdown')
    video.pause()
    const countSec = phrase.counts[1].timeSec - phrase.counts[0].timeSec
    // Start on the count-in so the music leads into count one ("5, 6, 7, 8").
    const leadSec = Math.min(phrase.startSec, countSec * LEAD_IN_COUNTS)
    // The learner's spot at the start of a take is where the role starts.
    markStartSpot()
    video.currentTime = phrase.startSec - leadSec
    ;[3, 2, 1].forEach((value, index) => timersRef.current.push(window.setTimeout(() => setCountdown(value), index * 700)))
    timersRef.current.push(window.setTimeout(() => {
      setCountdown(null)
      pose.trimSamples()
      playModeRef.current = 'none'
      video.playbackRate = speed
      void video.play()
      setPhase('recording')
    }, 2100))
  }

  const cancelTake = () => {
    timersRef.current.forEach(clearTimeout)
    setCountdown(null)
    referenceRef.current?.pause()
    setPhase('idle')
  }

  // One loop watches the reference clock for phrase/count looping and for the end of a take.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const video = referenceRef.current
      if (!video) return
      if (takePhaseRef.current === 'recording') {
        if (video.currentTime >= phrase.endSec + 0.15 || video.ended) finishTake()
        return
      }
      if (playModeRef.current !== 'none' && video.currentTime >= playEndRef.current) {
        if (loopingRef.current) video.currentTime = playStartRef.current
        else { video.pause(); playModeRef.current = 'none' }
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })

  // Live view: the learner in white, the target dancer's pose fitted onto the learner in role color.
  useEffect(() => {
    const canvas = webcamCanvasRef.current
    const webcam = webcamRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas)
    if (!ctx || !webcam || !pose.latest?.landmarks.length) return
    // Keep idle sample history short; only a take needs the full stream.
    if (takePhaseRef.current !== 'recording' && pose.samplesRef.current.length > 300) pose.trimSamples(30)
    const rect = videoContentRect(webcam)
    const webcamAspect = webcam.videoWidth / Math.max(1, webcam.videoHeight)
    const now = referenceRef.current?.currentTime ?? 0
    const learnerHere = anchor ? floorPosition(pose.latest.landmarks, anchor.view.camera, 0.5) : null
    if (formationGuide) {
      // Formations are learned on their own: no choreography path and no body ghost.
      const targets = anchor && formationTargets(now)
      if (targets) drawFormationHologram(ctx, { rect, view: anchor.view, referenceCamera, mirrored: true, ...targets, learnerSpot: learnerHere, pulse: (performance.now() / 1200) % 1 })
      drawSkeleton(ctx, pose.latest.landmarks, rect, { color: LEARNER_COLOR, emphasis: false, mirrored: true, minVisibility: 0.5, alpha: 0.95 })
      return
    }
    if (showFloor && anchor && mapping && track) {
      drawFloorGuide(ctx, { rect, view: anchor.view, mapping, referenceCamera, phrase, time: now, self: { track, role }, path, others, learnerSpot: floorPosition(pose.latest.landmarks, anchor.view.camera, 0.5), mirrored: true })
    }
    const reference = track && referenceRef.current ? poseAt(track, now) : null
    const ghost = showGhost && reference ? retargetPose(reference, aspect, pose.latest.landmarks, webcamAspect) : null
    if (ghost) drawSkeleton(ctx, ghost, rect, { color: role.color, emphasis: true, mirrored: true, minVisibility: 0.3, alpha: 0.6 })
    drawSkeleton(ctx, pose.latest.landmarks, rect, { color: LEARNER_COLOR, emphasis: false, mirrored: true, minVisibility: 0.5, alpha: 0.95 })
  })

  const visibility = visibilityMessage(pose.latest?.landmarks)
  const learnerSpot = anchor && pose.latest?.landmarks.length ? floorPosition(pose.latest.landmarks, anchor.view.camera, 0.5) : null
  const targetNow = track && mapping ? trackFloorAt(track, time, referenceCamera) : null
  const formationNow = formationGuide ? formationTargets(time) : null
  const moveHint = formationGuide
    ? (learnerSpot && formationNow ? moveInstruction(learnerSpot, formationNow.target) ?? '✓ You are on your formation spot' : null)
    : learnerSpot && targetNow && mapping ? moveInstruction(learnerSpot, toLearnerFloor(targetNow, mapping)) : null
  const learnerOnStage = formationRoom && learnerSpot ? { x: formationRoom.origin.x + (learnerSpot.x - formationRoom.anchor.x) / formationRoom.scale, z: formationRoom.origin.z + (learnerSpot.z - formationRoom.anchor.z) / formationRoom.scale } : null
  const countInLabel = takePhase === 'recording' && time < phrase.startSec - 0.02
    ? 9 - Math.min(LEAD_IN_COUNTS, Math.ceil((phrase.startSec - time) / (phrase.counts[1].timeSec - phrase.counts[0].timeSec) - 0.01))
    : null
  const reviewCount = review?.counts.find((item) => item.count === selectedCount) ?? null

  if (!analysisDone || !track) {
    return <section className="card coach"><small>LEARN &amp; PRACTICE · {role.label.toUpperCase()}</small><p className="muted">{analysisDone ? `${role.label} was not found in the reference video. Use “Wrong dancer? Pick ${role.label}” to choose the dancer.` : 'Waiting for dancer detection to finish…'}</p></section>
  }

  return <section className="card coach">
    <header><div><small>LEARN · {phrase.label.toUpperCase()}</small><h2 style={{ color: role.color }}>{role.label}: what to do</h2></div></header>
    <div className="coach-learn">
      <div className="solo">
        <SoloFigure track={track} videoRef={referenceRef} aspect={aspect} color={role.color} mirrored={mirrored} />
        <span className="solo-count">{activeCount ?? '–'}</span>
        <div className="coach-buttons">
          <button className="strong" onClick={() => playRange(phrase.startSec, phrase.endSec, 'phrase')}>▶ Play phrase</button>
          <button onClick={() => referenceRef.current?.pause()}>Pause</button>
          {SPEEDS.map((value) => <button key={value} className={speed === value ? 'on' : ''} onClick={() => { setSpeed(value); if (referenceRef.current) referenceRef.current.playbackRate = value }}>{value}×</button>)}
          <button className={looping ? 'on' : ''} onClick={() => setLooping((value) => !value)}>Loop</button>
          <button className={mirrored ? 'on' : ''} onClick={() => setMirrored((value) => !value)} title="Mirror the figure so it moves like your reflection">Mirror</button>
        </div>
      </div>
      <ol className="lessons">
        {lessons.map((lesson) => <li key={lesson.count} className={`${activeCount === lesson.count ? 'active' : ''} ${lesson.visible ? '' : 'hidden-dancer'}`}>
          <button onClick={() => playRange(lesson.timeSec, lesson.endSec, 'count')} title="Play this count">
            <b>{lesson.count}</b>
            <span>{lesson.cues.join(' · ')}</span>
          </button>
        </li>)}
        <li className="lesson-note">Cues are measured automatically from the dancer’s pose; “left/right” mean your own left/right while facing the camera. The dashed line on the video is the dancer’s foot path.</li>
        {self && <li className="radar-box"><FloorRadar videoRef={referenceRef} phrase={phrase} self={self} others={others} referenceCamera={referenceCamera} mapping={null} learnerSpot={null} /><span>Formation from above (mirrored like your webcam). Big dot is {role.label}; the dashed line is its path over this phrase.</span></li>}
      </ol>
    </div>

    <header className="practice-header"><div><small>PRACTICE WITH WEBCAM</small><h2>Dance it, then get feedback</h2></div>
      {cameraOn ? <button onClick={stopCamera}>Turn camera off</button> : <button className="strong" onClick={() => void startCamera()}>Turn on webcam</button>}
    </header>
    {cameraError && <p className="error">{cameraError}</p>}
    <div className="coach-practice">
      <div className="webcam-stage">
        <video ref={webcamRef} className="mirrored" muted playsInline onLoadedMetadata={(event) => setLearnerAspect(event.currentTarget.videoWidth / Math.max(1, event.currentTarget.videoHeight))} />
        <canvas ref={webcamCanvasRef} className="pose-overlay" />
        {!cameraOn && <div className="webcam-empty">Camera is off</div>}
        {cameraOn && <div className={`visibility ${visibility.ok ? 'ok' : 'warn'}`}>{pose.status === 'loading' ? 'Loading pose model…' : visibility.text}</div>}
        {countdown !== null && <div className="big-count">{countdown}</div>}
        {takePhase === 'recording' && (countInLabel ?? activeCount) && <div className={`big-count live ${countInLabel ? 'count-in' : ''}`}>{countInLabel ?? activeCount}</div>}
        {cameraOn && (showFloor || formationGuide) && moveHint && <div className={`move-hint ${formationGuide ? 'formation' : ''}`}>{moveHint}</div>}
        {formationGuide && <div className="mode-badge">FORMATION MODE · dancer {formationGuide.dancerId ?? '?'}</div>}
      </div>
      <div className="take-panel">
        {formationGuide && <div className="formation-practice"><FormationDiagram videoRef={referenceRef} formations={formationGuide.formations} roles={dancers.map((dancer) => dancer.role)} dancerId={formationGuide.dancerId} learner={learnerOnStage} /><span>{anchor ? 'Green is your spot, grey are the others, white ring is you (seen from above, front at the bottom).' : 'Stand on your starting spot for this phrase and press “Set start spot”.'}</span></div>}
        {!formationGuide && self && <div className="radar-box"><FloorRadar videoRef={referenceRef} phrase={phrase} self={self} others={others} referenceCamera={referenceCamera} mapping={mapping} learnerSpot={learnerSpot} /><span>{anchor ? 'Your room from above: white ring is you, the big dot is where you should be now.' : 'Stand on your start spot and press “Set start spot” to place the formation in your room.'}</span></div>}
        <div className="coach-buttons">
          <button className="strong" disabled={!cameraOn || !visibility.ok} onClick={() => markStartSpot()}>{anchor ? 'Reset start spot' : 'Set start spot'}</button>
          {!formationGuide && <button className={showFloor ? 'on' : ''} onClick={() => setShowFloor((value) => !value)}>Floor marks</button>}
          {FLOOR_SCALES.map((value) => <button key={value} className={floorScale === value ? 'on' : ''} title="Shrink the stage to fit your room" onClick={() => setFloorScale(value)}>{value === 1 ? 'Full stage' : `${value * 100}% stage`}</button>)}
        </div>
        <p className="muted">Stand where the camera sees your whole body, facing the screen. You’ll get a 3-2-1, then the music plays from just before count 1 at {speed}× speed. Follow the {role.label} figure; the {showGhost ? 'colored ghost on your body shows where your limbs should be' : 'ghost is hidden'}.</p>
        <div className="coach-buttons">
          {takePhase === 'countdown' || takePhase === 'recording'
            ? <button className="strong" onClick={cancelTake}>Stop</button>
            : <button className="strong" disabled={!cameraOn} onClick={startTake}>{review ? '↻ Try again' : '● Start take'}</button>}
          <button className={showGhost ? 'on' : ''} onClick={() => setShowGhost((value) => !value)}>Ghost</button>
          {SPEEDS.map((value) => <button key={value} className={speed === value ? 'on' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}
        </div>
        {takePhase === 'recording' && <p className="recording">● Recording — dance along</p>}
        {review && takePhase === 'review' && <div className="review">
          <div className="review-head"><strong className={`score ${scoreClass(review.score)}`}>{review.score ?? '–'}</strong><p>{review.headline}</p></div>
          {review.timing && <p className="review-line">⏱ {review.timing}</p>}
          {review.travel && <p className="review-line">↔ {review.travel}</p>}
          {(() => { const placed = positions.filter((entry) => entry.errorM !== null); if (!placed.length) return null; const onSpot = placed.filter((entry) => !entry.instruction).length; const worst = placed.reduce((a, b) => (b.errorM! > a.errorM! ? b : a)); return <p className="review-line">📍 On your floor spot for {onSpot}/{placed.length} counts{worst.instruction ? ` · biggest miss on count ${worst.count}: ${worst.instruction.charAt(0).toLowerCase()}${worst.instruction.slice(1)}` : ''}</p> })()}
          <ol className="count-scores">
            {review.counts.map((item) => <li key={item.count}><button className={selectedCount === item.count ? 'on' : ''} onClick={() => { setSelectedCount(item.count); if (referenceRef.current) { referenceRef.current.pause(); referenceRef.current.currentTime = item.timeSec + 0.08 } }}>
              <b>{item.count}</b>
              <i className={scoreClass(item.score)} style={{ width: `${item.score ?? 0}%` }} />
              <span>{item.correction}{(() => { const place = positions.find((entry) => entry.count === item.count); return place?.errorM == null ? null : <em className={place.instruction ? 'off-spot' : 'on-spot'}>{place.instruction ? ` · 📍 ${place.instruction}` : ' · 📍 on your spot'}</em> })()}</span>
            </button></li>)}
          </ol>
          {reviewCount && <div className="compare">
            <CompareFigure reference={poseAt(track, reviewCount.snapshot?.referenceTimeSec ?? reviewCount.timeSec + 0.08)} referenceAspect={aspect} learner={reviewCount.snapshot?.learner ?? null} learnerAspect={learnerAspect} color={role.color} mirrored={mirrored} />
            <p><b style={{ color: role.color }}>Target</b> vs <b>you</b> on count {reviewCount.count}. {reviewCount.correction}.</p>
            <button onClick={() => playRange(reviewCount.timeSec, reviewCount.endSec, 'count')}>▶ Watch this count</button>
          </div>}
        </div>}
      </div>
    </div>
  </section>
}
