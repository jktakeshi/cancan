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
export type Appearance = { torso: Rgb | null; legs: Rgb | null; shins?: Rgb | null }

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
  /** Which unambiguous stretch (tracklet) this frame came from; manual fixes move whole stretches. */
  segment?: number
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
  /** Mean confidence of shoulders, hips, knees, and ankles needed to accept a detection. */
  minBodyVisibility: 0.45,
  /** Candidate tracks kept during analysis, per expected dancer, before the best are chosen. */
  candidatesPerDancer: 2,
  /** A dancer moves: tracks whose limbs and hips barely move (bags, chairs) are dropped. */
  minMotion: 0.35,
  /** Fragments of one dancer separated by up to this long are stitched together. */
  stitchGapSec: 2.5,
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
  if (!plausibleBody(landmarks)) return null
  const center = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 }
  const shoulderCenter = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 }
  const scale = Math.max(0.01, Math.hypot(center.x - shoulderCenter.x, center.y - shoulderCenter.y))
  return { center, scale, radius: Math.max(0.055, Math.min(0.18, scale * 1.7)), landmarks, appearance }
}

/**
 * Reject detections that are not a person: bags, chairs, and reflections often get a pose with
 * weak leg confidence or impossible proportions (checked in normalized image units).
 */
export function plausibleBody(landmarks: PoseLandmark[]) {
  const core = [11, 12, 23, 24, 25, 26, 27, 28]
  if (meanVisibility(core.map((index) => landmarks[index])) < trackingConfig.minBodyVisibility) return false
  const mid = (a: PoseLandmark, b: PoseLandmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const shoulder = mid(landmarks[11], landmarks[12])
  const hip = mid(landmarks[23], landmarks[24])
  const ankle = mid(landmarks[27], landmarks[28])
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
  if (torso < 0.015) return false
  const leg = Math.hypot(hip.x - ankle.x, hip.y - ankle.y) / torso
  const shoulders = Math.hypot(landmarks[11].x - landmarks[12].x, landmarks[11].y - landmarks[12].y) / torso
  // Legs between ~0.6 and 3 torso lengths (crouching to fully extended); shoulders narrower than ~1.4 torsos.
  return leg > 0.6 && leg < 3 && shoulders < 1.4
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
  // Shins and shoes separate otherwise similar outfits (e.g. white vs black pants).
  const shinPoints: { x: number; y: number }[] = []
  for (const [knee, ankle] of [[25, 27], [26, 28]] as const) {
    if (!visible(landmarks[knee]) || !visible(landmarks[ankle])) continue
    for (const t of [0.35, 0.6, 0.85]) shinPoints.push({ x: lerp(landmarks[knee].x, landmarks[ankle].x, t), y: lerp(landmarks[knee].y, landmarks[ankle].y, t) })
  }
  return { torso, legs: median(collect(legPoints)), shins: median(collect(shinPoints)) }
}

const rgbDistance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.sqrt(3)

/** Mean color distance over regions both appearances share, in [0,1]; null when nothing is comparable. */
export function appearanceDistance(a: Appearance | undefined, b: Appearance | undefined): number | null {
  if (!a || !b) return null
  const parts: number[] = []
  if (a.torso && b.torso) parts.push(rgbDistance(a.torso, b.torso))
  if (a.legs && b.legs) parts.push(rgbDistance(a.legs, b.legs))
  if (a.shins && b.shins) parts.push(rgbDistance(a.shins, b.shins))
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : null
}

function blendAppearance(model: Appearance | undefined, observed: Appearance, rate: number): Appearance {
  const mix = (a: Rgb | null | undefined, b: Rgb | null): Rgb | null => {
    if (!a) return b
    if (!b) return a
    return [lerp(a[0], b[0], rate), lerp(a[1], b[1], rate), lerp(a[2], b[2], rate)]
  }
  return { torso: mix(model?.torso, observed.torso), legs: mix(model?.legs, observed.legs), shins: mix(model?.shins, observed.shins ?? null) }
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

/**
 * Minimum-cost assignment of tracks to detections (Hungarian algorithm, O(n³)), where any track
 * may instead stay unmatched for `unmatchedCost`. Scales to a dozen or more dancers.
 */
export function bestAssignment(costs: number[][], detectionCount: number): (number | null)[] {
  const tracks = costs.length
  if (!tracks) return []
  // Square matrix: real detections, then one "stay unmatched" column per track.
  const size = tracks + detectionCount
  const blocked = 1e9
  const cost = (row: number, column: number) => {
    if (row >= tracks) return 0
    if (column < detectionCount) {
      const value = costs[row][column]
      return Number.isFinite(value) && value <= trackingConfig.unmatchedCost ? value : blocked
    }
    return column - detectionCount === row ? trackingConfig.unmatchedCost : blocked
  }
  // Jonker-style potentials formulation, 1-indexed.
  const u = new Float64Array(size + 1)
  const v = new Float64Array(size + 1)
  const owner = new Int32Array(size + 1)
  const way = new Int32Array(size + 1)
  for (let row = 1; row <= size; row += 1) {
    owner[0] = row
    let column0 = 0
    const minimum = new Float64Array(size + 1).fill(Infinity)
    const used = new Uint8Array(size + 1)
    do {
      used[column0] = 1
      const row0 = owner[column0]
      let delta = Infinity
      let column1 = 0
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue
        const reduced = cost(row0 - 1, column - 1) - u[row0] - v[column]
        if (reduced < minimum[column]) { minimum[column] = reduced; way[column] = column0 }
        if (minimum[column] < delta) { delta = minimum[column]; column1 = column }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) { u[owner[column]] += delta; v[column] -= delta } else minimum[column] -= delta
      }
      column0 = column1
    } while (owner[column0] !== 0)
    do {
      const column1 = way[column0]
      owner[column0] = owner[column1]
      column0 = column1
    } while (column0)
  }
  const result: (number | null)[] = new Array(tracks).fill(null)
  for (let column = 1; column <= size; column += 1) {
    const row = owner[column] - 1
    if (row >= 0 && row < tracks && column - 1 < detectionCount && cost(row, column - 1) < blocked) result[row] = column - 1
  }
  return result
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

  // New people start candidate tracks; `finalizeTracks` later keeps the real dancers. A cap keeps a
  // flood of false detections from slowing tracking down.
  const unclaimed = detections.filter((_, index) => !claimed.has(index)).sort((a, b) => a.center.x - b.center.x)
  const cap = Math.max(roleIds.length, roleIds.length * trackingConfig.candidatesPerDancer)
  for (const detection of unclaimed) {
    if (next.length >= cap) break
    const id = roleIds.find((roleId) => !next.some((track) => track.id === roleId)) ?? `candidate-${next.length + 1}`
    next.push({ id, frames: [toFrame(detection, timeSec)], appearance: detection.appearance })
  }
  return next
}

