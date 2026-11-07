import type { Phrase, PoseLandmark, RoleTarget } from './domain'
import { floorConfig, placeOnFloor, projectFloor, toLearnerFloor, trackFloorAt, type Camera, type FloorMapping, type FloorPoint, type LearnerView } from './floor'
import { poseAt, type ReferenceTrack } from './referenceTracking'
import { drawSkeleton, type ContentRect } from './skeleton'

/*
 * Floor markings drawn onto the webcam (AR). The reference formation is placed in the learner's
 * room through a FloorMapping, so the selected role's path starts at the learner's own start spot
 * and the other dancers keep their positions relative to that role.
 */

export type Dancer = { track: ReferenceTrack; role: RoleTarget }
type PathPoint = { timeSec: number; point: FloorPoint }

/** The role's reference floor path over a phrase, sampled for drawing. */
export function rolePath(track: ReferenceTrack, phrase: Phrase, camera: Camera, stepSec = 0.2): PathPoint[] {
  const path: PathPoint[] = []
  for (let time = phrase.startSec; time <= phrase.endSec + 1e-9; time += stepSec) {
    const point = trackFloorAt(track, time, camera)
    if (point) path.push({ timeSec: time, point })
  }
  return path
}

type GuideInput = {
  rect: ContentRect
  view: LearnerView
  mapping: FloorMapping
  referenceCamera: Camera
  phrase: Phrase
  time: number
  self: Dancer
  path: PathPoint[]
  others: Dancer[]
  learnerSpot: FloorPoint | null
  mirrored: boolean
}

