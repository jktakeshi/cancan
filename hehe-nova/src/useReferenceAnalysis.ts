import { FilesetResolver, ObjectDetector, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { useCallback, useRef, useState } from 'react'
import type { PoseLandmark } from './domain'
import { cameraFor, floorConfig } from './floor'
import { identifyDancers, type DetectionFrame } from './offlineTracking'
import { appendTrackedFrame, dedupeDetections, detectionFromLandmarks, finalizeTracks, mergeBoxes, personRegions, poseCropForBox, poseForBox, reassignSegment, sampleAppearance, type Crop, type PersonBox, type ReferenceDetection, type ReferenceTrack, type Rgb } from './referenceTracking'

/*
 * Reference analysis runs once, offline, over the whole clip. It is top-down: a person detector
 * (EfficientDet, trained on crowded COCO scenes) finds every body, then the Full pose model runs
 * on each person's crop. The pose model's own person finder misses most of a large group.
 * Live practice keeps the Lite pose model.
 */
export const referenceAnalysisConfig = {
  modelAssetPath: '/models/pose_landmarker_full.task',
  personModelPath: '/models/efficientdet_lite2.tflite',
  /** Person boxes below this confidence are ignored (bags and chairs score lower). */
  minPersonScore: 0.3,
  stepSec: 0.15,
  /** Bump when analysis output changes, so stale cached results are ignored. */
  cacheVersion: 6,
  /** Pixels across each person crop handed to the pose model. */
  cropSize: 384,
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

type Models = { persons: ObjectDetector; poses: PoseLandmarker; delegate: 'GPU' | 'CPU' }

async function createModels(): Promise<Models> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  // IMAGE mode: every crop is an independent picture, so no cross-frame tracking state.
  const create = async (delegate: 'GPU' | 'CPU') => ({
    persons: await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: referenceAnalysisConfig.personModelPath, delegate },
      runningMode: 'IMAGE',
      categoryAllowlist: ['person'],
      scoreThreshold: referenceAnalysisConfig.minPersonScore,
      maxResults: 40,
    }),
    // Two poses per crop: a neighbor may share the crop, and poseForBox picks the right one.
    poses: await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: referenceAnalysisConfig.modelAssetPath, delegate },
      runningMode: 'IMAGE',
      numPoses: 2,
      minPoseDetectionConfidence: 0.15,
      minPosePresenceConfidence: 0.15,
    }),
    delegate,
  })
  try {
    return await create('GPU')
  } catch {
    return create('CPU')
  }
}

