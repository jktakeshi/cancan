import type { Phrase, PoseLandmark, PoseSample } from './domain'
import { poseAt, type ReferenceTrack } from './referenceTracking'

/*
 * Calibration-free floor positions from a single camera.
 *
 * Model: a level pinhole camera with a known horizontal field of view. A person's torso
 * (shoulder midpoint to hip midpoint) is assumed to be `torsoMeters` long, so its length in
 * pixels gives the distance from the camera: Z = f · torso / torsoPx. The feet's horizontal pixel
 * offset then gives the sideways position: X = (u − cx) · Z / f.
 *
 * Floor coordinates are meters with x toward camera-right and z away from the camera. For a
 * person facing the camera, +x is their left, and −z is toward the front.
 *
 * Reference positions are transferred to the learner's room relative to an anchor: the learner's
 * spot when a take starts corresponds to the role's spot at the start of the phrase. The live
 * webcam uses the same model in reverse (with the camera height solved at the anchor) to draw
 * floor markings: an approximate AR, good to a few tens of centimeters.
 */

export const floorConfig = {
  torsoMeters: 0.5,
  referenceHfovDeg: 69,
  learnerHfovDeg: 65,
  /** Floor positions are averaged over this half-window to steady the estimate. */
  smoothingSec: 0.2,
  /** Distance from the target that counts as being in the right spot. */
  onSpotMeters: 0.35,
  /**
   * One ordinary step. Distances shown to the learner are in steps: the room's real size is never
   * needed, and step length scales with the same body proportions that set depth.
   */
  stepMeters: 0.65,
  /** Keep auto-fitted dancers inside this fraction of the webcam width, and at least this far away. */
  fitMargin: 0.05,
  fitMinDepthM: 1,
}

export type FloorPoint = { x: number; z: number }
/**
 * Ground-plane fit for a static camera: 1/Z = a · feetYpx + b. For a pinhole camera over a flat
 * floor this is exact (b absorbs camera pitch through the horizon position), and it gives depth
 * from the feet, which stays steady while dancers bend, crouch, or lean.
 */
export type GroundModel = { a: number; b: number }
export type Camera = { width: number; height: number; fx: number; ground?: GroundModel }

export const cameraFor = (width: number, height: number, hfovDeg: number): Camera => ({ width, height, fx: width / 2 / Math.tan(hfovDeg * Math.PI / 360) })

const seen = (landmark: PoseLandmark | undefined, min: number) => Boolean(landmark && landmark.visibility >= min)

/** Where a person stands on the floor, or null without reliable torso and feet. */
export function floorPosition(landmarks: PoseLandmark[], camera: Camera, minVisibility = 0.35): FloorPoint | null {
  if (!landmarks.length || ![11, 12, 23, 24, 27, 28].every((index) => seen(landmarks[index], minVisibility))) return null
  const px = (index: number) => ({ x: landmarks[index].x * camera.width, y: landmarks[index].y * camera.height })
  const shoulder = { x: (px(11).x + px(12).x) / 2, y: (px(11).y + px(12).y) / 2 }
  const hip = { x: (px(23).x + px(24).x) / 2, y: (px(23).y + px(24).y) / 2 }
  const torsoPx = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
  if (torsoPx < 4) return null
  const feetX = (px(27).x + px(28).x) / 2
  const feetY = (px(27).y + px(28).y) / 2
  const inverseDepth = camera.ground ? camera.ground.a * feetY + camera.ground.b : 0
  // Feet near the horizon make the ground fit unstable; fall back to torso size there.
  const z = inverseDepth > 1 / 40 ? 1 / inverseDepth : camera.fx * floorConfig.torsoMeters / torsoPx
  return { x: (feetX - camera.width / 2) * z / camera.fx, z }
}

/**
 * Fit the ground model from many observations of upright people: torso size gives a noisy depth,
 * feet height gives where they touch the floor. Least squares with two rounds of outlier trimming.
 */
export function fitGroundModel(observations: { feetYpx: number; z: number }[]): GroundModel | null {
  let points = observations.filter((item) => Number.isFinite(item.z) && item.z > 0.3 && item.z < 40)
  if (points.length < 20) return null
  let model: GroundModel | null = null
  for (let round = 0; round < 3; round += 1) {
    const n = points.length
    const mx = points.reduce((sum, p) => sum + p.feetYpx, 0) / n
    const my = points.reduce((sum, p) => sum + 1 / p.z, 0) / n
    const sxx = points.reduce((sum, p) => sum + (p.feetYpx - mx) ** 2, 0)
    const sxy = points.reduce((sum, p) => sum + (p.feetYpx - mx) * (1 / p.z - my), 0)
    if (sxx <= 0) return null
    const a = sxy / sxx
    model = { a, b: my - a * mx }
    const residual = (p: { feetYpx: number; z: number }) => Math.abs(1 / p.z - (model!.a * p.feetYpx + model!.b))
    const sorted = points.map(residual).sort((x, y) => x - y)
    const cutoff = sorted[Math.floor(sorted.length * 0.8)]
    points = points.filter((p) => residual(p) <= cutoff)
  }
  // Farther people must have their feet higher in the image; anything else is not a floor.
  return model && model.a > 0 ? model : null
}

