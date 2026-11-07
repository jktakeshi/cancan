import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { demoFixtures, demoManifest } from './demoData'
import type { AttemptResult, Calibration, DimensionResult, FloorPoint, Phrase, PoseSample, RoleTarget } from './domain'
import { correctionFor, extractStableLanding, scoreFormation, scorePosture } from './evaluation'
import { calibrationErrors } from './geometry'
import { validateManifest } from './manifestValidation'
import { usePoseInput } from './usePoseInput'

const connections = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [24, 26], [26, 28], [28, 30]]
const dimension = (status: DimensionResult['status'], reason: string): DimensionResult => ({ status, reason })

function getCount(phrase: Phrase, time: number) {
  let count = 1
  for (const mark of phrase.counts) if (time >= mark.timeSec) count = mark.count
  return count
}

function getHighlight(role: RoleTarget, time: number) {
  const frames = [...role.highlights].sort((a, b) => a.timeSec - b.timeSec)
  const nextIndex = frames.findIndex((frame) => frame.timeSec >= time)
  if (nextIndex <= 0) return frames[Math.max(0, nextIndex)]
  if (nextIndex < 0) return frames.at(-1)
  const previous = frames[nextIndex - 1]
  const next = frames[nextIndex]
  const progress = (time - previous.timeSec) / Math.max(next.timeSec - previous.timeSec, 0.001)
  return { center: { x: previous.center.x + (next.center.x - previous.center.x) * progress, y: previous.center.y + (next.center.y - previous.center.y) * progress }, radius: previous.radius + (next.radius - previous.radius) * progress }
}

