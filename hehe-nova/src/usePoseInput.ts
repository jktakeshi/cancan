import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseLandmark, PoseSample } from './domain'

const TARGET_INTERVAL_MS = 1000 / 15

function toPoseLandmarks(landmarks: NormalizedLandmark[]): PoseLandmark[] {
  return landmarks.map((landmark) => ({ x: landmark.x, y: landmark.y, z: landmark.z, visibility: landmark.visibility ?? 0 }))
}
export function usePoseInput() {
  const detectorRef = useRef<PoseLandmarker | null>(null)
  const frameRef = useRef<number | null>(null)
  const samplesRef = useRef<PoseSample[]>([])
  const [latest, setLatest] = useState<PoseSample | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')

  const initialize = useCallback(async () => {
    if (detectorRef.current) return detectorRef.current
    setStatus('loading')
    try {
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      detectorRef.current = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task' },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
      setStatus('ready')
      return detectorRef.current
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pose detector failed to load.')
      setStatus('error')
      return null
    }
  }, [])

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const start = useCallback(async (video: HTMLVideoElement, clock: () => number) => {
    stop()
    const detector = await initialize()
    if (!detector) return
    let lastMediaTime = -1
    let lastRun = 0
    const loop = () => {
      const now = performance.now()
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastMediaTime && now - lastRun >= TARGET_INTERVAL_MS) {
        lastMediaTime = video.currentTime
        lastRun = now
        const result = detector.detectForVideo(video, now)
        const sample = { timeMs: clock(), landmarks: result.landmarks[0] ? toPoseLandmarks(result.landmarks[0]) : [] }
        samplesRef.current.push(sample)
        setLatest(sample)
      }
      frameRef.current = requestAnimationFrame(loop)
    }
    frameRef.current = requestAnimationFrame(loop)
  }, [initialize, stop])

  const clear = useCallback(() => {
    samplesRef.current = []
    setLatest(null)
  }, [])

  /** Drop buffered samples but keep the live preview; `keep` retains the newest few. */
  const trimSamples = useCallback((keep = 0) => {
    samplesRef.current = keep > 0 ? samplesRef.current.slice(-keep) : []
  }, [])

  useEffect(() => () => {
    stop()
    detectorRef.current?.close()
  }, [stop])

  return { latest, status, error, samplesRef, start, stop, clear, trimSamples }
}

