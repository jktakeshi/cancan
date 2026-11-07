import { useEffect, useRef } from 'react'
import type { PoseSample } from './domain'
import { poseAt, type ReferenceTrack } from './referenceTracking'
import { drawSkeleton, prepareCanvas, videoContentRect, type ContentRect } from './skeleton'

type RoleStyle = { id: string; label: string; color: string }

type VideoRef = React.RefObject<HTMLVideoElement | null>

/** The selected dancer's foot path for the phrase, with count numbers where each beat lands. */
export type Trail = {
  color: string
  points: { x: number; y: number }[]
  marks: { point: { x: number; y: number }; label: string }[]
  /** The phrase the path belongs to; it is only drawn while playback is inside it. */
  startSec: number
  endSec: number
}

function drawTrail(ctx: CanvasRenderingContext2D, rect: ContentRect, trail: Trail) {
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

type ReferenceOverlayProps = {
  videoRef: VideoRef
  tracks: ReferenceTrack[]
  roles: RoleStyle[]
  selectedRoleId: string
  trail?: Trail
  /** When set, the overlay captures clicks and reports the tracked dancer nearest the click. */
  onPickDancer?: (trackIndex: number) => void
}

/**
 * Stick figures for every tracked dancer in the reference clip, redrawn every animation frame
 * from the video's own clock so they stay locked to playback, seeking, and slow motion.
 */
export function ReferenceOverlay({ videoRef, tracks, roles, selectedRoleId, trail, onPickDancer }: ReferenceOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ tracks, roles, selectedRoleId, trail })
  useEffect(() => { propsRef.current = { tracks, roles, selectedRoleId, trail } })

  useEffect(() => {
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const canvas = canvasRef.current
      const { tracks, roles, selectedRoleId, trail } = propsRef.current
      const video = videoRef.current
      if (!canvas) return
      const ctx = prepareCanvas(canvas)
      if (!ctx || !video || !video.videoWidth) return
      const rect = videoContentRect(video)
      const time = video.currentTime
      if (trail && time >= trail.startSec - 0.5 && time <= trail.endSec + 0.5) drawTrail(ctx, rect, trail)
      const ordered = [...tracks].sort((a, b) => Number(a.id === selectedRoleId) - Number(b.id === selectedRoleId))
      for (const track of ordered) {
        const landmarks = poseAt(track, time)
        const role = roles.find((item) => item.id === track.id)
        if (!landmarks || !role) continue
        const emphasis = track.id === selectedRoleId
        drawSkeleton(ctx, landmarks, rect, { color: role.color, emphasis, label: emphasis ? role.label : role.label.replace(/^Dancer /, '') })
      }
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [videoRef])

  const pick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const video = videoRef.current
    if (!onPickDancer || !video) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const rect = videoContentRect(video)
    const x = (event.clientX - bounds.left - rect.left) / rect.width
    const y = (event.clientY - bounds.top - rect.top) / rect.height
    let best: { index: number; distance: number } | null = null
    tracks.forEach((track, index) => {
      const landmarks = poseAt(track, video.currentTime)
      if (!landmarks) return
      // Distance to the closest body joint, so clicking anywhere on a figure selects it.
      const distance = Math.min(...[0, 11, 12, 23, 24, 25, 26, 27, 28].map((joint) => Math.hypot(landmarks[joint].x - x, (landmarks[joint].y - y) * rect.height / rect.width)))
      if (!best || distance < best.distance) best = { index, distance }
    })
    const chosen = best as { index: number; distance: number } | null
    if (chosen && chosen.distance < 0.12) onPickDancer(chosen.index)
  }

  return <canvas ref={canvasRef} className={`pose-overlay ${onPickDancer ? 'picking' : ''}`} onClick={pick} />
}

/** The learner's live or prerecorded pose, drawn over the practice video. */
export function SampleOverlay({ videoRef, sample, color, mirrored }: { videoRef: VideoRef; sample: PoseSample | null; color: string; mirrored: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas)
    if (!ctx || !video || !sample?.landmarks.length) return
    drawSkeleton(ctx, sample.landmarks, videoContentRect(video), { color, emphasis: true, mirrored, minVisibility: 0.5 })
  }, [videoRef, sample, color, mirrored])
  return <canvas ref={canvasRef} className="pose-overlay" />
}
