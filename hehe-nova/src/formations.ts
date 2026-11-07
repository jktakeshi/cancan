import type { FloorPoint } from './floor'

/*
 * Formations learned from the reference video.
 *
 * A formation is a stretch of counts where the group holds its floor positions; travel between
 * holds is a transition. Positions are floor meters (x toward camera-right, z away from the
 * camera), keyed by dancer (track/role) id.
 */

/** Where each tracked dancer stands at one sampled moment (normally every count). */
export type FloorSnapshot = { timeSec: number; positions: Record<string, FloorPoint> }

export type Formation = { name: string; startSec: number; endSec: number; positions: Record<string, FloorPoint> }

export const formationConfig = {
  /** Median travel per count below which the group counts as holding a formation. */
  holdMoveM: 0.3,
  /** A hold must last at least this many consecutive snapshots. */
  minHoldSnapshots: 3,
  /** Neighboring holds closer than this (mean per dancer) are one formation interrupted by noise. */
  mergeDistanceM: 0.35,
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN
}

/** Median travel of dancers seen at both moments, or null when too few are shared. */
function groupTravel(a: FloorSnapshot, b: FloorSnapshot) {
  const shared = Object.keys(a.positions).filter((id) => b.positions[id])
  if (shared.length < 2) return null
  return median(shared.map((id) => Math.hypot(a.positions[id].x - b.positions[id].x, a.positions[id].z - b.positions[id].z)))
}

function medianPositions(snapshots: FloorSnapshot[]): Record<string, FloorPoint> {
  const ids = [...new Set(snapshots.flatMap((snapshot) => Object.keys(snapshot.positions)))]
  return Object.fromEntries(ids.flatMap((id) => {
    const points = snapshots.map((snapshot) => snapshot.positions[id]).filter(Boolean)
    return points.length ? [[id, { x: median(points.map((p) => p.x)), z: median(points.map((p) => p.z)) }]] : []
  }))
}

function meanDistance(a: Record<string, FloorPoint>, b: Record<string, FloorPoint>) {
  const shared = Object.keys(a).filter((id) => b[id])
  if (!shared.length) return Infinity
  return shared.reduce((sum, id) => sum + Math.hypot(a[id].x - b[id].x, a[id].z - b[id].z), 0) / shared.length
}

/** Find formation holds in a sequence of snapshots (sorted by time). */
export function formationsFromSnapshots(snapshots: FloorSnapshot[]): Formation[] {
  const still = snapshots.map((snapshot, index) => {
    const next = snapshots[index + 1]
    const previous = snapshots[index - 1]
    const forward = next ? groupTravel(snapshot, next) : null
    const backward = previous ? groupTravel(previous, snapshot) : null
    const values = [forward, backward].filter((value): value is number => value !== null)
    return values.length > 0 && Math.min(...values) <= formationConfig.holdMoveM
  })

  const runs: FloorSnapshot[][] = []
  let current: FloorSnapshot[] = []
  snapshots.forEach((snapshot, index) => {
    if (still[index]) current.push(snapshot)
    else { if (current.length) runs.push(current); current = [] }
  })
  if (current.length) runs.push(current)

  const holds = runs
    .filter((run) => run.length >= formationConfig.minHoldSnapshots)
    .map((run) => ({ startSec: run[0].timeSec, endSec: run.at(-1)!.timeSec, positions: medianPositions(run) }))

  const merged: typeof holds = []
  for (const hold of holds) {
    const last = merged.at(-1)
    if (last && meanDistance(last.positions, hold.positions) < formationConfig.mergeDistanceM) {
      last.endSec = hold.endSec
      // Keep every dancer seen in either part of the hold.
      last.positions = { ...hold.positions, ...last.positions }
    } else merged.push({ ...hold })
  }
  return merged.map((hold, index) => ({ name: `Formation ${index + 1}`, ...hold }))
}

export type FormationState = {
  positions: Record<string, FloorPoint>
  /** Index of the formation being held or left. */
  from: number
  /** Index of the formation being held or approached (equal to `from` while holding). */
  to: number
  /** 0–1 through a transition; 1 while holding. */
  progress: number
  /** The next formation after the current moment, if any. */
  next: Formation | null
}

/**
 * Every dancer's position at a time. Between holds, positions move linearly from the end of one
 * formation to the start of the next, which shows the travel path.
 */
export function formationPositionsAt(timeSec: number, formations: Formation[]): FormationState | null {
  if (!formations.length) return null
  const holding = formations.findIndex((formation) => timeSec >= formation.startSec && timeSec <= formation.endSec)
  if (holding >= 0) return { positions: formations[holding].positions, from: holding, to: holding, progress: 1, next: formations[holding + 1] ?? null }
  const nextIndex = formations.findIndex((formation) => formation.startSec > timeSec)
  if (nextIndex === 0) return { positions: formations[0].positions, from: 0, to: 0, progress: 1, next: formations[0] }
  if (nextIndex < 0) return { positions: formations.at(-1)!.positions, from: formations.length - 1, to: formations.length - 1, progress: 1, next: null }
  const before = formations[nextIndex - 1]
  const after = formations[nextIndex]
  const progress = (timeSec - before.endSec) / Math.max(1e-6, after.startSec - before.endSec)
  const ids = [...new Set([...Object.keys(before.positions), ...Object.keys(after.positions)])]
  const positions = Object.fromEntries(ids.map((id) => {
    const a = before.positions[id] ?? after.positions[id]
    const b = after.positions[id] ?? a
    return [id, { x: a.x + (b.x - a.x) * progress, z: a.z + (b.z - a.z) * progress }]
  }))
  return { positions, from: nextIndex - 1, to: nextIndex, progress, next: after }
}
