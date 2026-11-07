import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { useCallback, useRef, useState } from 'react'
import type { PoseLandmark } from './domain'
import { appendTrackedFrame, detectionFromLandmarks, type ReferenceTrack } from './referenceTracking'

function convert(landmarks: NormalizedLandmark[]): PoseLandmark[] {
  return landmarks.map((landmark) => ({ x: landmark.x, y: landmark.y, z: landmark.z, visibility: landmark.visibility ?? 0 }))
}

function seek(video: HTMLVideoElement, timeSec: number) {
  return new Promise<void>((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve() }
    video.addEventListener('seeked', done)
    video.currentTime = timeSec
  })
}

export function useReferenceAnalysis() {
  const detectorRef = useRef<PoseLandmarker | null>(null)
  const [tracks, setTracks] = useState<ReferenceTrack[]>([])
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  const analyze = useCallback(async (source: HTMLVideoElement, roleIds: string[]) => {
    setStatus('analyzing')
    setProgress(0)
    setError('')
    try {
      if (!Number.isFinite(source.duration) || source.duration <= 0) throw new Error('The reference video metadata is not ready.')
      if (!detectorRef.current) {
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
        detectorRef.current = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task' },
          runningMode: 'VIDEO',
          numPoses: roleIds.length,
          minPoseDetectionConfidence: 0.35,
          minPosePresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
        })
      }
      const wasPaused = source.paused
      source.pause()
      let nextTracks: ReferenceTrack[] = []
      const stepSec = 0.15
      let timestampMs = 0
      for (let timeSec = 0; timeSec <= source.duration; timeSec += stepSec) {
        await seek(source, Math.min(timeSec, Math.max(0, source.duration - 0.01)))
        const result = detectorRef.current.detectForVideo(source, timestampMs)
        timestampMs += stepSec * 1000
        const detections = result.landmarks.map(convert).map(detectionFromLandmarks).filter((value) => value !== null)
        nextTracks = appendTrackedFrame(nextTracks, detections, timeSec, roleIds)
        setProgress(Math.min(100, Math.round(timeSec / source.duration * 100)))
      }
      setTracks(nextTracks)
      setProgress(100)
      setStatus('done')
      source.currentTime = 0
      if (!wasPaused) void source.play()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reference analysis failed.')
      setStatus('error')
    }
  }, [])

  return { analyze, tracks, progress, status, error }
}