/** Ground-fit observations from tracked dancers, using only upright frames. */
export function groundObservations(tracks: ReferenceTrack[], camera: Camera) {
  const observations: { feetYpx: number; z: number }[] = []
  const torsoOnly = { ...camera, ground: undefined }
  for (const track of tracks) {
    for (const frame of track.frames) {
      const pose = frame.landmarks
      if (![11, 12, 23, 24, 27, 28].every((index) => seen(pose[index], 0.5))) continue
      const shoulder = { x: (pose[11].x + pose[12].x) / 2 * camera.width, y: (pose[11].y + pose[12].y) / 2 * camera.height }
      const hip = { x: (pose[23].x + pose[24].x) / 2 * camera.width, y: (pose[23].y + pose[24].y) / 2 * camera.height }
      // Upright torso: within ~20° of vertical, so its image length is a fair depth cue.
      if (Math.abs(shoulder.x - hip.x) > 0.36 * Math.abs(hip.y - shoulder.y)) continue
      const spot = floorPosition(pose, torsoOnly, 0.5)
      if (spot) observations.push({ feetYpx: (pose[27].y + pose[28].y) / 2 * camera.height, z: spot.z })
    }
  }
  return observations
}

function average(points: FloorPoint[]): FloorPoint | null {
  if (!points.length) return null
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, z: points.reduce((sum, p) => sum + p.z, 0) / points.length }
}

/** A tracked dancer's floor position at a time, averaged over a short window. */
export function trackFloorAt(track: ReferenceTrack, timeSec: number, camera: Camera): FloorPoint | null {
  const points: FloorPoint[] = []
  for (let offset = -floorConfig.smoothingSec; offset <= floorConfig.smoothingSec + 1e-9; offset += 0.1) {
    const pose = poseAt(track, timeSec + offset)
    const point = pose && floorPosition(pose, camera)
    if (point) points.push(point)
  }
  return average(points)
}

/** How the reference formation is mapped into the learner's room. */
export type FloorMapping = {
  /** Learner's floor spot that corresponds to the role's position at `originSec`. */
  anchor: FloorPoint
  /** Role position at the phrase start, in reference floor meters. */
  origin: FloorPoint
  /** Shrinks the reference stage to fit a smaller practice space. */
  scale: number
}

export function mappingFor(track: ReferenceTrack, phrase: Phrase, referenceCamera: Camera, anchor: FloorPoint, scale: number): FloorMapping | null {
  // Search a little into the phrase in case the dancer is hidden on count 1.
  for (let offset = 0; offset <= 1; offset += 0.1) {
    const origin = trackFloorAt(track, phrase.startSec + offset, referenceCamera)
    if (origin) return { anchor, origin, scale }
  }
  return null
}

export const toLearnerFloor = (point: FloorPoint, mapping: FloorMapping): FloorPoint => ({
  x: mapping.anchor.x + (point.x - mapping.origin.x) * mapping.scale,
  z: mapping.anchor.z + (point.z - mapping.origin.z) * mapping.scale,
})

/** Learner camera height solved so the anchor spot projects exactly under the learner's feet. */
export type LearnerView = { camera: Camera; heightM: number }

export function learnerView(landmarks: PoseLandmark[], camera: Camera): LearnerView | null {
  const spot = floorPosition(landmarks, camera, 0.5)
  if (!spot) return null
  const feetY = (landmarks[27].y + landmarks[28].y) / 2 * camera.height
  const heightM = (feetY - camera.height / 2) * spot.z / camera.fx
  // A camera at or below foot level cannot see the floor plane in front of the learner.
  return heightM > 0.15 ? { camera, heightM } : { camera, heightM: 0.9 }
}

/** Project a floor point into normalized (unmirrored) webcam coordinates. */
export function projectFloor(point: FloorPoint, view: LearnerView): { x: number; y: number } | null {
  if (point.z < 0.3) return null
  const { camera, heightM } = view
  return { x: (camera.width / 2 + camera.fx * point.x / point.z) / camera.width, y: (camera.height / 2 + camera.fx * heightM / point.z) / camera.height }
}

/** Pixels per meter on the image at a given floor depth, as a fraction of image height. */
export const heightPerMeterAt = (z: number, view: LearnerView) => view.camera.fx / z / view.camera.height

/**
 * Re-pose a reference dancer so their feet stand on `spot` in the learner's camera, at the size
 * a person standing there would appear.
 */
