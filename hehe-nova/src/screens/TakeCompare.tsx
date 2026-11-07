import { useEffect, useRef } from 'react'
import type { PoseLandmark } from '../domain'
import { fitPoseToBox } from '../movement'
import { drawSkeleton, prepareCanvas } from '../skeleton'

const targetColor = '#ffe600'
const learnerColor = '#3de0ff'

type TakeCompareProps = {
  target: PoseLandmark[] | null
  targetAspect: number
  learner: PoseLandmark[] | null
  learnerAspect: number
  mode: 'overlay' | 'side'
}

/**
 * The target pose and the learner's captured pose at one count, both scaled to the same body size.
 * Drawn mirrored so it reads like the learner's reflection.
 */
export function TakeCompare({ target, targetAspect, learner, learnerAspect, mode }: TakeCompareProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = prepareCanvas(canvas)
      if (!ctx) return
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const boxes = mode === 'overlay'
        ? [{ left: 0, top: 0, width, height }, { left: 0, top: 0, width, height }]
        : [{ left: 0, top: 0, width: width / 2, height }, { left: width / 2, top: 0, width: width / 2, height }]
      const fit = (pose: PoseLandmark[] | null, aspect: number, box: typeof boxes[number]) => (pose ? fitPoseToBox(pose, aspect, box.width / Math.max(1, box.height)) : null)
      const fittedTarget = fit(target, targetAspect, boxes[0])
      const fittedLearner = fit(learner, learnerAspect, boxes[1])
      if (fittedTarget) drawSkeleton(ctx, fittedTarget, boxes[0], { color: targetColor, emphasis: true, mirrored: true, minVisibility: 0.2, alpha: mode === 'overlay' ? 0.6 : 1, label: mode === 'side' ? 'Target' : undefined })
      if (fittedLearner) drawSkeleton(ctx, fittedLearner, boxes[1], { color: learnerColor, emphasis: true, mirrored: true, minVisibility: 0.4, label: mode === 'side' ? 'You' : undefined })
    }
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [target, targetAspect, learner, learnerAspect, mode])
  return <canvas ref={canvasRef} className="take-compare" />
}