/* Finished analyses are cached per video and dancer count, so a clip is only analyzed once. */
const CACHE_DB = 'hehe-reference-analysis'
const CACHE_STORE = 'tracks'

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function cacheGet(key: string): Promise<ReferenceTrack[] | null> {
  try {
    const db = await openCache()
    return await new Promise((resolve) => {
      const request = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(key)
      request.onsuccess = () => resolve((request.result as ReferenceTrack[] | undefined) ?? null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function cachePut(key: string, tracks: ReferenceTrack[]) {
  try {
    const db = await openCache()
    db.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put(tracks, key)
  } catch {
    // Caching is a convenience; analysis results are still used without it.
  }
}

export function useReferenceAnalysis() {
  const modelsRef = useRef<Models | null>(null)
  const [tracks, setTracks] = useState<ReferenceTrack[]>([])
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | null>(null)
  const [remainingSec, setRemainingSec] = useState<number | null>(null)
  const runRef = useRef(0)

  const analyze = useCallback(async (source: HTMLVideoElement, roleIds: string[], options: { force?: boolean } = {}) => {
    // A newer request (e.g. a changed dancer count) cancels the one in progress.
    const run = ++runRef.current
    setStatus('analyzing')
    setProgress(0)
    setRemainingSec(null)
    setError('')
    try {
      if (!Number.isFinite(source.duration) || source.duration <= 0) throw new Error('The reference video metadata is not ready.')
      const cacheKey = `${source.currentSrc}|${roleIds.length}|v${referenceAnalysisConfig.cacheVersion}`
      const cached = options.force ? null : await cacheGet(cacheKey)
      if (run !== runRef.current) return
      if (cached?.length) {
        setTracks(cached)
        setProgress(100)
        setStatus('done')
        return
      }
      modelsRef.current ??= await createModels()
      const models = modelsRef.current
      setDelegate(models.delegate)
      const regions = personRegions(source.videoWidth, source.videoHeight)
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
      const frames: DetectionFrame[] = []
      setTracks([])
      const { stepSec, cropSize } = referenceAnalysisConfig
      const started = performance.now()
      for (let timeSec = 0; timeSec <= source.duration; timeSec += stepSec) {
        if (run !== runRef.current) return
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

        /** Draw a frame region into the work canvas, `size` pixels on its long side. */
        const drawRegion = (crop: Crop, size: number) => {
          const sourceWidth = crop.width * source.videoWidth
          const sourceHeight = crop.height * source.videoHeight
          const scale = size / Math.max(sourceWidth, sourceHeight)
          cropCanvas.width = Math.round(sourceWidth * scale)
          cropCanvas.height = Math.round(sourceHeight * scale)
          cropCtx.drawImage(source, crop.x * source.videoWidth, crop.y * source.videoHeight, sourceWidth, sourceHeight, 0, 0, cropCanvas.width, cropCanvas.height)
        }

        // 1. Every person in the frame.
        const boxes: PersonBox[] = []
        for (const region of regions) {
          drawRegion(region, Math.max(source.videoWidth * region.width, source.videoHeight * region.height))
          for (const found of models.persons.detect(cropCanvas).detections) {
            const box = found.boundingBox
            if (!box) continue
            boxes.push({
              x: region.x + box.originX / cropCanvas.width * region.width,
              y: region.y + box.originY / cropCanvas.height * region.height,
              width: box.width / cropCanvas.width * region.width,
              height: box.height / cropCanvas.height * region.height,
              score: found.categories[0]?.score ?? 0,
            })
          }
        }

        // 2. One pose per person, from a crop around that person's box.
        const detections: ReferenceDetection[] = []
        for (const box of mergeBoxes(boxes)) {
          const crop = poseCropForBox(box, source.videoWidth, source.videoHeight)
          drawRegion(crop, cropSize)
          const poses = models.poses.detect(cropCanvas).landmarks.map((landmarks) => convert(landmarks).map((point) => ({ ...point, x: crop.x + point.x * crop.width, y: crop.y + point.y * crop.height })))
          const pose = poseForBox(poses, box)
          const detection = pose && detectionFromLandmarks(pose, sampleAppearance(pose, pixel))
          if (detection) detections.push(detection)
        }
        frames.push({ timeSec, detections: dedupeDetections(detections) })
        // The online tracker only drives the live preview; final identities come from the offline
        // linker once every frame has been seen.
        nextTracks = appendTrackedFrame(nextTracks, detections, timeSec, roleIds)
        const fraction = Math.min(1, timeSec / source.duration)
        setProgress(Math.round(fraction * 100))
        if (fraction > 0.03) setRemainingSec((performance.now() - started) / 1000 * (1 - fraction) / fraction)
        // Publish partial results every second of video so figures appear while scanning continues.
        if (Math.round(timeSec / stepSec) % Math.round(1 / stepSec) === 0) setTracks(finalizeTracks(nextTracks, roleIds))
      }
      const finished = identifyDancers(frames, roleIds, cameraFor(source.videoWidth, source.videoHeight, floorConfig.referenceHfovDeg), stepSec)
      setTracks(finished)
      void cachePut(cacheKey, finished)
      setProgress(100)
      setStatus('done')
      source.currentTime = 0
      if (!wasPaused) void source.play()
    } catch (caught) {
      if (run !== runRef.current) return
      setError(caught instanceof Error ? caught.message : 'Reference analysis failed.')
      setStatus('error')
    }
  }, [])

  /**
   * Manual correction: the dancer held by `trackIndex` at `timeSec` is really `roleId`. Only the
   * unambiguous stretch around that moment moves, so earlier fixes elsewhere are kept.
   */
  const assignRole = useCallback((roleId: string, trackIndex: number, timeSec: number) => {
    setTracks((current) => reassignSegment(current, roleId, trackIndex, timeSec))
  }, [])

  return { analyze, assignRole, tracks, progress, status, error, delegate, remainingSec }
}
