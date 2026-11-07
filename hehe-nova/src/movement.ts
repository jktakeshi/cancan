import type { Phrase, PoseLandmark, PoseSample } from './domain'
import { poseAt, type ReferenceTrack } from './referenceTracking'

/*
 * Body-relative movement analysis shared by teaching and review.
 *
 * Coordinates: landmarks arrive as unmirrored normalized video points. Multiplying x by the
 * video aspect ratio makes distances isotropic. Angles are measured in a body frame whose
 * "down" axis runs from the shoulders to the hips, so leaning, camera distance, and body size
 * do not change the result.
 *
 * Directions: MediaPipe's left/right are the dancer's own. The reference dancer and the learner
 * both face the camera, so camera-right is "your left" for both, and limbs compare by index.
 */

type Pt = { x: number; y: number }

export const movementConfig = {
  referenceVisibility: 0.35,
  learnerVisibility: 0.5,
  /** Mean limb-angle error, in degrees, that scores zero. */
  zeroScoreDeg: 70,
  passScore: 70,
  /** Learner may trail (positive) or lead (negative) the reference by up to this much. */
  maxLagSec: 0.45,
  maxLeadSec: 0.15,
  /** After the take's overall lag is found, each sample may still drift this much from it. */
  lagJitterSec: 0.1,
  lagStepSec: 0.05,
  /** Hip travel, in torso lengths, that counts as moving across the floor. */
  travelThreshold: 0.45,
  /** Change in apparent size that counts as moving toward or away from the camera. */
  depthThreshold: 0.08,
}

const visible = (landmark: PoseLandmark | undefined, min: number) => Boolean(landmark && landmark.visibility >= min)
const at = (landmark: PoseLandmark, aspect: number): Pt => ({ x: landmark.x * aspect, y: landmark.y })
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const toDeg = (radians: number) => radians * 180 / Math.PI
const wrapAbsDeg = (degrees: number) => Math.abs(((degrees + 540) % 360) - 180)

export type BodyFrame = { hip: Pt; down: Pt; torso: number }

export function bodyFrame(landmarks: PoseLandmark[], aspect: number, minVisibility = movementConfig.referenceVisibility): BodyFrame | null {
  if (landmarks.length < 29 || ![11, 12, 23, 24].every((index) => visible(landmarks[index], minVisibility))) return null
  const hip = mid(at(landmarks[23], aspect), at(landmarks[24], aspect))
  const shoulder = mid(at(landmarks[11], aspect), at(landmarks[12], aspect))
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
  if (torso < 1e-3) return null
  return { hip, down: { x: (hip.x - shoulder.x) / torso, y: (hip.y - shoulder.y) / torso }, torso }
}

/** Signed angle of segment a→b from the body's down axis, in degrees: 0 hangs down, ±180 points up. */
function segmentAngle(landmarks: PoseLandmark[], a: number, b: number, aspect: number, frame: BodyFrame) {
  const start = at(landmarks[a], aspect)
  const end = at(landmarks[b], aspect)
  const v = { x: end.x - start.x, y: end.y - start.y }
  return toDeg(Math.atan2(frame.down.x * v.y - frame.down.y * v.x, frame.down.x * v.x + frame.down.y * v.y))
}

/** Flexion at the middle joint in degrees: 0 is a straight limb. */
function bend(landmarks: PoseLandmark[], a: number, b: number, c: number, aspect: number) {
  const [p, q, r] = [at(landmarks[a], aspect), at(landmarks[b], aspect), at(landmarks[c], aspect)]
  const u = { x: q.x - p.x, y: q.y - p.y }
  const v = { x: r.x - q.x, y: r.y - q.y }
  const cos = (u.x * v.x + u.y * v.y) / Math.max(1e-9, Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))
  return toDeg(Math.acos(Math.max(-1, Math.min(1, cos))))
}

export type LimbKey = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg'

const LIMBS: { key: LimbKey; side: 'left' | 'right'; kind: 'arm' | 'leg'; joints: [number, number, number] }[] = [
  { key: 'leftArm', side: 'left', kind: 'arm', joints: [11, 13, 15] },
  { key: 'rightArm', side: 'right', kind: 'arm', joints: [12, 14, 16] },
  { key: 'leftLeg', side: 'left', kind: 'leg', joints: [23, 25, 27] },
  { key: 'rightLeg', side: 'right', kind: 'leg', joints: [24, 26, 28] },
]

type LimbPose = { upper: number; lower: number; bend: number }