function Skeleton({ sample }: { sample: PoseSample | null }) {
  if (!sample?.landmarks.length) return null
  return <svg className="skeleton" viewBox="0 0 1 1" preserveAspectRatio="none">{connections.map(([start, end]) => {
    const a = sample.landmarks[start]
    const b = sample.landmarks[end]
    return a?.visibility >= 0.6 && b?.visibility >= 0.6 ? <line key={`${start}-${end}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null
  })}</svg>
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

function App() {
  const errors = useMemo(() => validateManifest(demoManifest), [])
  const [phraseId, setPhraseId] = useState(demoManifest.phrases[0].id)
  const phrase = demoManifest.phrases.find((item) => item.id === phraseId) ?? demoManifest.phrases[0]
  const [roleId, setRoleId] = useState(phrase.roles[0].id)
  const role = phrase.roles.find((item) => item.id === roleId) ?? phrase.roles[0]
  const [chunkIndex, setChunkIndex] = useState(0)
  const chunk = phrase.teachingChunks[chunkIndex] ?? phrase.teachingChunks[0]
  const [referenceUrl, setReferenceUrl] = useState(demoManifest.frontVideo ?? '')
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
  const highlight = getHighlight(role, referenceTime)

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    timersRef.current.forEach(clearTimeout)
  }, [])

  if (errors.length) return <main className="fatal"><h1>Rehearsal data is invalid</h1><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></main>

  const loadLocalFile = (file: File | undefined, setter: (url: string) => void) => { if (file) setter(URL.createObjectURL(file)) }

  const choosePhrase = (nextPhrase: Phrase) => {
    setPhraseId(nextPhrase.id)
    setRoleId(nextPhrase.roles[0].id)
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
    const bounds = event.currentTarget.getBoundingClientRect()
    setCalibrationPoints((points) => [...points, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }])
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
    const posture = scorePosture(role.poseTargets.find((target) => target.count === 8)?.landmarks, finalPose)
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

  return <main><nav><b>DC</b><strong>Dance Catch-up</strong><span>functional prototype</span></nav><section className="hero"><div><small>ROLE-AWARE REHEARSAL</small><h1>Learn the dancer, not just the dance.</h1><p>Choose a phrase and role, review the path, then practice timing, formation, and final shape.</p></div><aside><strong>Placeholder data</strong><span>Load the team recordings when ready.</span></aside></section><div className="layout">
    <section className="card sidebar"><small>1 · CHOOSE A PHRASE</small>{demoManifest.phrases.map((item) => <button className={item.id === phrase.id ? 'selected' : ''} onClick={() => choosePhrase(item)} key={item.id}><strong>{item.label}</strong><span>Counts 1–8</span></button>)}<small>2 · CHOOSE A ROLE</small>{phrase.roles.map((item) => <button className={item.id === role.id ? 'selected' : ''} onClick={() => setRoleId(item.id)} key={item.id}><i style={{ background: item.color }} />{item.label}</button>)}<small>TEACHING CHUNKS</small>{phrase.teachingChunks.map((item, index) => <button className={index === chunkIndex ? 'selected' : ''} onClick={() => setChunkIndex(index)} key={item.startCount}><strong>Counts {item.startCount}–{item.endCount}</strong><span>{item.instruction}</span></button>)}</section>
    <div className="content"><section className="card"><header><div><small>REFERENCE</small><h2>{phrase.label} · {role.label}</h2></div><em>{getCount(phrase, referenceTime)}</em></header><div className="video-stage">{referenceUrl ? <video ref={referenceRef} src={referenceUrl} controls onTimeUpdate={(event) => { const video = event.currentTarget; const end = phrase.counts[chunk.endCount - 1].timeSec + .5; if (loopChunk && video.currentTime >= end) video.currentTime = phrase.counts[chunk.startCount - 1].timeSec; setReferenceTime(video.currentTime) }} /> : <div className="empty"><strong>Reference video pending</strong><span>The interface and evaluator are ready for the recorded asset.</span></div>}{highlight && <div className="highlight" style={{ left: `${(highlight.center.x - highlight.radius) * 100}%`, top: `${(highlight.center.y - highlight.radius) * 100}%`, width: `${highlight.radius * 200}%`, borderColor: role.color }}><span style={{ background: role.color }}>{role.label}</span></div>}</div><div className="controls"><label>Load reference<input type="file" accept="video/*" onChange={(event) => loadLocalFile(event.target.files?.[0], setReferenceUrl)} /></label><button onClick={() => { if (!referenceRef.current) return; setLoopChunk(true); referenceRef.current.currentTime = phrase.counts[chunk.startCount - 1].timeSec; void referenceRef.current.play() }}>Loop selected counts</button><button onClick={() => { setLoopChunk(false); referenceRef.current?.pause() }}>Stop loop</button></div><div className="instruction"><span>Counts {chunk.startCount}–{chunk.endCount}</span><strong>{chunk.instruction}</strong></div></section>
    <div className="practice"><FormationMap phrase={phrase} role={role} landing={landing} /><section className="card"><header><div><small>PRACTICE</small><h3>{source === 'webcam' ? 'Live webcam' : 'Test attempt'}</h3></div><span>{pose.status}</span></header><div className="tabs"><button className={source === 'fixture' ? 'selected' : ''} onClick={() => setSource('fixture')}>Test video</button><button className={source === 'webcam' ? 'selected' : ''} onClick={() => void startCamera()}>Webcam</button></div>{source === 'fixture' && <><select value={fixtureId} onChange={(event) => chooseFixture(event.target.value)}>{demoFixtures.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><label className="load">Load attempt video<input type="file" accept="video/*" onChange={(event) => loadLocalFile(event.target.files?.[0], setLearnerUrl)} /></label></>}<div className={`video-stage learner ${calibrating ? 'calibrating' : ''}`} onClick={addCalibrationPoint}><video ref={learnerRef} src={source === 'fixture' ? learnerUrl : undefined} muted playsInline /><Skeleton sample={pose.latest} />{calibrationPoints.map((point, index) => <b className="calibration-point" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} key={`${point.x}-${point.y}`}>{index + 1}</b>)}{!learnerUrl && source === 'fixture' && <div className="empty"><strong>{fixture.label}</strong><span>Load the corresponding file to test.</span></div>}{liveCount && <div className="live-count">{liveCount}</div>}</div><div className="calibration-controls"><button onClick={() => { setCalibrating(true); setCalibrationPoints([]) }}>Calibrate floor</button>{calibrating && <><input aria-label="Floor width in meters" type="number" min="0.1" step="0.1" value={floorWidth} onChange={(event) => setFloorWidth(event.target.value)} /><input aria-label="Floor depth in meters" type="number" min="0.1" step="0.1" value={floorDepth} onChange={(event) => setFloorDepth(event.target.value)} /><button disabled={calibrationPoints.length !== 4} onClick={saveCalibration}>Save 4 corners</button></>}<span>{calibrating ? `Click near-left, near-right, far-right, far-left (${calibrationPoints.length}/4)` : `${calibration.widthM} × ${calibration.depthM} m floor`}</span></div><button className="primary" disabled={(source === 'fixture' && !learnerUrl) || calibrating} onClick={beginAttempt}>Start / retry attempt</button>{pose.error && <p className="error">{pose.error}</p>}</section></div>
    {result && <section className="card results"><header><div><small>FEEDBACK</small><h2>{result.primaryCorrection}</h2></div></header><div className="result-grid"><Result label="Visibility" value={result.visibility} /><Result label="Timing" value={result.timing} /><Result label="Footwork" value={result.footwork} /><Result label="Formation" value={result.formation} /><Result label="Posture" value={result.posture} /></div>{landing && <footer><div><small>SAME ATTEMPT, DIFFERENT ROLE</small><p>The landing stays fixed. Only the target changes.</p></div>{phrase.roles.map((item) => <button className={judgedRoleId === item.id ? 'selected' : ''} onClick={() => rescore(item.id)} key={item.id}>Judge as {item.label}</button>)}</footer>}</section>}</div></div></main>
}

export default App
