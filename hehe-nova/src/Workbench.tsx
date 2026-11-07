import { useEffect, useMemo, useRef, useState } from 'react'
import './Workbench.css'
import { demoFixtures, demoManifest } from './demoData'
import type { AttemptResult, Calibration, DimensionResult, FloorPoint, Phrase, RoleTarget } from './domain'
import { correctionFor, extractStableLanding, scoreFormation, scorePosture } from './evaluation'
import { calibrationErrors } from './geometry'
import { validateManifest } from './manifestValidation'
import { phraseTrail } from './movement'
import { ReferenceOverlay, SampleOverlay } from './PoseOverlay'
import { RoleCoach } from './RoleCoach'
import { nearestTrackFrame } from './referenceTracking'
import { videoContentRect, type ContentRect } from './skeleton'
import { usePoseInput } from './usePoseInput'
import type { GridOverrides } from './beatTracking'
import { useCountGrid } from './useCountGrid'
import { cameraFor, fitGroundModel, floorConfig, groundObservations, trackFloorAt } from './floor'
import { formationsFromSnapshots } from './formations'
import { FormationsPanel } from './FormationsPanel'
import { makeRoles } from './roles'
import { useReferenceAnalysis } from './useReferenceAnalysis'

const DEFAULT_DANCER_COUNT = 12

const dimension = (status: DimensionResult['status'], reason: string): DimensionResult => ({ status, reason })

function getCount(phrase: Phrase, time: number) {
  let count = 1
  for (const mark of phrase.counts) if (time >= mark.timeSec) count = mark.count
  return count
}

function FormationMap({ phrase, role, landing }: { phrase: Phrase; role: RoleTarget; landing?: FloorPoint }) {
  const { widthM, depthM } = demoManifest.referenceCalibration
  const x = (value: number) => 8 + value / widthM * 84
  const y = (value: number) => 92 - value / depthM * 84
  return <section className="card"><header><div><small>Formation</small><h3>{phrase.label}</h3></div><i style={{ background: role.color }} /></header><svg viewBox="0 0 100 100" className="floor-map"><rect x="8" y="8" width="84" height="84" rx="3" /><path d={role.pathFloor.map((point, index) => `${index ? 'L' : 'M'} ${x(point.x)} ${y(point.y)}`).join(' ')} style={{ stroke: role.color }} /><circle cx={x(role.startFloor.x)} cy={y(role.startFloor.y)} r="3" style={{ fill: role.color }} /><circle className="target" cx={x(role.finishFloor.x)} cy={y(role.finishFloor.y)} r="6" style={{ stroke: role.color }} />{landing && <circle className="landing" cx={x(landing.x)} cy={y(landing.y)} r="3" />}</svg><p className="muted">Start dot → count-eight target. Captured landing appears in white.</p></section>
}

function Result({ label, value }: { label: string; value: DimensionResult }) {
  return <div className={`result ${value.status}`}><span>{label}</span><strong>{value.status}</strong><small>{value.reason}</small></div>
}

/** The original single-page prototype. It stays reachable while the new screens replace it one at a time. */
type WorkbenchProps = {
  initialReferenceUrl: string
  onHome: () => void
  initialRoleId?: string
  initialDancerCount?: number
  initialPhraseId?: string
  initialGridOverrides?: GridOverrides
  /** Tracks already found by the learning screens. When given, the Workbench reuses them instead of analyzing again. */
  sharedAnalysis?: ReturnType<typeof useReferenceAnalysis>
}

