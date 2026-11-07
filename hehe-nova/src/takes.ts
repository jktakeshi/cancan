import type { Phrase, PoseSample } from './domain'
import { reviewPositions, toLearnerFloor, trackFloorAt, type Camera, type CountPosition, type FloorMapping } from './floor'
import type { TakeReview } from './movement'
import type { ReferenceTrack } from './referenceTracking'
import { scoreBands } from './ui/score'

/**
 * One recorded practice take. The raw samples, the learner camera, and the floor mapping are kept
 * so the same captured movement can be judged again against another dancer's spots without
 * recording or detecting anything again.
 */
export type Take = {
  number: number
  phraseId: string
  roleId: string
  speed: number
  review: TakeReview
  positions: CountPosition[]
  samples: PoseSample[]
  learnerAspect: number
  learnerCamera: Camera
  /** Maps the reference stage into the learner's room, anchored on the learner's start spot. Null when no start spot could be measured. */
  mapping: FloorMapping | null
}

/** Formation summary: on how many judged counts the learner stood on the target spot. */
export function formationSummary(positions: CountPosition[]) {
  const placed = positions.filter((entry) => entry.errorM !== null)
  const onSpot = placed.filter((entry) => !entry.instruction).length
  const worst = placed.length ? placed.reduce((a, b) => (b.errorM! > a.errorM! ? b : a)) : null
  return { placed: placed.length, onSpot, worst }
}

/**
 * Judge the same captured samples against another dancer's spots. The room mapping stays the one
 * made for the learner's own role, so only the target changes.
 */
export function rejudgeFormation(take: Take, phrase: Phrase, track: ReferenceTrack, referenceCamera: Camera): CountPosition[] {
  const mapping = take.mapping
  if (!mapping) return []
  return reviewPositions(take.samples, phrase, take.learnerCamera, (timeSec) => {
    const reference = trackFloorAt(track, timeSec, referenceCamera)
    return reference ? toLearnerFloor(reference, mapping) : null
  })
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/**
 * The one correction to show, in the priority order from AGENTS.md: visibility, timing, movement
 * direction or travel, formation landing, then body shape. Each comes from a measured result; a
 * dimension that could not be measured is skipped rather than guessed. The detail line names the
 * next most useful measured difference.
 */
export function primaryFix(review: TakeReview, positions: CountPosition[]): { fix: string; detail: string } {
  const formation = formationSummary(positions)
  const weakest = review.counts.filter((count) => count.score !== null).reduce<TakeReview['counts'][number] | null>((worst, count) => (!worst || count.score! < worst.score! ? count : worst), null)
  const postureNote = weakest && weakest.score! < scoreBands.mid ? `Body shape: on count ${weakest.count}, ${lowerFirst(weakest.correction)}.` : ''
  const floorNote = formation.worst?.instruction ? `Floor: on count ${formation.worst.count}, ${lowerFirst(formation.worst.instruction)}.` : ''
  const candidates: string[] = []
  if (review.score === null) return { fix: review.headline, detail: '' }
  if (review.timing && !review.timing.startsWith('Timing is on')) candidates.push(review.timing)
  if (review.travel && (review.travel.startsWith('Wrong direction') || review.travel.startsWith('Right direction') || review.travel.includes('you stayed in place') || review.travel.includes('drifted'))) candidates.push(review.travel)
  if (formation.placed && formation.onSpot / formation.placed < 0.75 && formation.worst?.instruction) candidates.push(`On count ${formation.worst.count}, ${lowerFirst(formation.worst.instruction)}.`)
  if (!candidates.length) return { fix: review.headline, detail: floorNote }
  return { fix: candidates[0], detail: [candidates[0].startsWith('On count') ? '' : floorNote, postureNote].filter(Boolean).join(' ') }
}

/* Saved progress: the latest take result per rehearsal, role, and phrase, kept in this browser only. */

export type PhraseProgress = { score: number | null; onSpot: number; placed: number; at: number }
type ProgressStore = Record<string, PhraseProgress>

const storageKey = 'danceCatchup.progress.v1'
const progressKey = (rehearsalId: string, roleId: string, phraseId: string) => `${rehearsalId}|${roleId}|${phraseId}`

function readStore(): ProgressStore {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as ProgressStore) : {}
  } catch {
    // Storage can be unavailable (private windows, blocked site data); progress is then simply not kept.
    return {}
  }
}

export function loadProgress(rehearsalId: string, roleId: string, phraseIds: string[]): Record<string, PhraseProgress> {
  const store = readStore()
  return Object.fromEntries(phraseIds.flatMap((phraseId) => {
    const entry = store[progressKey(rehearsalId, roleId, phraseId)]
    return entry ? [[phraseId, entry]] : []
  }))
}

export function saveProgress(rehearsalId: string, roleId: string, phraseId: string, entry: PhraseProgress) {
  const store = readStore()
  store[progressKey(rehearsalId, roleId, phraseId)] = entry
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(store))
  } catch {
    // Ignored for the same reason as above.
  }
}

export type PhraseStatus = 'solid' | 'progress' | 'none'

export const phraseStatus = (entry: PhraseProgress | undefined): PhraseStatus =>
  !entry || entry.score === null ? 'none' : entry.score >= scoreBands.good ? 'solid' : 'progress'