/**
 * Manual fix at one moment: the stretch of `trackIndex` that contains `timeSec` (one unambiguous
 * tracklet) becomes `roleId`. Whatever `roleId` held during that stretch moves to the other track,
 * so both people stay correct outside the stretch. Without segment data, whole tracks swap.
 */
export function reassignSegment(tracks: ReferenceTrack[], roleId: string, trackIndex: number, timeSec: number): ReferenceTrack[] {
  const source = tracks[trackIndex]
  if (!source) return tracks
  const nearest = source.frames.reduce<ReferenceTrackFrame | undefined>((best, frame) => (!best || Math.abs(frame.timeSec - timeSec) < Math.abs(best.timeSec - timeSec) ? frame : best), undefined)
  if (source.id === roleId || nearest?.segment === undefined) return reassignRole(tracks, roleId, trackIndex)
  const moving = source.frames.filter((frame) => frame.segment === nearest.segment)
  const start = moving[0].timeSec
  const end = moving.at(-1)!.timeSec
  const targetIndex = tracks.findIndex((track) => track.id === roleId)
  const displaced = targetIndex >= 0 ? tracks[targetIndex].frames.filter((frame) => frame.timeSec >= start && frame.timeSec <= end) : []
  const byTime = (a: ReferenceTrackFrame, b: ReferenceTrackFrame) => a.timeSec - b.timeSec
  return tracks.map((track, index) => {
    if (index === trackIndex) return { ...track, frames: [...track.frames.filter((frame) => frame.segment !== nearest.segment), ...displaced].sort(byTime) }
    if (index === targetIndex) return { ...track, frames: [...track.frames.filter((frame) => frame.timeSec < start || frame.timeSec > end), ...moving].sort(byTime) }
    return track
  })
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

/** How much a track moves: 90th-percentile limb-plus-hip speed in torso lengths per second. */
export function trackMotion(track: ReferenceTrack): number {
  const speeds: number[] = []
  for (let i = 1; i < track.frames.length; i += 1) {
    const a = track.frames[i - 1]
    const b = track.frames[i]
    const dt = b.timeSec - a.timeSec
    if (dt <= 0 || dt > 0.5) continue
    let sum = 0
    for (const joint of [15, 16, 27, 28, 23, 24]) sum += Math.hypot(b.landmarks[joint].x - a.landmarks[joint].x, b.landmarks[joint].y - a.landmarks[joint].y)
    speeds.push(sum / 6 / Math.max(a.scale, 0.01) / dt)
  }
  if (speeds.length < 3) return 0
  const sorted = speeds.sort((x, y) => x - y)
  return sorted[Math.floor(sorted.length * 0.9)]
}

/** Join fragments of the same dancer that were split by a gap in detection. */
export function stitchTracks(tracks: ReferenceTrack[]): ReferenceTrack[] {
  const pieces = tracks.map((track) => ({ ...track, frames: [...track.frames] }))
  for (;;) {
    let best: { from: number; to: number; cost: number } | null = null
    pieces.forEach((a, i) => pieces.forEach((b, j) => {
      if (i === j || !a.frames.length || !b.frames.length) return
      const end = a.frames.at(-1)!
      const start = b.frames[0]
      const gap = start.timeSec - end.timeSec
      if (gap <= 0 || gap > trackingConfig.stitchGapSec) return
      const distance = Math.hypot(start.center.x - end.center.x, start.center.y - end.center.y) / Math.max(end.scale, 0.02)
      const looks = appearanceDistance(a.appearance, b.appearance) ?? 0.15
      if (distance > 2 + gap * 3 || looks > trackingConfig.maxAppearanceDistance) return
      const cost = distance / (1 + gap) + 5 * looks + gap
      if (!best || cost < best.cost) best = { from: i, to: j, cost }
    }))
    if (!best) return pieces.filter((piece) => piece.frames.length)
    const { from, to } = best as { from: number; to: number }
    pieces[from].frames.push(...pieces[to].frames)
    pieces[to].frames = []
  }
}

/**
 * Turn raw candidate tracks into the dancers: stitch fragments, drop things that never move
 * (bags on the side, chairs), keep the `roleIds.length` best-covered tracks, and number them left
 * to right as seen when (nearly) all of them are visible early in the clip.
 */
export function finalizeTracks(tracks: ReferenceTrack[], roleIds: string[]): ReferenceTrack[] {
  const stitched = stitchTracks(tracks)
  const moving = stitched.filter((track) => trackMotion(track) >= trackingConfig.minMotion)
  const kept = (moving.length ? moving : stitched).sort((a, b) => b.frames.length - a.frames.length).slice(0, roleIds.length)
  if (!kept.length) return []
  const times = [...new Set(kept.flatMap((track) => track.frames.map((frame) => frame.timeSec)))].sort((a, b) => a - b)
  const visibleAt = (time: number) => kept.filter((track) => track.frames.some((frame) => Math.abs(frame.timeSec - time) < 0.08)).length
  const target = Math.max(1, kept.length - 1)
  const reference = times.find((time) => visibleAt(time) >= target) ?? times[0]
  const xAt = (track: ReferenceTrack) => track.frames.reduce((best, frame) => (Math.abs(frame.timeSec - reference) < Math.abs(best.timeSec - reference) ? frame : best)).center.x
  return kept
    .sort((a, b) => xAt(a) - xAt(b))
    .map((track, index) => ({ ...track, frames: [...track.frames].sort((a, b) => a.timeSec - b.timeSec), id: roleIds[index] }))
}

/* ---------------------------------------------------------------- top-down detection -------- */

/** A person box in normalized frame coordinates, with the detector's confidence. */
export type PersonBox = { x: number; y: number; width: number; height: number; score: number }

const boxIou = (a: PersonBox, b: PersonBox) => {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return intersection / (a.width * a.height + b.width * b.height - intersection)
}

/** Keep the best-scoring box among overlapping duplicates from different detector passes. */
export function mergeBoxes(boxes: PersonBox[], iou = 0.5): PersonBox[] {
  const kept: PersonBox[] = []
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) if (!kept.some((other) => boxIou(other, box) > iou)) kept.push(box)
  return kept
}

