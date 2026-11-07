import type { Phrase } from './domain'
import { trackFloorAt, type Camera, type FloorPoint } from './floor'
import type { ReferenceTrack } from './referenceTracking'
import type { FormationSketch, StagePoint } from './ui/PhraseCard'

/** Below this travel the role is described as staying in place, since floor positions are only good to a few tens of centimeters. */
const stayThresholdM = 0.4

export type PhraseOverview = {
  sketch: FormationSketch | null
  /** Learner-relative travel summary measured from the role's floor positions. */
  travel: string
}

/**
 * Top-down sketches for every phrase, all on one shared scale so cards can be compared.
 * Floor x points camera-right and z away from the camera. The sketch keeps the audience view:
 * camera-left stays on the left and upstage (far from the camera) is at the top.
 */
export function phraseOverviews(phrases: Phrase[], tracks: ReferenceTrack[], roleId: string, camera: Camera): PhraseOverview[] {
  const at = (track: ReferenceTrack, timeSec: number) => trackFloorAt(track, timeSec, camera)
  const moments = phrases.map((phrase) => ({ start: phrase.startSec, end: Math.max(phrase.startSec, phrase.endSec - 0.1) }))
  const all: FloorPoint[] = []
  for (const track of tracks) for (const moment of moments) {
    const start = at(track, moment.start)
    const end = at(track, moment.end)
    if (start) all.push(start)
    if (end) all.push(end)
  }
  if (!all.length) return phrases.map(() => ({ sketch: null, travel: 'Floor positions appear after dancers are detected.' }))

  const pad = 0.5
  const minX = Math.min(...all.map((p) => p.x)) - pad
  const maxX = Math.max(...all.map((p) => p.x)) + pad
  const minZ = Math.min(...all.map((p) => p.z)) - pad
  const maxZ = Math.max(...all.map((p) => p.z)) + pad
  const toStage = (p: FloorPoint): StagePoint => ({ x: (p.x - minX) / (maxX - minX), y: 1 - (p.z - minZ) / (maxZ - minZ) })
  const self = tracks.find((track) => track.id === roleId)

  return moments.map((moment) => {
    const start = self ? at(self, moment.start) : null
    const end = self ? at(self, moment.end) : null
    const others = tracks.filter((track) => track !== self).map((track) => at(track, moment.end)).filter((p): p is FloorPoint => p !== null).map(toStage)
    return {
      sketch: { others, start: start ? toStage(start) : undefined, end: end ? toStage(end) : undefined },
      travel: start && end ? describeTravel(start, end)
        : start ? 'Your dancer is not tracked clearly by the end of this phrase.'
          : end ? 'Your dancer is not tracked clearly at the start of this phrase.'
            : 'Your dancer is not tracked clearly in this phrase.',
    }
  })
}

/** For a learner facing the camera, camera-right (+x) is their left and away from the camera (+z) is back. */
export function describeTravel(start: FloorPoint, end: FloorPoint) {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const distance = Math.hypot(dx, dz)
  if (distance < stayThresholdM) return 'Stays in about the same spot.'
  const parts: string[] = []
  if (Math.abs(dx) >= stayThresholdM / 2) parts.push(dx > 0 ? 'to your left' : 'to your right')
  if (Math.abs(dz) >= stayThresholdM / 2) parts.push(dz > 0 ? 'back, away from the front' : 'forward, toward the front')
  return `Travels about ${distance.toFixed(1)} m ${parts.join(' and ')}.`
}
