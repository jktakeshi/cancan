import { useEffect, useMemo, useState } from 'react'
import { decodeMonoAudio } from './audioDecode'
import { analyzeBeats, buildCountGrid, phrasesFromGrid, type BeatAnalysis, type GridOverrides } from './beatTracking'
import type { Phrase, RoleTarget } from './domain'
import { motionEnergy, poseDeviation } from './movement'
import type { ReferenceTrack } from './referenceTracking'

const ANALYSIS_SAMPLE_RATE = 22050
const MOTION_STEP_SEC = 0.1

async function decodeMono(url: string): Promise<Float32Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load the reference audio (${response.status}).`)
  return decodeMonoAudio(await response.arrayBuffer(), ANALYSIS_SAMPLE_RATE)
}

/**
 * Detects the music beat from the reference audio, then chooses the dance-count grid (count
 * rate and count 1) from the dancers' movement once reference tracking has finished.
 */
export function useCountGrid(url: string, tracks: ReferenceTrack[], tracksReady: boolean, duration: number, aspect: number, roles: RoleTarget[], overrides: GridOverrides) {
  const [beats, setBeats] = useState<{ url: string; analysis: BeatAnalysis } | { url: string; error: string } | null>(null)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    decodeMono(url)
      .then((samples) => { if (!cancelled) setBeats({ url, analysis: analyzeBeats(samples, ANALYSIS_SAMPLE_RATE) }) })
      .catch((caught: unknown) => { if (!cancelled) setBeats({ url, error: caught instanceof Error ? caught.message : 'Beat detection failed.' }) })
    return () => { cancelled = true }
  }, [url])

  const current = beats?.url === url ? beats : null
  const analysis = current && 'analysis' in current ? current.analysis : null

  // The music alone gives a full count grid right away; tracked movement refines where the dance
  // starts once dancers are detected.
  const grid = useMemo(() => {
    if (!analysis || !(duration > 0)) return null
    if (!tracksReady) return buildCountGrid(analysis.beats, [], MOTION_STEP_SEC, duration, overrides, [], analysis.accents)
    return buildCountGrid(analysis.beats, motionEnergy(tracks, duration, aspect, MOTION_STEP_SEC), MOTION_STEP_SEC, duration, overrides, poseDeviation(tracks, duration, aspect, MOTION_STEP_SEC), analysis.accents)
  }, [analysis, tracks, tracksReady, duration, aspect, overrides])

  const phrases: Phrase[] | null = useMemo(() => (grid ? phrasesFromGrid(grid, roles, duration) : null), [grid, roles, duration])

  return {
    bpm: analysis?.bpm ?? null,
    grid,
    phrases,
    status: !url ? 'idle' as const : !current ? 'listening' as const : 'error' in current ? 'error' as const : grid ? 'done' as const : 'waiting-for-dancers' as const,
    error: current && 'error' in current ? current.error : '',
  }
}