/**
 * Person-detector passes: the full frame plus two overlapping halves, so people far from the
 * camera are large enough to be found.
 */
export function personRegions(videoWidth: number, videoHeight: number): Crop[] {
  if (videoWidth < videoHeight * 1.2) return [{ x: 0, y: 0, width: 1, height: 1 }]
  return [{ x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0.15, width: 0.55, height: 0.85 }, { x: 0.45, y: 0.15, width: 0.55, height: 0.85 }]
}

/** A square crop around one person box, padded so the whole body and some context are inside. */
export function poseCropForBox(box: PersonBox, videoWidth: number, videoHeight: number): Crop {
  const sidePx = Math.min(Math.max(box.width * videoWidth, box.height * videoHeight) * 1.25, videoWidth, videoHeight)
  const width = sidePx / videoWidth
  const height = sidePx / videoHeight
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return { x: Math.min(Math.max(cx - width / 2, 0), 1 - width), y: Math.min(Math.max(cy - height / 2, 0), 1 - height), width, height }
}

/**
 * Of the poses found in a box's crop (possibly including a neighbor), the one belonging to the box:
 * its hips inside the box and most of its visible joints within it.
 */
export function poseForBox(poses: PoseLandmark[][], box: PersonBox): PoseLandmark[] | null {
  let best: { pose: PoseLandmark[]; score: number } | null = null
  const margin = { x: box.width * 0.15, y: box.height * 0.1 }
  const inside = (p: PoseLandmark) => p.x >= box.x - margin.x && p.x <= box.x + box.width + margin.x && p.y >= box.y - margin.y && p.y <= box.y + box.height + margin.y
  for (const pose of poses) {
    const hip = { x: (pose[23].x + pose[24].x) / 2, y: (pose[23].y + pose[24].y) / 2, z: 0, visibility: 1 }
    if (!inside(hip)) continue
    const joints = pose.filter((p) => p.visibility >= 0.5)
    const score = joints.filter(inside).length / Math.max(1, joints.length) - Math.abs(hip.x - (box.x + box.width / 2)) / box.width
    if (!best || score > best.score) best = { pose, score }
  }
  return best?.pose ?? null
}
