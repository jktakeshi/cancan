import { useEffect, useRef } from 'react'
import type { PoseSample } from './domain'
import { poseAt, type ReferenceTrack } from './referenceTracking'
import { drawSkeleton, prepareCanvas, videoContentRect } from './skeleton'

type RoleStyle = { id: string; label: string; color: string }

type VideoRef = React.RefObject<HTMLVideoElement | null>

type ReferenceOverlayProps = {
  videoRef: VideoRef
  tracks: ReferenceTrack[]
  roles: RoleStyle[]
  selectedRoleId: string
  /** When set, the overlay captures clicks and reports the tracked dancer nearest the click. */
  onPickDancer?: (trackIndex: number) => void
}

/**
 * Stick figures for every tracked dancer in the reference clip, redrawn every animation frame
 * from the video's own clock so they stay locked to playback, seeking, and slow motion.
 */
export function ReferenceOverlay({ videoRef, tracks, roles, selectedRoleId, onPickDancer }: ReferenceOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ tracks, roles, selectedRoleId })
  useEffect(() => { propsRef.current = { tracks, roles, selectedRoleId } })

  useEffect(() => {
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const canvas = canvasRef.current
      const { tracks, roles, selectedRoleId } = propsRef.current
      const video = videoRef.current
      if (!canvas) return
      const ctx = prepareCanvas(canvas)
      if (!ctx || !video || !video.videoWidth) return
      const rect = videoContentRect(video)
      const time = video.currentTime
      const ordered = [...tracks].sort((a, b) => Number(a.id === selectedRoleId) - Number(b.id === selectedRoleId))
      for (const track of ordered) {
        const landmarks = poseAt(track, time)
        const role = roles.find((item) => item.id === track.id)
        if (!landmarks || !role) continue
        const emphasis = track.id === selectedRoleId
        drawSkeleton(ctx, landmarks, rect, { color: role.color, emphasis, label: role.label })
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
