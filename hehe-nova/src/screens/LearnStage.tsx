import { useEffect, useRef } from 'react'
import { drawTrail, type Trail } from '../trailDrawing'
import { poseAt, type ReferenceTrack } from '../referenceTracking'
import { drawSkeleton, prepareCanvas, videoContentRect } from '../skeleton'

/** Same colors as the Pick role screen: the learner's dancer in the role accent, everyone else grey. */
const youColor = '#ffe600'
const otherColor = '#626262'

type LearnStageProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  tracks: ReferenceTrack[]
  roleId: string
  showOthers: boolean
  /** Flip the drawing so the dancer moves like the learner's reflection. The video element is flipped with CSS. */
  mirrored: boolean
  trail?: Trail
}

/**
 * Skeletons and the selected dancer's foot path, redrawn every frame from the video clock so
 * they stay locked to playback, seeking, and slow motion. Coordinates stay unmirrored in the data
 * and are only flipped when drawn.
 */
export function LearnStage({ videoRef, tracks, roleId, showOthers, mirrored, trail }: LearnStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ tracks, roleId, showOthers, mirrored, trail })
  useEffect(() => { propsRef.current = { tracks, roleId, showOthers, mirrored, trail } })

  useEffect(() => {
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas) return
      const ctx = prepareCanvas(canvas)
      if (!ctx || !video || !video.videoWidth) return
      const { tracks, roleId, showOthers, mirrored, trail } = propsRef.current
      const rect = videoContentRect(video)
      const time = video.currentTime
      if (trail && time >= trail.startSec - 0.5 && time <= trail.endSec + 0.5) {
        const flip = <T extends { x: number; y: number }>(point: T) => (mirrored ? { ...point, x: 1 - point.x } : point)
        drawTrail(ctx, rect, { ...trail, points: trail.points.map(flip), marks: trail.marks.map((mark) => ({ ...mark, point: flip(mark.point) })) })
      }
      // The learner's dancer is drawn last so it stays on top of overlapping figures.
      const ordered = [...tracks].sort((a, b) => Number(a.id === roleId) - Number(b.id === roleId))
      for (const track of ordered) {
        const mine = track.id === roleId
        if (!mine && !showOthers) continue
        const landmarks = poseAt(track, time)
        if (!landmarks) continue
        drawSkeleton(ctx, landmarks, rect, { color: mine ? youColor : otherColor, emphasis: mine, mirrored, label: mine ? 'You' : undefined })
      }
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [videoRef])

  return <canvas ref={canvasRef} className="learn-stage-canvas" />
}