function limbPose(landmarks: PoseLandmark[], joints: [number, number, number], aspect: number, frame: BodyFrame, minVisibility: number): LimbPose | null {
  if (!joints.every((index) => visible(landmarks[index], minVisibility))) return null
  const [a, b, c] = joints
  return { upper: segmentAngle(landmarks, a, b, aspect, frame), lower: segmentAngle(landmarks, b, c, aspect, frame), bend: bend(landmarks, a, b, c, aspect) }
}

export type LimbDifference = {
  /** Mean absolute angle error of the two segments, degrees. */
  errorDeg: number
  /** Reference minus learner elevation of the upper segment (positive: reference is higher). */
  upperLift: number
  /** Reference minus learner elevation of the lower segment. */
  lowerLift: number
  /** Reference minus learner flexion at the elbow or knee (positive: reference is more bent). */
  bendDelta: number
}

export type PoseComparison = { score: number | null; limbs: Partial<Record<LimbKey, LimbDifference>> }

export function comparePoses(reference: PoseLandmark[], referenceAspect: number, learner: PoseLandmark[], learnerAspect: number): PoseComparison {
  const referenceFrame = bodyFrame(reference, referenceAspect)
  const learnerFrame = bodyFrame(learner, learnerAspect, movementConfig.learnerVisibility)
  if (!referenceFrame || !learnerFrame) return { score: null, limbs: {} }
  const limbs: Partial<Record<LimbKey, LimbDifference>> = {}
  for (const limb of LIMBS) {
    const target = limbPose(reference, limb.joints, referenceAspect, referenceFrame, movementConfig.referenceVisibility)
    const actual = limbPose(learner, limb.joints, learnerAspect, learnerFrame, movementConfig.learnerVisibility)
    if (!target || !actual) continue
    limbs[limb.key] = {
      errorDeg: (wrapAbsDeg(target.upper - actual.upper) + wrapAbsDeg(target.lower - actual.lower)) / 2,
      upperLift: Math.abs(target.upper) - Math.abs(actual.upper),
      lowerLift: Math.abs(target.lower) - Math.abs(actual.lower),
      bendDelta: target.bend - actual.bend,
    }
  }
  const errors = Object.values(limbs).map((limb) => limb.errorDeg)
  if (errors.length < 2) return { score: null, limbs }
  const meanError = errors.reduce((sum, value) => sum + value, 0) / errors.length
  return { score: Math.max(0, Math.round(100 - meanError * 100 / movementConfig.zeroScoreDeg)), limbs }
}

/** One physical instruction for the limb that differs most. */
export function limbCorrection(key: LimbKey, difference: LimbDifference): string {
  const limb = LIMBS.find((item) => item.key === key)!
  const name = `${limb.side} ${limb.kind}`
  const joint = `${limb.side} ${limb.kind === 'arm' ? 'elbow' : 'knee'}`
  const end = `${limb.side} ${limb.kind === 'arm' ? 'hand' : 'foot'}`
  if (Math.abs(difference.bendDelta) >= 30 && Math.abs(difference.bendDelta) >= Math.abs(difference.upperLift)) {
    return difference.bendDelta > 0 ? `Bend your ${joint} more` : `Straighten your ${joint}`
  }
  if (Math.abs(difference.upperLift) >= 20) return difference.upperLift > 0 ? `Lift your ${name} higher` : `Lower your ${name}`
  if (Math.abs(difference.lowerLift) >= 20) return difference.lowerLift > 0 ? `Raise your ${end} higher` : `Bring your ${end} lower`
  return `Match the angle of your ${name} (about ${Math.round(difference.errorDeg)}° off)`
}

/* ---------------------------------------------------------------- teaching ------------------ */

type ArmState = 'down' | 'bent' | 'out' | 'up'
export type Shape = {
  arms: Record<'left' | 'right', ArmState | null>
  kneesBent: boolean | null
  liftedFoot: 'left' | 'right' | null
  wide: boolean | null
  facing: 'front' | 'side' | 'back'
}