export function placeOnFloor(pose: PoseLandmark[], referenceCamera: Camera, spot: FloorPoint, view: LearnerView): PoseLandmark[] | null {
  const target = projectFloor(spot, view)
  if (!target || ![11, 12, 23, 24].every((index) => seen(pose[index], 0.3))) return null
  const px = (landmark: PoseLandmark) => ({ x: landmark.x * referenceCamera.width, y: landmark.y * referenceCamera.height })
  const shoulder = { x: (px(pose[11]).x + px(pose[12]).x) / 2, y: (px(pose[11]).y + px(pose[12]).y) / 2 }
  const hip = { x: (px(pose[23]).x + px(pose[24]).x) / 2, y: (px(pose[23]).y + px(pose[24]).y) / 2 }
  const torsoPx = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
  const feet = seen(pose[27], 0.3) && seen(pose[28], 0.3)
    ? { x: (px(pose[27]).x + px(pose[28]).x) / 2, y: (px(pose[27]).y + px(pose[28]).y) / 2 }
    : { x: hip.x, y: hip.y + torsoPx * 1.7 }
  const scale = floorConfig.torsoMeters * view.camera.fx / spot.z / torsoPx
  return pose.map((landmark) => {
    const p = px(landmark)
    return { ...landmark, x: target.x + (p.x - feet.x) * scale / view.camera.width, y: target.y + (p.y - feet.y) * scale / view.camera.height }
  })
}

/** A distance as steps: "a small step", "1 step", "2 steps". */
export function stepsText(meters: number) {
  const steps = meters / floorConfig.stepMeters
  if (steps < 0.75) return 'a small step'
  const whole = Math.round(steps)
  return `${whole} step${whole === 1 ? '' : 's'}`
}

/** Learner-relative instruction for closing the gap from `actual` to `target`, in steps. */
export function moveInstruction(actual: FloorPoint, target: FloorPoint): string | null {
  const dx = target.x - actual.x
  const dz = target.z - actual.z
  if (Math.hypot(dx, dz) < floorConfig.onSpotMeters) return null
  const parts: string[] = []
  // Camera-right (+x) is the learner's left while facing the camera.
  if (Math.abs(dx) >= 0.2) parts.push(`${stepsText(Math.abs(dx))} to your ${dx > 0 ? 'left' : 'right'}`)
  if (Math.abs(dz) >= 0.2) parts.push(`${stepsText(Math.abs(dz))} ${dz < 0 ? 'forward' : 'back'}`)
  return parts.length ? `Take ${parts.join(' and ')}` : null
}

/**
 * Size-independent placement: the largest scale (at most 1) at which every given reference floor
 * point, mapped around the learner's start spot, lands inside the webcam view and in front of the
 * camera. The learner never measures their room; the formation is shrunk to what the camera sees.
 */
export function fitScaleToView(points: FloorPoint[], origin: FloorPoint, anchor: FloorPoint, view: LearnerView): number {
  const fits = (scale: number) => points.every((point) => {
    const mapped = toLearnerFloor(point, { anchor, origin, scale })
    if (mapped.z < floorConfig.fitMinDepthM) return false
    const projected = projectFloor(mapped, view)
    return projected !== null && projected.x >= floorConfig.fitMargin && projected.x <= 1 - floorConfig.fitMargin
  })
  if (fits(1)) return 1
  let low = 0.05
  let high = 1
  if (!fits(low)) return low
  for (let i = 0; i < 20; i += 1) {
    const middle = (low + high) / 2
    if (fits(middle)) low = middle
    else high = middle
  }
  return low
}

/** `actual` and `target` are learner floor meters, kept so the result can be drawn on a map. */
export type CountPosition = { count: number; errorM: number | null; instruction: string | null; actual?: FloorPoint; target?: FloorPoint }

/**
 * Where the learner stood on each count compared with where they should have been.
 * `targetAt` gives the target in learner floor coordinates at a reference time.
 */
export function reviewPositions(samples: PoseSample[], phrase: Phrase, learnerCamera: Camera, targetAt: (timeSec: number) => FloorPoint | null): CountPosition[] {
  return phrase.counts.map((mark, index) => {
    const endSec = phrase.counts[index + 1]?.timeSec ?? phrase.endSec
    const hit = mark.timeSec + Math.min(0.35, (endSec - mark.timeSec) * 0.6)
    const spots = samples
      .filter((sample) => Math.abs(sample.timeMs / 1000 - hit) <= 0.25)
      .map((sample) => floorPosition(sample.landmarks, learnerCamera, 0.5))
      .filter((point) => point !== null)
    const actual = average(spots)
    const target = targetAt(mark.timeSec)
    if (!actual || !target) return { count: mark.count, errorM: null, instruction: null }
    return { count: mark.count, errorM: Math.hypot(target.x - actual.x, target.z - actual.z), instruction: moveInstruction(actual, target), actual, target }
  })
}
