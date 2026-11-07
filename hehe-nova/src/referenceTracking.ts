import type { HighlightKeyframe, PoseLandmark } from './domain'
import { interpolatePose } from './skeleton'

/*
 * Offline multi-dancer identity tracking for the reference clip.
 *
 * Each sampled frame yields several anonymous MediaPipe poses. A pose is attached to a
 * role track by minimizing a joint cost over all tracks at once:
 *   - motion: distance from the track's velocity-predicted hip center, in torso lengths;
 *   - scale: change in apparent torso length (depth changes slowly);
 *   - appearance: clothing color sampled from the torso and thighs.
 * Appearance is what keeps identities stable when dancers cross or pass behind each other.
 */

export type Rgb = [number, number, number]

/** Median clothing colors in [0,1]; a region is null when its joints were not reliable. */
export type Appearance = { torso: Rgb | null; legs: Rgb | null }

export type ReferenceDetection = {
  center: { x: number; y: number }
  scale: number
  radius: number
  landmarks: PoseLandmark[]
  appearance?: Appearance
}

export type ReferenceTrackFrame = HighlightKeyframe & {
  /** Hip-to-shoulder length in normalized video units. */
  scale: number
  landmarks: PoseLandmark[]
}

export type ReferenceTrack = {
  id: string
  frames: ReferenceTrackFrame[]
  appearance?: Appearance
}

export const trackingConfig = {
  minVisibility: 0.35,
  /** Cost charged for leaving a track unmatched in a frame; matches costing more are rejected. */
  unmatchedCost: 2.2,
  motionWeight: 0.55,
  scaleWeight: 0.8,
  appearanceWeight: 5,
  /** Appearance model update rate, applied only to clean, unambiguous matches. */
  appearanceRate: 0.08,
  /** Two poses whose shoulders and hips are this close, in torso lengths, are one dancer seen twice. */
  duplicateRadius: 0.35,
  /** Once a track knows its clothing, a pose dressed this differently can never join it. */
  maxAppearanceDistance: 0.2,
  /** Interpolate a track across gaps up to this long; longer gaps hide the figure. */
  maxInterpolationGapSec: 0.45,
}

function visible(landmark: PoseLandmark | undefined) {
  return Boolean(landmark && landmark.visibility >= trackingConfig.minVisibility)
}

const meanVisibility = (landmarks: PoseLandmark[]) => landmarks.reduce((sum, landmark) => sum + landmark.visibility, 0) / Math.max(1, landmarks.length)

export function detectionFromLandmarks(landmarks: PoseLandmark[], appearance?: Appearance): ReferenceDetection | null {
  const leftHip = landmarks[23]
  const rightHip = landmarks[24]
  const leftShoulder = landmarks[11]
  const rightShoulder = landmarks[12]
  if (![leftHip, rightHip, leftShoulder, rightShoulder].every(visible)) return null
  const center = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 }
  const shoulderCenter = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 }
  const scale = Math.max(0.01, Math.hypot(center.x - shoulderCenter.x, center.y - shoulderCenter.y))
  return { center, scale, radius: Math.max(0.055, Math.min(0.18, scale * 1.7)), landmarks, appearance }
}

const TORSO_JOINTS = [11, 12, 23, 24]

/**
 * Drop poses that repeat a better-scoring pose. The same dancer is found by the full-frame pass
 * and by overlapping crops; overlapping dancers stay separate because their torsos, depth, and
 * clothing differ.
 */