export function describeShape(landmarks: PoseLandmark[], aspect: number): Shape | null {
  const frame = bodyFrame(landmarks, aspect)
  if (!frame) return null
  const min = movementConfig.referenceVisibility
  const arm = (joints: [number, number, number]): ArmState | null => {
    const pose = limbPose(landmarks, joints, aspect, frame, min)
    if (!pose) return null
    const lift = Math.abs(pose.upper)
    if (lift > 125) return 'up'
    if (lift > 45) return 'out'
    return pose.bend > 70 ? 'bent' : 'down'
  }
  const leftLeg = limbPose(landmarks, [23, 25, 27], aspect, frame, min)
  const rightLeg = limbPose(landmarks, [24, 26, 28], aspect, frame, min)
  const feet = visible(landmarks[27], min) && visible(landmarks[28], min)
  // Ankle positions along and across the body axis, in torso lengths from the hips.
  const along = (index: number) => { const p = at(landmarks[index], aspect); return ((p.x - frame.hip.x) * frame.down.x + (p.y - frame.hip.y) * frame.down.y) / frame.torso }
  const across = (index: number) => { const p = at(landmarks[index], aspect); return ((p.x - frame.hip.x) * -frame.down.y + (p.y - frame.hip.y) * frame.down.x) / frame.torso }
  const liftGap = feet ? along(27) - along(28) : 0
  const shoulderWidth = Math.hypot((landmarks[11].x - landmarks[12].x) * aspect, landmarks[11].y - landmarks[12].y) / frame.torso
  return {
    arms: { left: arm([11, 13, 15]), right: arm([12, 14, 16]) },
    kneesBent: leftLeg && rightLeg ? leftLeg.bend > 30 && rightLeg.bend > 30 : null,
    liftedFoot: !feet || Math.abs(liftGap) < 0.35 ? null : liftGap < 0 ? 'left' : 'right',
    wide: feet ? Math.abs(across(27) - across(28)) > 0.95 : null,
    // Facing the camera puts the dancer's left shoulder on the image's right.
    facing: shoulderWidth < 0.38 ? 'side' : landmarks[11].x < landmarks[12].x ? 'back' : 'front',
  }
}

const ARM_WORDS: Record<ArmState, string> = { up: 'up overhead', out: 'out', bent: 'bent in', down: 'down' }

function shapeCues(shape: Shape, previous: Shape | null): string[] {
  const cues: string[] = []
  if (!previous || shape.facing !== previous.facing) {
    if (shape.facing === 'side') cues.push('Turn to the side')
    else if (shape.facing === 'back') cues.push('Turn your back to the front')
    else if (previous) cues.push('Turn to face the front')
  }
  const { left, right } = shape.arms
  const leftChanged = left !== null && left !== previous?.arms.left
  const rightChanged = right !== null && right !== previous?.arms.right
  if (left && left === right && (leftChanged || rightChanged)) {
    if (left !== 'down' || previous) cues.push(`Both arms ${ARM_WORDS[left]}`)
  } else {
    if (leftChanged && left && (left !== 'down' || previous)) cues.push(`Left arm ${ARM_WORDS[left]}`)
    if (rightChanged && right && (right !== 'down' || previous)) cues.push(`Right arm ${ARM_WORDS[right]}`)
  }
  if (shape.kneesBent !== null && shape.kneesBent !== (previous?.kneesBent ?? false)) cues.push(shape.kneesBent ? 'Bend your knees' : 'Straighten up')
  if (shape.liftedFoot && shape.liftedFoot !== previous?.liftedFoot) cues.push(`Lift your ${shape.liftedFoot} foot`)
  if (shape.wide !== null && shape.wide !== (previous?.wide ?? false)) cues.push(shape.wide ? 'Step your feet wide' : 'Bring your feet together')
  return cues
}

/** The full starting position, so count 1 always says how to begin. */
function startingCue(shape: Shape): string {
  const parts = [shape.facing === 'front' ? 'facing front' : shape.facing === 'side' ? 'turned to the side' : 'back to the front']
  const { left, right } = shape.arms
  if (left && left === right) parts.push(`both arms ${ARM_WORDS[left]}`)
  else {
    if (left) parts.push(`left arm ${ARM_WORDS[left]}`)
    if (right) parts.push(`right arm ${ARM_WORDS[right]}`)
  }
  if (shape.wide !== null) parts.push(shape.wide ? 'feet wide' : 'feet together')
  if (shape.kneesBent) parts.push('knees bent')
  return `Start ${parts.join(', ')}`
}

