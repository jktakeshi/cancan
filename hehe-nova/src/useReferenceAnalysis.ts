import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { useCallback, useRef, useState } from 'react'
import type { PoseLandmark } from './domain'
import { analysisCrops, appendTrackedFrame, detectionFromLandmarks, focusCrop, landmarksFromCrop, missingTracks, reassignRole, sampleAppearance, type Crop, type ReferenceDetection, type ReferenceTrack, type Rgb } from './referenceTracking'

/*
 * Reference analysis runs once, offline, over the whole clip, so it can afford the larger
 * Full model and several detector passes per frame; live practice keeps the Lite model.
 */
export const referenceAnalysisConfig = {
  modelAssetPath: '/models/pose_landmarker_full.task',
  stepSec: 0.1,
  /** Pixels across each square crop handed to the detector. */
  cropSize: 512,
  /** Pixels across the downscaled frame used for clothing-color sampling. */
  sampleWidth: 320,
}

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

async function createDetector(numPoses: number) {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  // IMAGE mode: every crop is an independent picture, so no cross-frame landmark tracking state.
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: referenceAnalysisConfig.modelAssetPath, delegate },
    runningMode: 'IMAGE' as const,
    numPoses,
    minPoseDetectionConfidence: 0.15,
    minPosePresenceConfidence: 0.15,
  })
  try {
    return { detector: await PoseLandmarker.createFromOptions(fileset, options('GPU')), delegate: 'GPU' as const }
  } catch {
    return { detector: await PoseLandmarker.createFromOptions(fileset, options('CPU')), delegate: 'CPU' as const }
  }
}

export function useReferenceAnalysis() {
  const detectorRef = useRef<{ detector: PoseLandmarker; numPoses: number; delegate: 'GPU' | 'CPU' } | null>(null)
  const [tracks, setTracks] = useState<ReferenceTrack[]>([])
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | null>(null)

  const analyze = useCallback(async (source: HTMLVideoElement, roleIds: string[]) => {
    setStatus('analyzing')
    setProgress(0)
    setError('')
    try {
      if (!Number.isFinite(source.duration) || source.duration <= 0) throw new Error('The reference video metadata is not ready.')
      const numPoses = roleIds.length + 1
      if (detectorRef.current?.numPoses !== numPoses) {
        detectorRef.current?.detector.close()
        detectorRef.current = { ...await createDetector(numPoses), numPoses }
      }
      setDelegate(detectorRef.current.delegate)
      const { detector } = detectorRef.current

      const crops = analysisCrops(source.videoWidth, source.videoHeight)
      const cropCanvas = document.createElement('canvas')
      const cropCtx = cropCanvas.getContext('2d')
      const sampleCanvas = document.createElement('canvas')
      sampleCanvas.width = referenceAnalysisConfig.sampleWidth
      sampleCanvas.height = Math.max(1, Math.round(referenceAnalysisConfig.sampleWidth * source.videoHeight / Math.max(1, source.videoWidth)))
      const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
      if (!cropCtx || !sampleCtx) throw new Error('Canvas is unavailable for reference analysis.')

      const wasPaused = source.paused
      source.pause()
      let nextTracks: ReferenceTrack[] = []
      setTracks([])
      const { stepSec, cropSize } = referenceAnalysisConfig
      for (let timeSec = 0; timeSec <= source.duration; timeSec += stepSec) {
        await seek(source, Math.min(timeSec, Math.max(0, source.duration - 0.01)))

        sampleCtx.drawImage(source, 0, 0, sampleCanvas.width, sampleCanvas.height)
        const { data, width, height } = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height)
        const pixel = (x: number, y: number): Rgb | null => {
          const column = Math.round(x * (width - 1))
          const row = Math.round(y * (height - 1))
          if (column < 0 || row < 0 || column >= width || row >= height) return null
          const offset = (row * width + column) * 4
          return [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255]
        }

        const detectIn = (crop: Crop): ReferenceDetection[] => {
          const sourceWidth = crop.width * source.videoWidth
          const sourceHeight = crop.height * source.videoHeight
          // Upscaling small focus crops is deliberate: it is what makes distant dancers detectable.
          const scale = cropSize / Math.max(sourceWidth, sourceHeight)
          cropCanvas.width = Math.round(sourceWidth * scale)
          cropCanvas.height = Math.round(sourceHeight * scale)
          cropCtx.drawImage(source, crop.x * source.videoWidth, crop.y * source.videoHeight, sourceWidth, sourceHeight, 0, 0, cropCanvas.width, cropCanvas.height)
          return detector.detect(cropCanvas).landmarks
            .map((landmarks) => landmarksFromCrop(convert(landmarks), crop))
            .filter((value) => value !== null)
            .map((landmarks) => detectionFromLandmarks(landmarks, sampleAppearance(landmarks, pixel)))
            .filter((value) => value !== null)
        }

        const detections = crops.flatMap(detectIn)
        // Second chance for dancers the wide passes missed: look again exactly where they were.
        for (const track of missingTracks(nextTracks, detections, timeSec)) {
          detections.push(...detectIn(focusCrop(track.frames.at(-1)!, source.videoWidth, source.videoHeight)))
        }
        nextTracks = appendTrackedFrame(nextTracks, detections, timeSec, roleIds)
        setProgress(Math.min(100, Math.round(timeSec / source.duration * 100)))
        // Publish partial results so figures appear while the rest of the clip is still scanned.
        setTracks(nextTracks)
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

  /** Manual correction: make `roleId` follow the dancer held by `trackIndex` for the whole clip. */
  const assignRole = useCallback((roleId: string, trackIndex: number) => {
    setTracks((current) => reassignRole(current, roleId, trackIndex))
  }, [])

  return { analyze, assignRole, tracks, progress, status, error, delegate }
}