export function dedupeDetections(detections: ReferenceDetection[]): ReferenceDetection[] {
  const ranked = [...detections].sort((a, b) => meanVisibility(b.landmarks) - meanVisibility(a.landmarks))
  const kept: ReferenceDetection[] = []
  const torsoGap = (a: ReferenceDetection, b: ReferenceDetection) => TORSO_JOINTS.reduce((sum, joint) => sum + Math.hypot(a.landmarks[joint].x - b.landmarks[joint].x, a.landmarks[joint].y - b.landmarks[joint].y), 0) / TORSO_JOINTS.length
  for (const detection of ranked) {
    const duplicate = kept.some((other) => torsoGap(other, detection) < trackingConfig.duplicateRadius * Math.min(other.scale, detection.scale)
      && Math.abs(Math.log(other.scale / detection.scale)) < 0.3
      && (appearanceDistance(other.appearance, detection.appearance) ?? 0) < 0.15)
    if (!duplicate) kept.push(detection)
  }
  return kept
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Median clothing color for the torso (inside the shoulder–hip quad) and thighs.
 * `pixel` returns RGB in [0,1] for a normalized video point, or null outside the frame.
 */
export function sampleAppearance(landmarks: PoseLandmark[], pixel: (x: number, y: number) => Rgb | null): Appearance {
  const median = (samples: Rgb[]): Rgb | null => {
    if (samples.length < 3) return null
    return [0, 1, 2].map((channel) => {
      const sorted = samples.map((sample) => sample[channel]).sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }) as Rgb
  }
  const collect = (points: { x: number; y: number }[]) => points.map((point) => pixel(point.x, point.y)).filter((value): value is Rgb => value !== null)

  let torso: Rgb | null = null
  const [ls, rs, lh, rh] = [landmarks[11], landmarks[12], landmarks[23], landmarks[24]]
  if ([ls, rs, lh, rh].every(visible)) {
    const points: { x: number; y: number }[] = []
    for (const v of [0.2, 0.4, 0.6]) {
      const left = { x: lerp(ls.x, lh.x, v), y: lerp(ls.y, lh.y, v) }
      const right = { x: lerp(rs.x, rh.x, v), y: lerp(rs.y, rh.y, v) }
      for (const u of [0.3, 0.5, 0.7]) points.push({ x: lerp(left.x, right.x, u), y: lerp(left.y, right.y, u) })
    }
    torso = median(collect(points))
  }

  const legPoints: { x: number; y: number }[] = []
  for (const [hip, knee] of [[23, 25], [24, 26]] as const) {
    if (!visible(landmarks[hip]) || !visible(landmarks[knee])) continue
    for (const t of [0.3, 0.5, 0.7]) legPoints.push({ x: lerp(landmarks[hip].x, landmarks[knee].x, t), y: lerp(landmarks[hip].y, landmarks[knee].y, t) })
  }
  return { torso, legs: median(collect(legPoints)) }
}

const rgbDistance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.sqrt(3)

/** Mean color distance over regions both appearances share, in [0,1]; null when nothing is comparable. */
export function appearanceDistance(a: Appearance | undefined, b: Appearance | undefined): number | null {
  if (!a || !b) return null
  const parts: number[] = []
  if (a.torso && b.torso) parts.push(rgbDistance(a.torso, b.torso))
  if (a.legs && b.legs) parts.push(rgbDistance(a.legs, b.legs))
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : null
}

function blendAppearance(model: Appearance | undefined, observed: Appearance, rate: number): Appearance {
  const mix = (a: Rgb | null | undefined, b: Rgb | null): Rgb | null => {
    if (!a) return b
    if (!b) return a
    return [lerp(a[0], b[0], rate), lerp(a[1], b[1], rate), lerp(a[2], b[2], rate)]
  }
  return { torso: mix(model?.torso, observed.torso), legs: mix(model?.legs, observed.legs) }
}

function predictedCenter(frames: ReferenceTrackFrame[], timeSec: number) {
  const last = frames.at(-1)!
  const previous = frames.at(-2)
  if (!previous || last.timeSec - previous.timeSec <= 0) return last.center
  // Velocity extrapolation is capped so a long gap cannot fling the prediction off-screen.
  const ahead = Math.min(timeSec - last.timeSec, 0.3) / (last.timeSec - previous.timeSec)
  return { x: last.center.x + (last.center.x - previous.center.x) * ahead, y: last.center.y + (last.center.y - previous.center.y) * ahead }
}

export function assignmentCost(track: ReferenceTrack, detection: ReferenceDetection, timeSec = track.frames.at(-1)!.timeSec): number {
  const last = track.frames.at(-1)!
  const predicted = predictedCenter(track.frames, timeSec)
  const lastScale = Math.max(last.scale, 0.01)
  const gapSec = Math.max(0, timeSec - last.timeSec)
  // Allow more travel after a longer gap before motion dominates the cost.
  const motion = Math.hypot(predicted.x - detection.center.x, predicted.y - detection.center.y) / Math.max(lastScale, 0.04) / (1 + gapSec * 2)
  const scaleChange = Math.abs(Math.log(detection.scale / lastScale))
  const appearance = appearanceDistance(track.appearance, detection.appearance)
  if (appearance !== null && appearance > trackingConfig.maxAppearanceDistance) return Infinity
  return trackingConfig.motionWeight * motion + trackingConfig.scaleWeight * scaleChange + trackingConfig.appearanceWeight * (appearance ?? 0.15)
}

/** Exhaustive minimum-cost matching; role and dancer counts are small, so this stays cheap and exact. */
function bestAssignment(costs: number[][], detectionCount: number): (number | null)[] {
  let best: (number | null)[] = costs.map(() => null)
  let bestCost = Infinity
  const used = new Set<number>()
  const current: (number | null)[] = []
  const search = (trackIndex: number, total: number) => {
    if (total >= bestCost) return
    if (trackIndex === costs.length) {
      bestCost = total
      best = [...current]
      return
    }
    for (let detectionIndex = 0; detectionIndex < detectionCount; detectionIndex += 1) {
      const cost = costs[trackIndex][detectionIndex]
      if (used.has(detectionIndex) || cost > trackingConfig.unmatchedCost) continue
      used.add(detectionIndex)
      current.push(detectionIndex)
      search(trackIndex + 1, total + cost)
      current.pop()
      used.delete(detectionIndex)
    }
    current.push(null)
    search(trackIndex + 1, total + trackingConfig.unmatchedCost)
    current.pop()
  }
  search(0, 0)
  return best
}

const toFrame = (detection: ReferenceDetection, timeSec: number): ReferenceTrackFrame => ({ timeSec, center: detection.center, radius: detection.radius, scale: detection.scale, landmarks: detection.landmarks })

export function appendTrackedFrame(
  tracks: ReferenceTrack[],
  rawDetections: ReferenceDetection[],
  timeSec: number,
  roleIds: string[],
): ReferenceTrack[] {
  const detections = dedupeDetections(rawDetections)
  if (tracks.length === 0) {
    return [...detections]
      .sort((a, b) => a.center.x - b.center.x)
      .slice(0, roleIds.length)
      .map((detection, index) => ({ id: roleIds[index], frames: [toFrame(detection, timeSec)], appearance: detection.appearance }))
  }

  const next = tracks.map((track) => ({ ...track, frames: [...track.frames] }))
  const costs = tracks.map((track) => detections.map((detection) => assignmentCost(track, detection, timeSec)))
  const assignment = bestAssignment(costs, detections.length)
  const claimed = new Set<number>()

  assignment.forEach((detectionIndex, trackIndex) => {
    if (detectionIndex === null) return
    claimed.add(detectionIndex)
    const detection = detections[detectionIndex]
    const track = next[trackIndex]
    track.frames.push(toFrame(detection, timeSec))
    // Only learn appearance from clean frames: a nearby dancer can bleed into the color samples.
    const isolated = detections.every((other, index) => index === detectionIndex || Math.hypot(other.center.x - detection.center.x, other.center.y - detection.center.y) > 2.5 * detection.scale)
    if (detection.appearance && isolated) track.appearance = blendAppearance(track.appearance, detection.appearance, trackingConfig.appearanceRate)
  })

  // Dancers who were not visible when tracking began claim the remaining role IDs, left to right.
  const freeIds = roleIds.filter((id) => !next.some((track) => track.id === id))
  const unclaimed = detections.filter((_, index) => !claimed.has(index)).sort((a, b) => a.center.x - b.center.x)
  for (const detection of unclaimed) {
    const id = freeIds.shift()
    if (!id) break
    next.push({ id, frames: [toFrame(detection, timeSec)], appearance: detection.appearance })
  }
  return next
}

/** Swap role labels so `roleId` follows the dancer currently held by `trackIndex`. */
export function reassignRole(tracks: ReferenceTrack[], roleId: string, trackIndex: number): ReferenceTrack[] {
  const target = tracks[trackIndex]
  if (!target || target.id === roleId) return tracks
  return tracks.map((track, index) => {
    if (index === trackIndex) return { ...track, id: roleId }
    if (track.id === roleId) return { ...track, id: target.id }
    return track
  })
}

export function nearestTrackFrame(track: ReferenceTrack | undefined, timeSec: number) {
  return track?.frames.reduce<ReferenceTrackFrame | undefined>((best, frame) => !best || Math.abs(frame.timeSec - timeSec) < Math.abs(best.timeSec - timeSec) ? frame : best, undefined)
}

/** The tracked pose at an arbitrary playback time, interpolated between samples; null inside long gaps. */
export function poseAt(track: ReferenceTrack, timeSec: number): PoseLandmark[] | null {
  const frames = track.frames
  if (!frames.length) return null
  let low = 0
  let high = frames.length - 1
  if (timeSec <= frames[0].timeSec) return frames[0].timeSec - timeSec <= 0.1 ? frames[0].landmarks : null
  if (timeSec >= frames[high].timeSec) return timeSec - frames[high].timeSec <= 0.1 ? frames[high].landmarks : null
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (frames[middle].timeSec <= timeSec) low = middle
    else high = middle
  }
  const before = frames[low]
  const after = frames[high]
  const gap = after.timeSec - before.timeSec
  if (gap > trackingConfig.maxInterpolationGapSec) {
    if (timeSec - before.timeSec <= 0.1) return before.landmarks
    if (after.timeSec - timeSec <= 0.1) return after.landmarks
    return null
  }
  return interpolatePose(before.landmarks, after.landmarks, (timeSec - before.timeSec) / Math.max(gap, 1e-6))
}