/** Where the hips travel between two moments, as learner-relative instructions. */
export function travelCues(start: PoseLandmark[] | null, end: PoseLandmark[] | null, aspect: number): string[] {
  const a = start && bodyFrame(start, aspect)
  const b = end && bodyFrame(end, aspect)
  if (!a || !b) return []
  const cues: string[] = []
  const sideways = (b.hip.x - a.hip.x) / a.torso
  // Camera-right is the learner's left when the learner faces the camera.
  if (Math.abs(sideways) >= movementConfig.travelThreshold) cues.push(`Travel to your ${sideways > 0 ? 'left' : 'right'}${Math.abs(sideways) > 1.5 ? ' (big move)' : ''}`)
  const depth = b.torso / a.torso - 1
  if (Math.abs(depth) >= movementConfig.depthThreshold) cues.push(depth > 0 ? 'Move forward, toward the front' : 'Move back, away from the front')
  return cues
}

export type CountLesson = { count: number; timeSec: number; endSec: number; cues: string[]; visible: boolean }

/** Pose sampled just after the beat, when a hit has landed. */
const HIT_OFFSET_SEC = 0.08

export function teachPhrase(track: ReferenceTrack | undefined, phrase: Phrase, aspect: number): CountLesson[] {
  let previous: Shape | null = null
  return phrase.counts.map((mark, index) => {
    const endSec = phrase.counts[index + 1]?.timeSec ?? phrase.endSec
    const pose = track ? poseAt(track, mark.timeSec + HIT_OFFSET_SEC) : null
    const shape = pose ? describeShape(pose, aspect) : null
    if (!track || !pose || !shape) return { count: mark.count, timeSec: mark.timeSec, endSec, cues: ['Dancer not clearly visible on this count'], visible: false }
    const shapeChanges = previous ? shapeCues(shape, previous) : [startingCue(shape)]
    const cues = [...shapeChanges, ...travelCues(pose, poseAt(track, endSec), aspect)]
    previous = shape
    return { count: mark.count, timeSec: mark.timeSec, endSec, cues: cues.length ? cues : ['Hold the shape and keep the groove'], visible: true }
  })
}

/** The dancer's foot path across a phrase, in normalized video coordinates, with count markers. */
export function phraseTrail(track: ReferenceTrack | undefined, phrase: Phrase) {
  const feet = (timeSec: number) => {
    const pose = track && poseAt(track, timeSec)
    if (!pose || !visible(pose[27], 0.3) || !visible(pose[28], 0.3)) return null
    return { x: (pose[27].x + pose[28].x) / 2, y: (pose[27].y + pose[28].y) / 2 }
  }
  const points: Pt[] = []
  for (let time = phrase.startSec; time <= phrase.endSec; time += 0.1) {
    const point = feet(time)
    if (point) points.push(point)
  }
  const marks = phrase.counts.map((mark) => ({ point: feet(mark.timeSec + HIT_OFFSET_SEC), label: String(mark.count) })).filter((mark): mark is { point: Pt; label: string } => mark.point !== null)
  return { points, marks }
}

/* ---------------------------------------------------------------- display -------------------- */

/**
 * Place a reference pose on the learner's body: same hip position and torso length, so the
 * learner sees where each limb should be. Orientation is kept in image space so leans show.
 */
export function retargetPose(reference: PoseLandmark[], referenceAspect: number, learner: PoseLandmark[], learnerAspect: number): PoseLandmark[] | null {
  const from = bodyFrame(reference, referenceAspect)
  const to = bodyFrame(learner, learnerAspect, movementConfig.learnerVisibility)
  if (!from || !to) return null
  const scale = to.torso / from.torso
  return reference.map((landmark) => ({
    ...landmark,
    x: (to.hip.x + (landmark.x * referenceAspect - from.hip.x) * scale) / learnerAspect,
    y: to.hip.y + (landmark.y - from.hip.y) * scale,
  }))
}

/** Center a pose in a box (normalized box coordinates) with a fixed torso size, for side-by-side views. */
export function fitPoseToBox(landmarks: PoseLandmark[], aspect: number, boxAspect: number, torsoFraction = 0.24): PoseLandmark[] | null {
  const frame = bodyFrame(landmarks, aspect, 0.2)
  if (!frame) return null
  const k = torsoFraction / frame.torso
  return landmarks.map((landmark) => ({
    ...landmark,
    x: 0.5 + (landmark.x * aspect - frame.hip.x) * k / boxAspect,
    y: 0.56 + (landmark.y - frame.hip.y) * k,
  }))
}

/* ---------------------------------------------------------------- review --------------------- */

export type CountReview = {
  count: number
  timeSec: number
  endSec: number
  score: number | null
  correction: string
  /** Learner pose nearest the beat, with the reference time it best matched. */
  snapshot?: { learner: PoseLandmark[]; referenceTimeSec: number }
}

