import { useEffect, useMemo, useRef, useState } from 'react'
import type { GridOverrides } from './beatTracking'
import { demoManifest } from './demoData'
import { cameraFor, fitGroundModel, floorConfig, groundObservations } from './floor'
import type { Rehearsal } from './rehearsals'
import { makeRoles } from './roles'
import { useCountGrid } from './useCountGrid'
import { useReferenceAnalysis } from './useReferenceAnalysis'

/** The manifest says how many dancers the bundled video has; uploads start from this and can change it. */
export const defaultDancerCount = demoManifest.dancerCount ?? 12

export type ReferenceMeta = { duration: number; aspect: number; width: number; height: number }

/**
 * Everything derived from one rehearsal video that the learning screens share: tracked dancers,
 * roles, and the count grid. Analysis runs on a private, offscreen video element so each screen
 * can show its own player without the analysis seeking it. Results are cached per video and
 * dancer count in IndexedDB, so the original Workbench page reuses them instantly.
 */
export function useRehearsalSession(rehearsal: Rehearsal) {
  const referenceAnalysis = useReferenceAnalysis()
  const [dancerCount, setDancerCount] = useState(defaultDancerCount)
  const roles = useMemo(() => makeRoles(dancerCount), [dancerCount])
  const [meta, setMeta] = useState<ReferenceMeta>({ duration: 0, aspect: 16 / 9, width: 1280, height: 720 })
  // The bundled clip's count 1 and count 8 were checked by ear; uploads start from detection.
  const [gridOverrides, setGridOverrides] = useState<GridOverrides>(() => (rehearsal.source === 'bundled' && demoManifest.countAnchors ? { ...demoManifest.countAnchors } : {}))
  const [loadError, setLoadError] = useState('')
  const analysisVideoRef = useRef<HTMLVideoElement | null>(null)
  const { analyze } = referenceAnalysis

  // One offscreen video per rehearsal, created once and released when the session ends.
  useEffect(() => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    analysisVideoRef.current = video
    let started = false
    video.onloadedmetadata = () => setMeta({ duration: video.duration, aspect: video.videoWidth / Math.max(1, video.videoHeight), width: video.videoWidth, height: video.videoHeight })
    video.onloadeddata = () => {
      if (started) return
      started = true
      void analyze(video, makeRoles(defaultDancerCount).map((role) => role.id))
    }
    video.onerror = () => setLoadError('This video could not be loaded for analysis.')
    video.src = rehearsal.url
    return () => {
      video.onloadeddata = null
      video.removeAttribute('src')
      video.load()
      analysisVideoRef.current = null
    }
  }, [rehearsal.url, analyze])

  const changeDancerCount = (next: number) => {
    const count = Math.max(1, Math.min(24, Math.round(next) || 1))
    setDancerCount(count)
    const video = analysisVideoRef.current
    if (video && video.readyState >= 1) void analyze(video, makeRoles(count).map((role) => role.id))
  }

  const redetect = () => {
    const video = analysisVideoRef.current
    if (video && video.readyState >= 1) void analyze(video, roles.map((role) => role.id), { force: true })
  }

  // A static camera can be calibrated from the dancers themselves (see GroundModel in floor.ts).
  const referenceCamera = useMemo(() => {
    const camera = cameraFor(meta.width, meta.height, floorConfig.referenceHfovDeg)
    if (referenceAnalysis.status !== 'done') return camera
    const ground = fitGroundModel(groundObservations(referenceAnalysis.tracks, camera))
    return ground ? { ...camera, ground } : camera
  }, [meta.width, meta.height, referenceAnalysis.status, referenceAnalysis.tracks])

  const countGrid = useCountGrid(rehearsal.url, referenceAnalysis.tracks, referenceAnalysis.status === 'done', meta.duration, meta.aspect, roles, gridOverrides, referenceAnalysis.frameMotion)
  // Until the count grid is detected, the manifest's labeled placeholder phrases stand in.
  const phrases = useMemo(() => (countGrid.phrases?.length ? countGrid.phrases : demoManifest.phrases.map((item) => ({ ...item, roles }))), [countGrid.phrases, roles])

  return {
    rehearsal,
    meta,
    referenceCamera,
    loadError,
    analysis: referenceAnalysis,
    dancerCount,
    changeDancerCount,
    redetect,
    roles,
    countGrid,
    phrases,
    phrasesArePlaceholder: !countGrid.phrases?.length,
    gridOverrides,
    setGridOverrides,
  }
}

export type RehearsalSession = ReturnType<typeof useRehearsalSession>
