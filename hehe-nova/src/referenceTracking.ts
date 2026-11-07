import type { HighlightKeyframe, PoseLandmark } from './domain'

export type ReferenceDetection = {
  center: { x: number; y: number }
  scale: number
  radius: number
  landmarks: PoseLandmark[]
}

export type ReferenceTrackFrame = HighlightKeyframe & {
  landmarks: PoseLandmark[]
}

export type ReferenceTrack = {
  id: string
  frames: ReferenceTrackFrame[]
}

function visible(landmark: PoseLandmark | undefined) {
  return Boolean(landmark && landmark.visibility >= 0.35)
}

export function detectionFromLandmarks(landmarks: PoseLandmark[]): ReferenceDetection | null {
  const leftHip = landmarks[23]
  const rightHip = landmarks[24]
  const leftShoulder = landmarks[11]
  const rightShoulder = landmarks[12]
  if (![leftHip, rightHip, leftShoulder, rightShoulder].every(visible)) return null
  const center = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 }
  const shoulderCenter = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 }
  const scale = Math.max(0.01, Math.hypot(center.x - shoulderCenter.x, center.y - shoulderCenter.y))
  return { center, scale, radius: Math.max(0.055, Math.min(0.18, scale * 1.7)), landmarks }
}

function predictedCenter(frames: ReferenceTrackFrame[]) {
  const last = frames.at(-1)!
  const previous = frames.at(-2)
  if (!previous) return last.center
  return { x: last.center.x + (last.center.x - previous.center.x), y: last.center.y + (last.center.y - previous.center.y) }
}

function assignmentCost(track: ReferenceTrack, detection: ReferenceDetection) {
  const last = track.frames.at(-1)!
  const predicted = predictedCenter(track.frames)
  const position = Math.hypot(predicted.x - detection.center.x, predicted.y - detection.center.y)
  const lastScale = Math.max(last.radius / 1.7, 0.01)
  const scaleChange = Math.abs(Math.log(detection.scale / lastScale))
  return position + scaleChange * 0.12
}

export function appendTrackedFrame(
  tracks: ReferenceTrack[],
  detections: ReferenceDetection[],
  timeSec: number,
  roleIds: string[],
): ReferenceTrack[] {
  if (tracks.length === 0) {
    return [...detections]
      .sort((a, b) => a.center.x - b.center.x)
      .slice(0, roleIds.length)
      .map((detection, index) => ({ id: roleIds[index], frames: [{ timeSec, center: detection.center, radius: detection.radius, landmarks: detection.landmarks }] }))
  }

  const next = tracks.map((track) => ({ ...track, frames: [...track.frames] }))
  const pairs = tracks.flatMap((track, trackIndex) => detections.map((detection, detectionIndex) => ({ trackIndex, detectionIndex, cost: assignmentCost(track, detection) }))).sort((a, b) => a.cost - b.cost)
  const assignedTracks = new Set<number>()
  const assignedDetections = new Set<number>()
  for (const pair of pairs) {
    if (assignedTracks.has(pair.trackIndex) || assignedDetections.has(pair.detectionIndex)) continue
    if (pair.cost > 0.35) continue
    const detection = detections[pair.detectionIndex]
    next[pair.trackIndex].frames.push({ timeSec, center: detection.center, radius: detection.radius, landmarks: detection.landmarks })
    assignedTracks.add(pair.trackIndex)
    assignedDetections.add(pair.detectionIndex)
  }
  return next
}

export function nearestTrackFrame(track: ReferenceTrack | undefined, timeSec: number) {
  return track?.frames.reduce<ReferenceTrackFrame | undefined>((best, frame) => !best || Math.abs(frame.timeSec - timeSec) < Math.abs(best.timeSec - timeSec) ? frame : best, undefined)
}