/** Draw the role's path, count spots, current target, and the other dancers onto the webcam floor. */
export function drawFloorGuide(ctx: CanvasRenderingContext2D, input: GuideInput) {
  const { rect, view, mapping, referenceCamera, phrase, time, self, path, others, learnerSpot, mirrored } = input
  const toCanvas = (point: FloorPoint) => {
    const normalized = projectFloor(point, view)
    if (!normalized) return null
    return { x: rect.left + (mirrored ? 1 - normalized.x : normalized.x) * rect.width, y: rect.top + normalized.y * rect.height }
  }
  const ellipse = (point: FloorPoint, radiusM: number) => {
    const center = toCanvas(point)
    if (!center) return null
    const rx = view.camera.fx * radiusM / point.z / view.camera.width * rect.width
    const ry = rx * Math.min(1, Math.max(0.15, view.heightM / point.z))
    ctx.beginPath()
    ctx.ellipse(center.x, center.y, rx, ry, 0, 0, Math.PI * 2)
    return center
  }

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Path still to dance (bright) and already danced (faint).
  const learnerPath = path.map((item) => ({ ...item, point: toLearnerFloor(item.point, mapping) }))
  for (const past of [true, false]) {
    ctx.beginPath()
    let started = false
    for (const item of learnerPath) {
      if ((item.timeSec < time) !== past) continue
      const p = toCanvas(item.point)
      if (!p) { started = false; continue }
      if (started) ctx.lineTo(p.x, p.y)
      else { ctx.moveTo(p.x, p.y); started = true }
    }
    ctx.setLineDash([12, 8])
    ctx.lineWidth = past ? 3 : 5
    ctx.strokeStyle = past ? 'rgba(255,255,255,0.25)' : self.role.color
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Numbered spot for every count.
  ctx.font = '800 13px Inter, ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const mark of phrase.counts) {
    const reference = trackFloorAt(self.track, mark.timeSec, referenceCamera)
    if (!reference) continue
    const center = ellipse(toLearnerFloor(reference, mapping), 0.09)
    if (!center) continue
    const upcoming = mark.timeSec >= time - 0.1
    ctx.fillStyle = upcoming ? self.role.color : 'rgba(255,255,255,0.3)'
    ctx.fill()
    ctx.fillStyle = '#111'
    ctx.fillText(String(mark.count), center.x, center.y)
  }

  // Other dancers stand where they are relative to the learner's role; draw far ones first.
  const placed = others
    .map((dancer) => ({ dancer, reference: trackFloorAt(dancer.track, time, referenceCamera) }))
    .filter((item): item is { dancer: Dancer; reference: FloorPoint } => item.reference !== null)
    .map((item) => ({ ...item, spot: toLearnerFloor(item.reference, mapping) }))
    .sort((a, b) => b.spot.z - a.spot.z)
  for (const { dancer, spot } of placed) {
    if (ellipse(spot, 0.3)) {
      ctx.fillStyle = `${dancer.role.color}44`
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = dancer.role.color
      ctx.stroke()
    }
    const pose = poseAt(dancer.track, time)
    const ghost = pose && placeOnFloor(pose, referenceCamera, spot, view)
    if (ghost) drawSkeleton(ctx, ghost, rect, { color: dancer.role.color, emphasis: false, mirrored, minVisibility: 0.3, alpha: 0.6, label: dancer.role.label })
  }

  // Where the learner should be right now.
  const now = trackFloorAt(self.track, time, referenceCamera)
  if (now) {
    const target = toLearnerFloor(now, mapping)
    const center = ellipse(target, 0.32)
    if (center) {
      ctx.fillStyle = `${self.role.color}55`
      ctx.fill()
      ctx.lineWidth = 4
      ctx.strokeStyle = self.role.color
      ctx.stroke()
    }
    if (learnerSpot) {
      const from = toCanvas(learnerSpot)
      if (from && center && Math.hypot(target.x - learnerSpot.x, target.z - learnerSpot.z) > 0.3) {
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(center.x, center.y)
        ctx.lineWidth = 3
        ctx.strokeStyle = '#ffffff'
        ctx.setLineDash([4, 6])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }
  if (learnerSpot && ellipse(learnerSpot, 0.22)) {
    ctx.lineWidth = 3
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }
  ctx.restore()
}


export const HOLOGRAM_GREY = '#b9b9c2'
export const TARGET_COLOR = '#4dff88'

type HologramInput = {
  rect: ContentRect
  view: LearnerView
  referenceCamera: Camera
  mirrored: boolean
  /** Other dancers' spots in the learner's room, with a pose to stand there (grey). */
  others: { label: string; spot: FloorPoint; pose: PoseLandmark[] | null }[]
  target: FloorPoint
  /** The learner's spot in the upcoming formation, when a change is coming. */
  next: FloorPoint | null
  learnerSpot: FloorPoint | null
  /** 0–1 pulse phase for the target ring. */
  pulse: number
}

/**
 * Formation hologram: grey dancers on their formation spots, the learner's own spot highlighted,
 * and arrows from where the learner stands to the spot (and on to the next formation's spot).
 */
export function drawFormationHologram(ctx: CanvasRenderingContext2D, input: HologramInput) {
  const { rect, view, referenceCamera, mirrored, others, target, next, learnerSpot, pulse } = input
  const toCanvas = (point: FloorPoint) => {
    const normalized = projectFloor(point, view)
    if (!normalized) return null
    return { x: rect.left + (mirrored ? 1 - normalized.x : normalized.x) * rect.width, y: rect.top + normalized.y * rect.height }
  }
  const ellipse = (point: FloorPoint, radiusM: number) => {
    const center = toCanvas(point)
    if (!center) return null
    const rx = view.camera.fx * radiusM / point.z / view.camera.width * rect.width
    const ry = rx * Math.min(1, Math.max(0.15, view.heightM / point.z))
    ctx.beginPath()
    ctx.ellipse(center.x, center.y, rx, ry, 0, 0, Math.PI * 2)
    return center
  }
  const arrow = (from: FloorPoint, to: FloorPoint, color: string, dashed: boolean) => {
    const a = toCanvas(from)
    const b = toCanvas(to)
    if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 24) return
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const tip = { x: b.x - Math.cos(angle) * 10, y: b.y - Math.sin(angle) * 10 }
    for (const [width, stroke] of [[9, 'rgba(10,10,14,0.7)'], [5, color]] as const) {
      ctx.beginPath()
      ctx.setLineDash(dashed ? [10, 8] : [])
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(tip.x, tip.y)
      ctx.lineWidth = width
      ctx.strokeStyle = stroke
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - Math.cos(angle - 0.45) * 22, b.y - Math.sin(angle - 0.45) * 22)
    ctx.lineTo(b.x - Math.cos(angle + 0.45) * 22, b.y - Math.sin(angle + 0.45) * 22)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(10,10,14,0.7)'
    ctx.stroke()
  }

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.font = '800 12px Inter, ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (next && ellipse(next, 0.32)) {
    ctx.setLineDash([8, 6])
    ctx.lineWidth = 3
    ctx.strokeStyle = TARGET_COLOR
    ctx.stroke()
    ctx.setLineDash([])
    const label = toCanvas(next)
    if (label) { ctx.fillStyle = TARGET_COLOR; ctx.fillText('NEXT', label.x, label.y) }
  }

  // Your spot: filled and pulsing so it stands out from the grey dancers.
  const center = ellipse(target, 0.32 + 0.05 * Math.sin(pulse * Math.PI * 2))
  if (center) {
    ctx.fillStyle = `${TARGET_COLOR}55`
    ctx.fill()
    ctx.lineWidth = 4
    ctx.strokeStyle = TARGET_COLOR
    ctx.stroke()
    ctx.fillStyle = '#111'
    ctx.fillText('YOUR SPOT', center.x, center.y)
  }

  // Grey dancers, far ones first so near ones overlap them.
  for (const dancer of [...others].sort((a, b) => b.spot.z - a.spot.z)) {
    const spot = ellipse(dancer.spot, 0.28)
    if (spot) {
      ctx.fillStyle = 'rgba(185,185,194,0.22)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = HOLOGRAM_GREY
      ctx.stroke()
    }
    const ghost = dancer.pose && placeOnFloor(dancer.pose, referenceCamera, dancer.spot, view)
    if (ghost) drawSkeleton(ctx, ghost, rect, { color: HOLOGRAM_GREY, emphasis: false, mirrored, minVisibility: 0.3, alpha: 0.55, label: dancer.label })
    else if (spot) { ctx.fillStyle = HOLOGRAM_GREY; ctx.fillText(dancer.label, spot.x, spot.y) }
  }

  if (learnerSpot && Math.hypot(target.x - learnerSpot.x, target.z - learnerSpot.z) > floorConfig.onSpotMeters) arrow(learnerSpot, target, TARGET_COLOR, false)
  if (next && Math.hypot(next.x - target.x, next.z - target.z) > floorConfig.onSpotMeters) arrow(target, next, TARGET_COLOR, true)
  if (learnerSpot && ellipse(learnerSpot, 0.2)) {
    ctx.lineWidth = 3
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }
  ctx.restore()
}
