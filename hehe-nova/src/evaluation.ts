import type { AttemptResult, Calibration, DimensionResult, FloorPoint, PoseLandmark, PoseSample, RoleTarget } from './domain'
import { computeHomography, floorDistance, mapReferencePoint, projectToFloor } from './geometry'

export const evaluationConfig = {
  visibilityThreshold: 0.6,
  landingWindowStartMs: 150,
  landingWindowEndMs: 700,
  stabilityRadiusM: 0.15,
  baseLandingToleranceM: 0.25,
  posturePassScore: 70,
}

const inconclusive = (reason: string): DimensionResult => ({ status: 'inconclusive', reason })
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function visible(landmark: PoseLandmark | undefined) {
  return Boolean(landmark && landmark.visibility >= evaluationConfig.visibilityThreshold)
}

export function extractStableLanding(
  samples: PoseSample[],
  countEightMs: number,
  calibration: Calibration,
): { result: DimensionResult; landing?: FloorPoint } {
  const homography = computeHomography(calibration)
  if (!homography) return { result: inconclusive('Practice-floor calibration is invalid.') }
  const candidates: FloorPoint[] = []

  for (const sample of samples) {
    const offset = sample.timeMs - countEightMs
    if (offset < evaluationConfig.landingWindowStartMs || offset > evaluationConfig.landingWindowEndMs) continue
    const left = visible(sample.landmarks[29]) ? sample.landmarks[29] : sample.landmarks[27]
    const right = visible(sample.landmarks[30]) ? sample.landmarks[30] : sample.landmarks[28]
    if (!visible(left) || !visible(right)) continue
    const leftFloor = projectToFloor(left, homography)
    const rightFloor = projectToFloor(right, homography)
    if (!leftFloor || !rightFloor) continue
    candidates.push({ x: (leftFloor.x + rightFloor.x) / 2, y: (leftFloor.y + rightFloor.y) / 2 })
  }

  if (candidates.length < 3) return { result: inconclusive('Position unclear: keep both feet visible through count eight.') }
  const landing = { x: median(candidates.map((point) => point.x)), y: median(candidates.map((point) => point.y)) }
  const stableCount = candidates.filter((point) => floorDistance(point, landing) <= evaluationConfig.stabilityRadiusM).length
  if (stableCount < 3) return { result: inconclusive('Landing unclear: settle and hold the position on count eight.') }
  return { result: { status: 'pass', reason: 'A stable landing was captured.', measured: { stableSamples: stableCount } }, landing }
}

export function scoreFormation(
  landing: FloorPoint | undefined,
  role: RoleTarget,
  allRoles: RoleTarget[],
  referenceCalibration: Calibration,
  practiceCalibration: Calibration,
): DimensionResult {
  if (!landing) return inconclusive('No stable landing is available.')
  const target = mapReferencePoint(role.finishFloor, referenceCalibration, practiceCalibration)
  const otherTargets = allRoles.filter((candidate) => candidate.id !== role.id).map((candidate) => mapReferencePoint(candidate.finishFloor, referenceCalibration, practiceCalibration))
  const nearestOtherDistance = otherTargets.length > 0 ? Math.min(...otherTargets.map((other) => floorDistance(target, other))) : Number.POSITIVE_INFINITY
  const tolerance = Math.min(evaluationConfig.baseLandingToleranceM, 0.4 * nearestOtherDistance)
  const error = floorDistance(landing, target)
  return {
    status: error <= tolerance ? 'pass' : 'fail',
    score: Math.max(0, Math.round(100 * (1 - error / Math.max(tolerance * 2, 0.01)))),
    measured: { errorM: error, toleranceM: tolerance, dxM: target.x - landing.x, dyM: target.y - landing.y },
    reason: error <= tolerance ? 'The landing matches the selected role.' : 'The landing is outside the selected role target.',
  }
}

function normalizePose(landmarks: PoseLandmark[], aspectRatio = 1): PoseLandmark[] | null {
  const leftHip = landmarks[23]
  const rightHip = landmarks[24]
  const leftShoulder = landmarks[11]
  const rightShoulder = landmarks[12]
  if (![leftHip, rightHip, leftShoulder, rightShoulder].every(visible)) return null
  const corrected = landmarks.map((landmark) => ({ ...landmark, x: landmark.x * aspectRatio }))
  const hipX = (corrected[23].x + corrected[24].x) / 2
  const hipY = (corrected[23].y + corrected[24].y) / 2
  const shoulderX = (corrected[11].x + corrected[12].x) / 2
  const shoulderY = (corrected[11].y + corrected[12].y) / 2
  const torso = Math.hypot(shoulderX - hipX, shoulderY - hipY)
  if (torso < 0.01) return null
  return corrected.map((landmark) => ({ ...landmark, x: (landmark.x - hipX) / torso, y: (landmark.y - hipY) / torso }))
}

export function scorePosture(reference: PoseLandmark[] | undefined, learner: PoseLandmark[] | undefined): DimensionResult {
  if (!reference || !learner) return inconclusive('No final pose is available.')
  const normalizedReference = normalizePose(reference)
  const normalizedLearner = normalizePose(learner)
  if (!normalizedReference || !normalizedLearner) return inconclusive('Keep the shoulders and hips visible for posture feedback.')
  const regions: Record<string, number[]> = { arms: [11, 12, 13, 14, 15, 16], torso: [11, 12, 23, 24], legs: [23, 24, 25, 26, 27, 28] }
  const regionScores: Record<string, number> = {}
  for (const [region, indices] of Object.entries(regions)) {
    const distances = indices.filter((index) => visible(reference[index]) && visible(learner[index])).map((index) => Math.hypot(normalizedReference[index].x - normalizedLearner[index].x, normalizedReference[index].y - normalizedLearner[index].y))
    regionScores[region] = distances.length === 0 ? 0 : Math.max(0, Math.round(100 * (1 - median(distances) / 1.2)))
  }
  const available = Object.values(regionScores).filter((score) => score > 0)
  if (available.length === 0) return inconclusive('Not enough visible joints to compare the final shape.')
  const score = Math.round(available.reduce((sum, value) => sum + value, 0) / available.length)
  return { status: score >= evaluationConfig.posturePassScore ? 'pass' : 'fail', score, measured: regionScores, reason: score >= evaluationConfig.posturePassScore ? 'The final body shape matches.' : 'The final body shape needs adjustment.' }
}

export function correctionFor(result: Omit<AttemptResult, 'primaryCorrection'>): string {
  if (result.visibility.status !== 'pass') return 'Move back so your full body and both feet stay visible.'
  if (result.timing.status === 'fail') return result.timing.reason
  if (result.footwork.status === 'fail') return result.footwork.reason
  if (result.formation.status === 'fail') {
    const dx = result.formation.measured?.dxM ?? 0
    const dy = result.formation.measured?.dyM ?? 0
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'Land farther to your left.' : 'Land farther to your right.'
    return dy > 0 ? 'Land farther back.' : 'Land farther forward.'
  }
  if (result.posture.status === 'fail') {
    const measured = result.posture.measured ?? {}
    const worst = Object.entries(measured).sort((a, b) => a[1] - b[1])[0]?.[0]
    return worst ? `Your formation is correct; adjust your ${worst} to match the final shape.` : 'Your formation is correct; adjust the final body shape.'
  }
  return 'Strong landing. The timing, formation, and final shape match.'
}

