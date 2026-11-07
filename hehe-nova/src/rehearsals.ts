import { demoManifest } from './demoData'

/**
 * A rehearsal video the learner can open. Videos never leave the device: an uploaded file is
 * played from an object URL, so it is only available until the page is reloaded.
 */
export type Rehearsal = {
  id: string
  name: string
  url: string
  source: 'bundled' | 'upload'
  addedAt: number
}

/** The team's own rehearsal clip that ships with the app. */
export const bundledRehearsal: Rehearsal | null = demoManifest.frontVideo
  ? { id: 'bundled', name: demoManifest.title, url: demoManifest.frontVideo, source: 'bundled', addedAt: 0 }
  : null

/** Uploads longer than this still load, but the learner is warned because analysis gets slow. */
export const recommendedMaxDurationSec = 180

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** A readable default name from a file name, such as "spring_showcase-2.mov" becoming "spring showcase 2". */
export function nameFromFile(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled rehearsal'
}
