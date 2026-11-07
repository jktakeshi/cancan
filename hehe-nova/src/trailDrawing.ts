import type { ContentRect } from './skeleton'

/** The selected dancer's foot path for the phrase, with count numbers where each beat lands. */
export type Trail = {
  color: string
  points: { x: number; y: number }[]
  marks: { point: { x: number; y: number }; label: string }[]
  /** The phrase the path belongs to; it is only drawn while playback is inside it. */
  startSec: number
  endSec: number
}

export function drawTrail(ctx: CanvasRenderingContext2D, rect: ContentRect, trail: Trail) {
  if (trail.points.length < 2) return
  const px = (point: { x: number; y: number }) => [rect.left + point.x * rect.width, rect.top + point.y * rect.height] as const
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  trail.points.forEach((point, index) => (index ? ctx.lineTo(...px(point)) : ctx.moveTo(...px(point))))
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(10, 10, 14, 0.6)'
  ctx.stroke()
  ctx.setLineDash([10, 7])
  ctx.lineWidth = 3
  ctx.strokeStyle = trail.color
  ctx.stroke()
  ctx.setLineDash([])
  ctx.font = '800 11px Inter, ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Counts landing on (nearly) the same spot share one marker, labeled as a range ("1–4").
  const groups: { x: number; y: number; first: string; last: string }[] = []
  for (const mark of trail.marks) {
    const [x, y] = px(mark.point)
    const last = groups.at(-1)
    if (last && Math.hypot(last.x - x, last.y - y) < 20) last.last = mark.label
    else groups.push({ x, y, first: mark.label, last: mark.label })
  }
  for (const group of groups) {
    const mark = { label: group.first === group.last ? group.first : `${group.first}–${group.last}` }
    const [x, y] = [group.x, group.y]
    const radius = Math.max(9, 4 + mark.label.length * 3.5)
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = trail.color
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#111'
    ctx.stroke()
    ctx.fillStyle = '#111'
    ctx.fillText(mark.label, x, y + 0.5)
  }
  ctx.restore()
}