/** A sub-rectangle of the frame in normalized coordinates. */
export type Crop = { x: number; y: number; width: number; height: number }

/**
 * The full frame plus overlapping squares along its long side. The pose detector shrinks its
 * input to a small square, so dancers far from the camera are only found reliably in a crop.
 */
export function analysisCrops(videoWidth: number, videoHeight: number): Crop[] {
  const crops: Crop[] = [{ x: 0, y: 0, width: 1, height: 1 }]
  const landscape = videoWidth >= videoHeight
  const ratio = landscape ? videoWidth / videoHeight : videoHeight / videoWidth
  if (ratio < 1.2) return crops
  const count = Math.ceil(ratio * 1.5)
  const side = 1 / ratio
  for (let index = 0; index < count; index += 1) {
    const offset = (1 - side) * index / (count - 1)
    crops.push(landscape ? { x: offset, y: 0, width: side, height: 1 } : { x: 0, y: offset, width: 1, height: side })
  }
  return crops
}

/**
 * Map crop-relative landmarks back to the full frame. Returns null for a pose cut off by an
 * interior crop edge; a neighboring crop sees that dancer whole.
 */
export function landmarksFromCrop(landmarks: PoseLandmark[], crop: Crop): PoseLandmark[] | null {
  const hipX = (landmarks[23].x + landmarks[24].x) / 2
  const hipY = (landmarks[23].y + landmarks[24].y) / 2
  const margin = 0.08
  if ((crop.x > 0 && hipX < margin) || (crop.x + crop.width < 1 && hipX > 1 - margin)) return null
  if ((crop.y > 0 && hipY < margin) || (crop.y + crop.height < 1 && hipY > 1 - margin)) return null
  return landmarks.map((landmark) => ({ ...landmark, x: crop.x + landmark.x * crop.width, y: crop.y + landmark.y * crop.height }))
}