export type TakeReview = {
  score: number | null
  counts: CountReview[]
  timing: string | null
  travel: string | null
  headline: string
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
}

const lagOffsets = (from: number, to: number) => {
  const offsets: number[] = []
  for (let lag = from; lag <= to + 1e-9; lag += movementConfig.lagStepSec) offsets.push(Number(lag.toFixed(3)))
  // Nearest-to-zero first, so ties (static moments) never invent a lag.
  return offsets.sort((a, b) => Math.abs(a) - Math.abs(b))
}

function bestMatch(sample: PoseSample, track: ReferenceTrack, offsets: number[], referenceAspect: number, learnerAspect: number) {
  let best: { comparison: PoseComparison; lag: number } | null = null
  for (const lag of offsets) {
    const reference = poseAt(track, sample.timeMs / 1000 - lag)
    if (!reference) continue
    const comparison = comparePoses(reference, referenceAspect, sample.landmarks, learnerAspect)
    if (comparison.score === null) continue
    if (!best || comparison.score > best.comparison.score! + 1) best = { comparison, lag }
  }
  return best
}

/**
 * One consistent delay for the take: the lag that maximizes the mean match over all samples
 * (a cross-correlation). Static stretches match equally at every lag, so they cannot pull the
 * estimate; when the whole curve is flat the take carries no timing information.
 */
function estimateLag(samples: PoseSample[], track: ReferenceTrack, referenceAspect: number, learnerAspect: number): { lag: number; informative: boolean } {
  const offsets = lagOffsets(-movementConfig.maxLeadSec, movementConfig.maxLagSec)
  const usable = samples.filter((sample) => offsets.every((lag) => poseAt(track, sample.timeMs / 1000 - lag)))
  if (usable.length < 6) return { lag: 0, informative: false }
  const means = offsets.map((lag) => {
    let sum = 0
    let n = 0
    for (const sample of usable) {
      const score = comparePoses(poseAt(track, sample.timeMs / 1000 - lag)!, referenceAspect, sample.landmarks, learnerAspect).score
      if (score !== null) { sum += score; n += 1 }
    }
    return n ? sum / n : 0
  })
  // offsets are ordered nearest-to-zero first, so only a real improvement moves away from 0.
  let bestIndex = 0
  means.forEach((mean, index) => { if (mean > means[bestIndex] + 0.25) bestIndex = index })
  return { lag: offsets[bestIndex], informative: Math.max(...means) - Math.min(...means) >= 1.5 }
}

/**
 * Score a take. Each learner sample carries the reference video time it was captured at, so
 * it is compared with the reference dancer at that time, shifted by the take's overall lag.
 */