export function Workbench({ initialReferenceUrl, onHome, initialRoleId, initialDancerCount, initialPhraseId, initialGridOverrides, sharedAnalysis }: WorkbenchProps) {
  const errors = useMemo(() => validateManifest(demoManifest), [])
  const ownAnalysis = useReferenceAnalysis()
  const referenceAnalysis = sharedAnalysis ?? ownAnalysis
  // Roles come from the dancer count; phrase timing comes from beat detection.
  const [dancerCount, setDancerCount] = useState(initialDancerCount ?? DEFAULT_DANCER_COUNT)
  const roles = useMemo(() => makeRoles(dancerCount), [dancerCount])
  const [referenceUrl, setReferenceUrl] = useState(initialReferenceUrl)
  const [referenceMeta, setReferenceMeta] = useState({ duration: 0, aspect: 16 / 9, width: 1280, height: 720 })
  const [gridOverrides, setGridOverrides] = useState<GridOverrides>(initialGridOverrides ?? {})
  const countGrid = useCountGrid(referenceUrl, referenceAnalysis.tracks, referenceAnalysis.status === 'done', referenceMeta.duration, referenceMeta.aspect, roles, gridOverrides)
  // Until the count grid is detected, the manifest's placeholder phrases stand in.
  const phrases = useMemo(() => (countGrid.phrases?.length ? countGrid.phrases : demoManifest.phrases.map((item) => ({ ...item, roles }))), [countGrid.phrases, roles])
  const [phraseId, setPhraseId] = useState(initialPhraseId ?? demoManifest.phrases[0].id)
  const phrase = phrases.find((item) => item.id === phraseId) ?? phrases[0]
  const [roleId, setRoleId] = useState(initialRoleId ?? phrase.roles[0].id)
  const role = phrase.roles.find((item) => item.id === roleId) ?? phrase.roles[0]
  const [chunkIndex, setChunkIndex] = useState(0)
  const chunk = phrase.teachingChunks[chunkIndex] ?? phrase.teachingChunks[0]
  const [learnerUrl, setLearnerUrl] = useState('')
  const [loopChunk, setLoopChunk] = useState(false)
  const [source, setSource] = useState<'fixture' | 'webcam'>('fixture')
  const [fixtureId, setFixtureId] = useState(demoFixtures[0].id)
  const fixture = demoFixtures.find((item) => item.id === fixtureId) ?? demoFixtures[0]
  const [referenceTime, setReferenceTime] = useState(phrase.startSec)
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [landing, setLanding] = useState<FloorPoint>()
  const [judgedRoleId, setJudgedRoleId] = useState(role.id)
  const [liveCount, setLiveCount] = useState<number>()
  const [calibration, setCalibration] = useState<Calibration>(fixture.calibration)
  const [calibrationPoints, setCalibrationPoints] = useState<Calibration['corners'][number][]>([])
  const [calibrating, setCalibrating] = useState(false)
  const [floorWidth, setFloorWidth] = useState(String(fixture.calibration.widthM))
  const [floorDepth, setFloorDepth] = useState(String(fixture.calibration.depthM))
  const referenceRef = useRef<HTMLVideoElement>(null)
  const learnerRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const attemptStartRef = useRef(0)
  const timersRef = useRef<number[]>([])
  const pose = usePoseInput()
  const referenceTrack = referenceAnalysis.tracks.find((track) => track.id === role.id)
  const [pickingDancer, setPickingDancer] = useState(false)
  const referenceCamera = useMemo(() => cameraFor(referenceMeta.width, referenceMeta.height, floorConfig.referenceHfovDeg), [referenceMeta.width, referenceMeta.height])
  // Formations are checked on every count of the whole clip (count-in and intro included).
  const formationTimes = useMemo(() => {
    const grid = countGrid.grid
    const duration = referenceMeta.duration
    if (!grid || !(duration > 0) || !grid.counts.length) return []
    const times: number[] = []
    for (let time = grid.counts[0] - Math.floor(grid.counts[0] / grid.countSec) * grid.countSec; time <= duration; time += grid.countSec) times.push(time)
    return times
  }, [countGrid.grid, referenceMeta.duration])
  // A static camera can be calibrated from the dancers themselves (see GroundModel).
  const calibratedCamera = useMemo(() => {
    if (referenceAnalysis.status !== 'done') return referenceCamera
    const ground = fitGroundModel(groundObservations(referenceAnalysis.tracks, referenceCamera))
    return ground ? { ...referenceCamera, ground } : referenceCamera
  }, [referenceAnalysis.status, referenceAnalysis.tracks, referenceCamera])
  const formations = useMemo(() => {
    if (referenceAnalysis.status !== 'done' || !formationTimes.length) return null
    const snapshots = formationTimes.map((timeSec) => ({
      timeSec,
      positions: Object.fromEntries(referenceAnalysis.tracks.map((track) => [track.id, trackFloorAt(track, timeSec, calibratedCamera)]).filter(([, point]) => point !== null)),
    }))
    return formationsFromSnapshots(snapshots)
  }, [referenceAnalysis.status, referenceAnalysis.tracks, formationTimes, calibratedCamera])
  const [formationMode, setFormationMode] = useState(false)
  /** Where a video time sits in the choreography, in dancer language. */
  const describeTime = (time: number) => {
    const grid = countGrid.grid
    const owner = phrases.find((item) => time >= item.startSec - 0.05 && time < item.endSec - 0.05)
    if (owner) return `${owner.label.replace(' (clip ends early)', '')}, count ${getCount(owner, time + 0.05)}`
    if (grid && time < (grid.counts[0] ?? 0) - 0.05) {
      const index = grid.countIn.findLastIndex((mark) => time >= mark - 0.05)
      return index < 0 ? 'intro' : `count-in ${9 - grid.countIn.length + index}`
    }
    return 'after the last eight-count'
  }
  const dancers = useMemo(() => referenceAnalysis.tracks.flatMap((track) => { const owner = phrase.roles.find((item) => item.id === track.id); return owner ? [{ track, role: owner }] : [] }), [referenceAnalysis.tracks, phrase.roles])
  const trail = useMemo(() => referenceAnalysis.status === 'done' ? { color: role.color, startSec: phrase.startSec, endSec: phrase.endSec, ...phraseTrail(referenceTrack, phrase) } : undefined, [referenceAnalysis.status, referenceTrack, phrase, role.color])
  const [learnerContent, setLearnerContent] = useState<ContentRect>({ left: 0, top: 0, width: 0, height: 0 })
  const analyzedUrlRef = useRef('')

  useEffect(() => {
    // Calibration markers are positioned inside the letterboxed video content, which moves on resize.
    const measure = () => { if (learnerRef.current) setLearnerContent(videoContentRect(learnerRef.current)) }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    timersRef.current.forEach(clearTimeout)
  }, [])

  /** Count shown on the reference player: the count-in reads 5–8, the phrase reads 1–8. */
  const countLabel = (time: number): string => {
    const grid = countGrid.grid
    if (grid && time < (grid.counts[0] ?? Infinity) - 0.05) {
      const index = grid.countIn.findLastIndex((mark) => time >= mark - 0.05)
      return index < 0 ? '·' : String(9 - grid.countIn.length + index)
    }
    if (time < phrase.startSec - 0.05 || time > phrase.endSec) return '·'
    return String(getCount(phrase, time))
  }

  if (errors.length) return <main className="fatal legacy-app"><h1>Rehearsal data is invalid</h1><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></main>

  const loadLocalFile = (file: File | undefined, setter: (url: string) => void) => { if (file) setter(URL.createObjectURL(file)) }

  const choosePhrase = (nextPhrase: Phrase) => {
    setPhraseId(nextPhrase.id)
    setChunkIndex(0)
    setResult(null)
    setReferenceTime(nextPhrase.startSec)
    if (referenceRef.current) referenceRef.current.currentTime = nextPhrase.startSec
  }

  const chooseFixture = (nextId: string) => {
    const next = demoFixtures.find((item) => item.id === nextId) ?? demoFixtures[0]
    setFixtureId(next.id)
    setCalibration(next.calibration)
    setFloorWidth(String(next.calibration.widthM))
    setFloorDepth(String(next.calibration.depthM))
    setCalibrationPoints([])
  }

  const addCalibrationPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!calibrating || calibrationPoints.length >= 4) return
    const video = learnerRef.current
    if (!video) return
    // Clicks are measured against the rendered video content, ignoring letterbox bars.
    const bounds = video.getBoundingClientRect()
    const content = videoContentRect(video)
    setLearnerContent(content)
    const shownX = (event.clientX - bounds.left - content.left) / content.width
    // Stored coordinates stay unmirrored even when the webcam is shown as a mirror.
    const point = { x: source === 'webcam' ? 1 - shownX : shownX, y: (event.clientY - bounds.top - content.top) / content.height }
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return
    setCalibrationPoints((points) => [...points, point])
  }

  const saveCalibration = () => {
    if (calibrationPoints.length !== 4) return
    const candidate: Calibration = { corners: calibrationPoints as Calibration['corners'], widthM: Number(floorWidth), depthM: Number(floorDepth) }
    if (calibrationErrors(candidate).length) return
    setCalibration(candidate)
    setCalibrating(false)
  }

  const startCamera = async () => {
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 720 }, audio: false })
      streamRef.current = stream
      setSource('webcam')
      requestAnimationFrame(() => {
        if (!learnerRef.current) return
        learnerRef.current.srcObject = stream
        void learnerRef.current.play()
        void pose.start(learnerRef.current, () => performance.now() - attemptStartRef.current)
      })
    } catch {
      setResult({ visibility: dimension('inconclusive', 'Camera access failed.'), timing: dimension('inconclusive', 'No attempt.'), footwork: dimension('inconclusive', 'No attempt.'), formation: dimension('inconclusive', 'No attempt.'), posture: dimension('inconclusive', 'No attempt.'), primaryCorrection: 'Allow camera access and keep the full body visible.' })
    }
  }

  const finishAttempt = (countEightMs: number) => {
    pose.stop()
    learnerRef.current?.pause()
    const samples = [...pose.samplesRef.current]
    const capture = extractStableLanding(samples, countEightMs, calibration)
    const formation = capture.landing ? scoreFormation(capture.landing, role, phrase.roles, demoManifest.referenceCalibration, calibration) : capture.result
    const finalPose = samples.filter((sample) => sample.timeMs >= countEightMs).at(-1)?.landmarks
    const countEightSec = phrase.counts[7].timeSec
    const detectedReferencePose = nearestTrackFrame(referenceTrack, countEightSec)?.landmarks
    const posture = scorePosture(detectedReferencePose ?? role.poseTargets.find((target) => target.count === 8)?.landmarks, finalPose)
    const partial = {
      visibility: samples.some((sample) => sample.landmarks.length >= 31) ? dimension('pass', 'A full-body pose was detected.') : dimension('inconclusive', 'Keep the full body and feet visible.'),
      timing: capture.landing ? dimension('pass', 'The landing was captured in the count-eight window.') : dimension('inconclusive', 'Timing could not be judged without a stable count-eight landing.'),
      footwork: dimension('inconclusive', 'Footwork events require the final annotated footage.'),
      formation,
      posture,
    }
    setResult({ ...partial, primaryCorrection: correctionFor(partial), landing: capture.landing })
    setLanding(capture.landing)
    setLiveCount(undefined)
  }

  const beginAttempt = () => {
    timersRef.current.forEach(clearTimeout)
    pose.clear()
    setResult(null)
    setLanding(undefined)
    setJudgedRoleId(role.id)
    const beatMs = (phrase.counts[1].timeSec - phrase.counts[0].timeSec) * 1000
    const countEightMs = (phrase.counts[7].timeSec - phrase.startSec) * 1000
    ;[4, 3, 2, 1].forEach((value, index) => timersRef.current.push(window.setTimeout(() => setLiveCount(value), index * beatMs)))
    timersRef.current.push(window.setTimeout(() => {
      attemptStartRef.current = performance.now()
      if (source === 'fixture' && learnerRef.current) { learnerRef.current.currentTime = 0; void learnerRef.current.play(); void pose.start(learnerRef.current, () => learnerRef.current!.currentTime * 1000) }
      phrase.counts.forEach((mark) => timersRef.current.push(window.setTimeout(() => setLiveCount(mark.count), (mark.timeSec - phrase.startSec) * 1000)))
    }, beatMs * 4))
    timersRef.current.push(window.setTimeout(() => finishAttempt(countEightMs), beatMs * 4 + countEightMs + 800))
  }

  const rescore = (nextId: string) => {
    setJudgedRoleId(nextId)
    if (!result || !landing) return
    const nextRole = phrase.roles.find((item) => item.id === nextId) ?? role
    const formation = scoreFormation(landing, nextRole, phrase.roles, demoManifest.referenceCalibration, calibration)
    const partial = { ...result, formation }
    setResult({ ...partial, primaryCorrection: correctionFor(partial), landing })
  }

  return <main className="legacy-app"><nav><b>DC</b><strong>Dance Catch-up</strong><button className="home-link" onClick={onHome}>Back to home</button><span>functional prototype</span></nav><section className="hero"><div><small>ROLE-AWARE REHEARSAL</small><h1>Learn the dancer, not just the dance.</h1><p>Choose a phrase and role, review the path, then practice timing, formation, and final shape.</p></div><aside><strong>Placeholder data</strong><span>Load the team recordings when ready.</span></aside></section><div className="layout">
    <section className="card sidebar"><small>1 · CHOOSE A PHRASE</small>{countGrid.status !== 'done' && <span className="grid-status">{countGrid.status === 'error' ? `Beat detection failed: ${countGrid.error}` : countGrid.status === 'listening' ? 'Listening for the beat…' : 'Counts are placeholders until dancers are detected…'}</span>}{countGrid.grid && countGrid.bpm && <span className="grid-status">♪ {Math.round(countGrid.bpm)} BPM music · {countGrid.grid.beatsPerCount === 2 ? 'counted in half time' : countGrid.grid.beatsPerCount === 1 ? 'one count per beat' : 'double time'} ({countGrid.grid.countSec.toFixed(2)} s/count){countGrid.grid.countIn.length ? ` · count-in until ${countGrid.grid.counts[0].toFixed(1)} s` : ''}</span>}{countGrid.grid && <div className="grid-fix"><span>Counts wrong?</span><button title="Counts too fast: one count per two of the current counts" onClick={() => setGridOverrides((value) => ({ ...value, beatsPerCount: Math.min(2, countGrid.grid!.beatsPerCount * 2) }))}>Slower</button><button title="Counts too slow" onClick={() => setGridOverrides((value) => ({ ...value, beatsPerCount: Math.max(0.5, countGrid.grid!.beatsPerCount / 2) }))}>Faster</button><button title="Count 1 one count earlier" onClick={() => setGridOverrides((value) => ({ ...value, shiftCounts: (value.shiftCounts ?? 0) - 1 }))}>1 earlier</button><button title="Count 1 one count later" onClick={() => setGridOverrides((value) => ({ ...value, shiftCounts: (value.shiftCounts ?? 0) + 1 }))}>1 later</button></div>}{phrases.map((item) => <button className={item.id === phrase.id ? 'selected' : ''} onClick={() => choosePhrase(item)} key={item.id}><strong>{item.label}</strong><span>{item.startSec.toFixed(1)}–{item.endSec.toFixed(1)} s</span></button>)}<small>2 · DANCERS</small><label className="dancer-count">Dancers in the video <input type="number" min={1} max={24} value={dancerCount} onChange={(event) => { const next = Math.max(1, Math.min(24, Math.round(Number(event.target.value) || 1))); setDancerCount(next); if (referenceRef.current && referenceRef.current.readyState >= 1) void referenceAnalysis.analyze(referenceRef.current, makeRoles(next).map((item) => item.id)) }} /></label><small>CHOOSE YOUR DANCER</small>{phrase.roles.map((item) => <button className={item.id === role.id ? 'selected' : ''} onClick={() => setRoleId(item.id)} key={item.id}><i style={{ background: item.color }} />{item.label}</button>)}<small>TEACHING CHUNKS</small>{phrase.teachingChunks.map((item, index) => <button className={index === chunkIndex ? 'selected' : ''} onClick={() => setChunkIndex(index)} key={item.startCount}><strong>Counts {item.startCount}–{item.endCount}</strong><span>{item.instruction}</span></button>)}</section>
    <div className="content"><section className="card"><header><div><small>REFERENCE</small><h2>{phrase.label} · {role.label}</h2></div><em>{countLabel(referenceTime)}</em></header><div className="video-stage">{referenceUrl ? <video ref={referenceRef} src={referenceUrl} controls onLoadedMetadata={(event) => { const video = event.currentTarget; setReferenceMeta({ duration: video.duration, aspect: video.videoWidth / Math.max(1, video.videoHeight), width: video.videoWidth, height: video.videoHeight }) }} onLoadedData={(event) => { if (analyzedUrlRef.current === referenceUrl || (sharedAnalysis && referenceUrl === initialReferenceUrl && referenceAnalysis.status === 'done')) return; analyzedUrlRef.current = referenceUrl; void referenceAnalysis.analyze(event.currentTarget, phrase.roles.map((item) => item.id)) }} onTimeUpdate={(event) => { const video = event.currentTarget; const end = phrase.counts[chunk.endCount - 1].timeSec + .5; if (loopChunk && video.currentTime >= end) video.currentTime = phrase.counts[chunk.startCount - 1].timeSec; setReferenceTime(video.currentTime) }} /> : <div className="empty"><strong>Reference video pending</strong><span>The interface and evaluator are ready for the recorded asset.</span></div>}{referenceUrl && <ReferenceOverlay videoRef={referenceRef} tracks={referenceAnalysis.tracks} roles={phrase.roles} selectedRoleId={role.id} trail={trail} onPickDancer={pickingDancer ? (trackIndex) => { referenceAnalysis.assignRole(role.id, trackIndex, referenceRef.current?.currentTime ?? 0); setPickingDancer(false) } : undefined} />}{referenceUrl && referenceAnalysis.status !== 'done' && <div className={`analysis-status ${referenceAnalysis.status}`}>{referenceAnalysis.status === 'analyzing' ? `Finding dancers… ${referenceAnalysis.progress}%${referenceAnalysis.remainingSec !== null ? ` · ~${Math.ceil(referenceAnalysis.remainingSec / 60)} min left` : ''}${referenceAnalysis.delegate ? ` · ${referenceAnalysis.delegate}` : ''}${referenceAnalysis.delegate === 'CPU' ? ' (slow — enable hardware acceleration in Chrome)' : ''}` : referenceAnalysis.status === 'error' ? `Dancer detection failed: ${referenceAnalysis.error}` : 'Waiting for video…'}</div>}{pickingDancer && <div className="pick-hint">Click the dancer who is {role.label} at this moment — only this stretch changes</div>}</div><div className="controls"><label>Load reference<input type="file" accept="video/*" onChange={(event) => loadLocalFile(event.target.files?.[0], setReferenceUrl)} /></label><button disabled={referenceAnalysis.status === 'analyzing'} onClick={() => referenceRef.current && void referenceAnalysis.analyze(referenceRef.current, phrase.roles.map((item) => item.id), { force: true })}>{referenceAnalysis.status === 'analyzing' ? `Detecting dancers ${referenceAnalysis.progress}%` : referenceAnalysis.status === 'done' ? 'Re-detect dancers' : 'Auto-detect dancers'}</button>{referenceAnalysis.tracks.length > 0 && <button className={pickingDancer ? 'active' : ''} onClick={() => { referenceRef.current?.pause(); setPickingDancer((value) => !value) }}>{pickingDancer ? 'Cancel' : `Wrong dancer here? Pick ${role.label}`}</button>}<button onClick={() => { if (!referenceRef.current) return; setLoopChunk(true); referenceRef.current.currentTime = phrase.counts[chunk.startCount - 1].timeSec; void referenceRef.current.play() }}>Loop selected counts</button><button onClick={() => { setLoopChunk(false); referenceRef.current?.pause() }}>Stop loop</button></div>{referenceAnalysis.error && <p className="error">{referenceAnalysis.error}</p>}<div className="instruction"><span>Counts {chunk.startCount}–{chunk.endCount}</span><strong>{chunk.instruction}</strong></div></section>
    <FormationsPanel videoRef={referenceRef} formations={formations} roles={phrase.roles} dancerId={role.id} onSelectDancer={setRoleId} enabled={formationMode} onToggle={() => setFormationMode((value) => !value)} describeTime={describeTime} onSeek={(time) => { const video = referenceRef.current; if (video) { video.pause(); video.currentTime = time } }} />
    <RoleCoach referenceCamera={calibratedCamera} formationGuide={formations?.length && formationMode ? { formations, dancerId: role.id } : null} phrase={phrase} role={role} track={referenceTrack} dancers={dancers} referenceRef={referenceRef} analysisDone={referenceAnalysis.status === 'done'} />
    <div className="practice"><FormationMap phrase={phrase} role={role} landing={landing} /><section className="card"><header><div><small>PRACTICE</small><h3>{source === 'webcam' ? 'Live webcam' : 'Test attempt'}</h3></div><span>{pose.status}</span></header><div className="tabs"><button className={source === 'fixture' ? 'selected' : ''} onClick={() => setSource('fixture')}>Test video</button><button className={source === 'webcam' ? 'selected' : ''} onClick={() => void startCamera()}>Webcam</button></div>{source === 'fixture' && <><select value={fixtureId} onChange={(event) => chooseFixture(event.target.value)}>{demoFixtures.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><label className="load">Load attempt video<input type="file" accept="video/*" onChange={(event) => loadLocalFile(event.target.files?.[0], setLearnerUrl)} /></label></>}<div className={`video-stage learner ${calibrating ? 'calibrating' : ''}`} onClick={addCalibrationPoint}><video ref={learnerRef} className={source === 'webcam' ? 'mirrored' : ''} src={source === 'fixture' && learnerUrl ? learnerUrl : undefined} muted playsInline onLoadedMetadata={(event) => setLearnerContent(videoContentRect(event.currentTarget))} /><SampleOverlay videoRef={learnerRef} sample={pose.latest} color={role.color} mirrored={source === 'webcam'} />{calibrationPoints.map((point, index) => { const shownX = source === 'webcam' ? 1 - point.x : point.x; return <b className="calibration-point" style={{ left: learnerContent.left + shownX * learnerContent.width, top: learnerContent.top + point.y * learnerContent.height }} key={`${point.x}-${point.y}`}>{index + 1}</b> })}{!learnerUrl && source === 'fixture' && <div className="empty"><strong>{fixture.label}</strong><span>Load the corresponding file to test.</span></div>}{liveCount && <div className="live-count">{liveCount}</div>}</div><div className="calibration-controls"><button onClick={() => { setCalibrating(true); setCalibrationPoints([]) }}>Calibrate floor</button>{calibrating && <><input aria-label="Floor width in meters" type="number" min="0.1" step="0.1" value={floorWidth} onChange={(event) => setFloorWidth(event.target.value)} /><input aria-label="Floor depth in meters" type="number" min="0.1" step="0.1" value={floorDepth} onChange={(event) => setFloorDepth(event.target.value)} /><button disabled={calibrationPoints.length !== 4} onClick={saveCalibration}>Save 4 corners</button></>}<span>{calibrating ? `Click near-left, near-right, far-right, far-left (${calibrationPoints.length}/4)` : `${calibration.widthM} × ${calibration.depthM} m floor`}</span></div><button className="primary" disabled={(source === 'fixture' && !learnerUrl) || calibrating} onClick={beginAttempt}>Start / retry attempt</button>{pose.error && <p className="error">{pose.error}</p>}</section></div>
    {result && <section className="card results"><header><div><small>FEEDBACK</small><h2>{result.primaryCorrection}</h2></div></header><div className="result-grid"><Result label="Visibility" value={result.visibility} /><Result label="Timing" value={result.timing} /><Result label="Footwork" value={result.footwork} /><Result label="Formation" value={result.formation} /><Result label="Posture" value={result.posture} /></div>{landing && <footer><div><small>SAME ATTEMPT, DIFFERENT ROLE</small><p>The landing stays fixed. Only the target changes.</p></div>{phrase.roles.map((item) => <button className={judgedRoleId === item.id ? 'selected' : ''} onClick={() => rescore(item.id)} key={item.id}>Judge as {item.label}</button>)}</footer>}</section>}</div></div></main>
}