/** Tracks seen recently but with no plausible pose in this frame's detections. */
export function missingTracks(tracks: ReferenceTrack[], detections: ReferenceDetection[], timeSec: number, maxAgeSec = 1.5): ReferenceTrack[] {
  return tracks.filter((track) => {
    const last = track.frames.at(-1)
    if (!last || timeSec - last.timeSec > maxAgeSec) return false
    return !detections.some((detection) => {
      const near = Math.hypot(detection.center.x - last.center.x, detection.center.y - last.center.y) < 1.5 * last.scale
      const looks = appearanceDistance(track.appearance, detection.appearance)
      return near && (looks === null || looks <= trackingConfig.maxAppearanceDistance)
    })
  })
}

/**
 * A square crop centered on a track's last hip position, about five torso lengths across, so a
 * small or partly hidden dancer fills the detector input.
 */
export function focusCrop(frame: ReferenceTrackFrame, videoWidth: number, videoHeight: number): Crop {
  const sidePx = Math.min(videoWidth, videoHeight, Math.max(frame.scale * videoHeight * 5, videoHeight * 0.3))
  const width = sidePx / videoWidth
  const height = sidePx / videoHeight
  const x = Math.min(Math.max(frame.center.x - width / 2, 0), 1 - width)
  const y = Math.min(Math.max(frame.center.y - height / 2, 0), 1 - height)
  return { x, y, width, height }
}