export function reviewTake(samples: PoseSample[], track: ReferenceTrack, phrase: Phrase, referenceAspect: number, learnerAspect: number): TakeReview {
  const usable = samples.filter((sample) => sample.landmarks.length && sample.timeMs / 1000 >= phrase.startSec && sample.timeMs / 1000 <= phrase.endSec + 0.15)
  const { lag: takeLag, informative } = estimateLag(usable, track, referenceAspect, learnerAspect)
  const offsets = lagOffsets(takeLag - movementConfig.lagJitterSec, takeLag + movementConfig.lagJitterSec).sort((a, b) => Math.abs(a - takeLag) - Math.abs(b - takeLag))
  const counts: CountReview[] = phrase.counts.map((mark, index) => {
    const endSec = phrase.counts[index + 1]?.timeSec ?? phrase.endSec
    const window = samples.filter((sample) => sample.timeMs / 1000 >= mark.timeSec && sample.timeMs / 1000 < endSec && sample.landmarks.length)
    const scores: number[] = []
    const limbTotals: Partial<Record<LimbKey, { sum: LimbDifference; n: number }>> = {}
    let snapshot: CountReview['snapshot']
    let snapshotDistance = Infinity
    for (const sample of window) {
      const time = sample.timeMs / 1000
      const best = bestMatch(sample, track, offsets, referenceAspect, learnerAspect)
      if (!best) continue
      scores.push(best.comparison.score!)
      for (const [key, difference] of Object.entries(best.comparison.limbs) as [LimbKey, LimbDifference][]) {
        const total = limbTotals[key] ?? { sum: { errorDeg: 0, upperLift: 0, lowerLift: 0, bendDelta: 0 }, n: 0 }
        total.sum = { errorDeg: total.sum.errorDeg + difference.errorDeg, upperLift: total.sum.upperLift + difference.upperLift, lowerLift: total.sum.lowerLift + difference.lowerLift, bendDelta: total.sum.bendDelta + difference.bendDelta }
        total.n += 1
        limbTotals[key] = total
      }
      const distance = Math.abs(time - best.lag - (mark.timeSec + HIT_OFFSET_SEC))
      if (distance < snapshotDistance) {
        snapshotDistance = distance
        snapshot = { learner: sample.landmarks, referenceTimeSec: mark.timeSec + HIT_OFFSET_SEC }
      }
    }
    if (!scores.length) return { count: mark.count, timeSec: mark.timeSec, endSec, score: null, correction: window.length ? 'Keep your whole body in frame' : 'Not captured', snapshot }
    const score = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    const worst = (Object.entries(limbTotals) as [LimbKey, { sum: LimbDifference; n: number }][])
      .map(([key, { sum, n }]) => ({ key, mean: { errorDeg: sum.errorDeg / n, upperLift: sum.upperLift / n, lowerLift: sum.lowerLift / n, bendDelta: sum.bendDelta / n } }))
      .sort((a, b) => b.mean.errorDeg - a.mean.errorDeg)[0]
    const correction = score >= 85 || !worst ? 'Nice — matches the dancer' : limbCorrection(worst.key, worst.mean)
    return { count: mark.count, timeSec: mark.timeSec, endSec, score, correction, snapshot }
  })

  const scored = counts.filter((count) => count.score !== null)
  const score = scored.length ? Math.round(scored.reduce((sum, count) => sum + count.score!, 0) / scored.length) : null

  let timing: string | null = null
  if (informative) {
    if (takeLag >= 0.2) timing = `You're about ${takeLag.toFixed(1)}s behind the music — anticipate each count`
    else if (takeLag <= -0.1) timing = `You're slightly ahead of the music — let each count land`
    else timing = 'Timing is on the beat'
  }

  const travel = compareTravel(samples, track, phrase, referenceAspect, learnerAspect)

  let headline: string
  if (score === null) headline = 'I could not see you clearly — step back so your whole body is in frame'
  else {
    const weakest = scored.reduce((worst, count) => (count.score! < worst.score! ? count : worst))
    headline = score >= movementConfig.passScore && weakest.score! >= 60
      ? 'Solid take! Try it at full speed or move to the next phrase.'
      : `Focus on count ${weakest.count}: ${weakest.correction.charAt(0).toLowerCase()}${weakest.correction.slice(1)}`
  }
  return { score, counts, timing, travel, headline }
}

function compareTravel(samples: PoseSample[], track: ReferenceTrack, phrase: Phrase, referenceAspect: number, learnerAspect: number): string | null {
  const inPhrase = samples.filter((sample) => sample.timeMs / 1000 >= phrase.startSec && sample.timeMs / 1000 <= phrase.endSec)
  const frames = inPhrase.map((sample) => bodyFrame(sample.landmarks, learnerAspect, movementConfig.learnerVisibility)).filter((frame) => frame !== null)
  const start = poseAt(track, phrase.startSec)
  const end = poseAt(track, phrase.endSec)
  const from = start && bodyFrame(start, referenceAspect)
  const to = end && bodyFrame(end, referenceAspect)
  if (frames.length < 4 || !from || !to) return null
  const target = (to.hip.x - from.hip.x) / from.torso
  const head = frames.slice(0, 3)
  const tail = frames.slice(-3)
  const actual = (median(tail.map((frame) => frame.hip.x)) - median(head.map((frame) => frame.hip.x))) / median(head.map((frame) => frame.torso))
  const side = (value: number) => (value > 0 ? 'left' : 'right')
  if (Math.abs(target) < movementConfig.travelThreshold) {
    return Math.abs(actual) < movementConfig.travelThreshold * 1.5 ? 'You stayed in place, like the dancer' : `The dancer stays in place, but you drifted to your ${side(actual)}`
  }
  if (Math.abs(actual) < movementConfig.travelThreshold) return `Travel to your ${side(target)} over this phrase — you stayed in place`
  if (Math.sign(actual) !== Math.sign(target)) return `Wrong direction: travel to your ${side(target)}, not your ${side(actual)}`
  return Math.abs(actual) < Math.abs(target) * 0.5 ? `Right direction — travel farther to your ${side(target)}` : `Good travel to your ${side(target)}`
}
