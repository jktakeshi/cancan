import { fitGroundModel, floorPosition, type Camera, type FloorPoint } from './floor'
import { appearanceDistance, bestAssignment, trackMotion, type Appearance, type ReferenceDetection, type ReferenceTrack, type Rgb } from './referenceTracking'

/*
 * Offline identity tracking for a crowded clip, run once all frames have been detected.
 *
 * 1. Tracklets: detections are chained frame to frame only when the match is unambiguous. When two
 *    people are close enough to be confused, the tracklet ends instead of risking an identity swap.
 * 2. Linking: tracklets are joined into people using evidence that survives gaps and crossings:
 *    floor position and speed (meters, from the ground-plane fit), clothing color averaged over
 *    the tracklet, and torso length in meters (a body-size signature). Tracklets that overlap in
 *    time are never the same person.
 * 3. The `count` longest-lived moving people become the dancers, numbered left to right.
 */

export type DetectionFrame = { timeSec: number; detections: ReferenceDetection[] }

type Observation = ReferenceDetection & { timeSec: number; floor: FloorPoint | null; torsoM: number | null }

type Tracklet = {
  /** Stable id, carried into track frames so manual fixes can move a whole stretch. */
  id: number
  observations: Observation[]
  start: number
  end: number
  appearance: Appearance
  torsoM: number | null
}

export const linkingConfig = {
  /** Frame-to-frame gate, in torso lengths of image travel per sampled frame. */
  stepGate: 1.1,
  /** A match is ambiguous when a rival is within this factor (plus margin) of the best cost. */
  ambiguityRatio: 1.6,
  ambiguityMargin: 0.25,
  /** Longest gap a link may bridge. */
  maxGapSec: 6,
  /** Plausible travel while unseen: base meters plus meters per second of gap. */
  linkBaseM: 0.6,
  linkSpeedMps: 1.2,
  maxAppearance: 0.24,
  /** Torso lengths (meters) differing by this much cost one unit. */
  torsoScaleM: 0.05,
  maxLinkCost: 3.2,
}

const median = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN
}

function medianRgb(values: (Rgb | null | undefined)[]): Rgb | null {
  const present = values.filter((value): value is Rgb => Boolean(value))
  if (present.length < 2) return null
  return [0, 1, 2].map((channel) => median(present.map((value) => value[channel]))) as Rgb
}

function observe(frames: DetectionFrame[], camera: Camera): { timeSec: number; observations: Observation[] }[] {
  // Calibrate the floor from every upright detection in the clip.
  const raw: { feetYpx: number; z: number }[] = []
  for (const frame of frames) {
    for (const detection of frame.detections) {
      const pose = detection.landmarks
      const shoulderX = (pose[11].x + pose[12].x) / 2 * camera.width
      const hipX = (pose[23].x + pose[24].x) / 2 * camera.width
      const torsoY = Math.abs((pose[23].y + pose[24].y - pose[11].y - pose[12].y) / 2) * camera.height
      if (Math.abs(shoulderX - hipX) > 0.36 * torsoY) continue
      const spot = floorPosition(pose, { ...camera, ground: undefined }, 0.5)
      if (spot) raw.push({ feetYpx: (pose[27].y + pose[28].y) / 2 * camera.height, z: spot.z })
    }
  }
  const ground = fitGroundModel(raw)
  const calibrated = ground ? { ...camera, ground } : camera
  return frames.map((frame) => ({ timeSec: frame.timeSec, observations: frame.detections.map((detection) => {
    const floor = floorPosition(detection.landmarks, calibrated, 0.35)
    const pose = detection.landmarks
    const torsoPx = Math.hypot((pose[11].x + pose[12].x - pose[23].x - pose[24].x) / 2 * camera.width, (pose[11].y + pose[12].y - pose[23].y - pose[24].y) / 2 * camera.height)
    // Torso length in meters only means something with a ground fit (depth from the feet).
    const torsoM = ground && floor ? torsoPx * floor.z / camera.fx : null
    return { ...detection, timeSec: frame.timeSec, floor, torsoM }
  }) }))
}

function summarize(observations: Observation[], id = -1): Tracklet {
  return {
    id,
    observations,
    start: observations[0].timeSec,
    end: observations.at(-1)!.timeSec,
    appearance: {
      torso: medianRgb(observations.map((item) => item.appearance?.torso)),
      legs: medianRgb(observations.map((item) => item.appearance?.legs)),
      shins: medianRgb(observations.map((item) => item.appearance?.shins)),
    },
    torsoM: Number.isFinite(median(observations.map((item) => item.torsoM ?? NaN))) ? median(observations.map((item) => item.torsoM ?? NaN)) : null,
  }
}

/** Step 1: unambiguous frame-to-frame chains. */
export function buildTracklets(perFrame: { timeSec: number; observations: Observation[] }[], stepSec: number): Tracklet[] {
  const finished: Observation[][] = []
  let active: Observation[][] = []
  for (const { timeSec, observations: detections } of perFrame) {
    const cost = (chain: Observation[], detection: Observation) => {
      const last = chain.at(-1)!
      const previous = chain.at(-2)
      const steps = Math.max(1, Math.round((detection.timeSec - last.timeSec) / stepSec))
      const velocity = previous ? { x: (last.center.x - previous.center.x), y: (last.center.y - previous.center.y) } : { x: 0, y: 0 }
      const predicted = { x: last.center.x + velocity.x * Math.min(steps, 2), y: last.center.y + velocity.y * Math.min(steps, 2) }
      const motion = Math.hypot(predicted.x - detection.center.x, predicted.y - detection.center.y) / Math.max(last.scale, 0.02) / steps
      const looks = appearanceDistance(last.appearance, detection.appearance) ?? 0.1
      const size = Math.abs(Math.log(detection.scale / Math.max(last.scale, 0.01)))
      return motion > linkingConfig.stepGate || looks > 0.3 ? Infinity : motion + 2 * looks + size
    }
    const costs = active.map((chain) => detections.map((detection) => cost(chain, detection)))
    const assignment = bestAssignment(costs, detections.length)
    const used = new Set<number>()
    const next: Observation[][] = []
    assignment.forEach((detectionIndex, chainIndex) => {
      const chain = active[chainIndex]
      if (detectionIndex === null) {
        // Allow one missed frame before the chain ends.
        if (chain.at(-1)!.timeSec >= timeSec - stepSec * 2.5) next.push(chain)
        else finished.push(chain)
        return
      }
      const best = costs[chainIndex][detectionIndex]
      const threshold = best * linkingConfig.ambiguityRatio + linkingConfig.ambiguityMargin
      const rivalDetection = costs[chainIndex].some((value, index) => index !== detectionIndex && value < threshold)
      const rivalChain = costs.some((row, index) => index !== chainIndex && row[detectionIndex] < threshold)
      if (rivalDetection || rivalChain) {
        // Too close to call: close this chain; the detection starts a fresh one.
        finished.push(chain)
        return
      }
      used.add(detectionIndex)
      next.push([...chain, detections[detectionIndex]])
    })
    detections.forEach((detection, index) => { if (!used.has(index)) next.push([detection]) })
    active = next
  }
  finished.push(...active)
  return finished.filter((chain) => chain.length >= 2).map((chain, index) => summarize(chain, index))
}

function linkCost(a: Tracklet, b: Tracklet, maxGapSec = linkingConfig.maxGapSec): number {
  const gap = b.start - a.end
  if (gap <= 0 || gap > maxGapSec) return Infinity
  const looks = appearanceDistance(a.appearance, b.appearance)
  if (looks !== null && looks > linkingConfig.maxAppearance) return Infinity
  const endFloor = a.observations.slice(-3).map((item) => item.floor).filter((item): item is FloorPoint => item !== null)
  const startFloor = b.observations.slice(0, 3).map((item) => item.floor).filter((item): item is FloorPoint => item !== null)
  let motion = 1
  if (endFloor.length && startFloor.length) {
    const from = { x: median(endFloor.map((p) => p.x)), z: median(endFloor.map((p) => p.z)) }
    const to = { x: median(startFloor.map((p) => p.x)), z: median(startFloor.map((p) => p.z)) }
    const allowed = linkingConfig.linkBaseM + linkingConfig.linkSpeedMps * gap
    const distance = Math.hypot(to.x - from.x, to.z - from.z)
    if (distance > allowed) return Infinity
    motion = distance / allowed
  } else {
    const last = a.observations.at(-1)!
    const first = b.observations[0]
    const distance = Math.hypot(first.center.x - last.center.x, first.center.y - last.center.y) / Math.max(last.scale, 0.02)
    if (distance > 1.5 + gap * 4) return Infinity
    motion = distance / (1.5 + gap * 4)
  }
  const size = a.torsoM !== null && b.torsoM !== null ? Math.abs(a.torsoM - b.torsoM) / linkingConfig.torsoScaleM : 0.5
  return motion + 5 * (looks ?? 0.12) + 0.6 * Math.min(size, 3) + 0.15 * gap
}

/** Step 2: join tracklets into people (cheapest links first; each tracklet has one successor). */
export function linkTracklets(tracklets: Tracklet[]): Tracklet[][] {
  const links: { from: number; to: number; cost: number }[] = []
  tracklets.forEach((a, i) => tracklets.forEach((b, j) => {
    if (i === j) return
    const cost = linkCost(a, b)
    if (cost <= linkingConfig.maxLinkCost) links.push({ from: i, to: j, cost })
  }))
  links.sort((x, y) => x.cost - y.cost)
  const next = new Map<number, number>()
  const previous = new Map<number, number>()
  for (const link of links) {
    if (next.has(link.from) || previous.has(link.to)) continue
    next.set(link.from, link.to)
    previous.set(link.to, link.from)
  }
  const people: Tracklet[][] = []
  tracklets.forEach((_, index) => {
    if (previous.has(index)) return
    const chain: Tracklet[] = []
    for (let current: number | undefined = index; current !== undefined; current = next.get(current)) chain.push(tracklets[current])
    people.push(chain)
  })
  return people
}

const toTrack = (id: string, chain: Tracklet[]): ReferenceTrack => {
  const frames = chain
    .flatMap((tracklet) => tracklet.observations.map((item) => ({ timeSec: item.timeSec, center: item.center, radius: item.radius, scale: item.scale, landmarks: item.landmarks, segment: tracklet.id })))
    .sort((a, b) => a.timeSec - b.timeSec)
  return { id, appearance: summarize(chain.flatMap((tracklet) => tracklet.observations)).appearance, frames }
}

/**
 * Detections of the whole clip → `roleIds.length` dancers. People that never move are dropped,
 * the best-covered remaining people are kept, and they are numbered left to right at the first
 * moment (nearly) all of them are visible.
 */
/**
 * Step 3: place leftover tracklets into the gaps of the chosen people. A tracklet joins the person
 * whose neighboring tracklets (before and after the gap) it continues most plausibly.
 */
export function fillGaps(people: Tracklet[][], leftovers: Tracklet[]): Tracklet[][] {
  const result = people.map((chain) => [...chain].sort((a, b) => a.start - b.start))
  const pending = [...leftovers].sort((a, b) => b.observations.length - a.observations.length)
  for (const piece of pending) {
    let best: { index: number; cost: number } | null = null
    result.forEach((chain, index) => {
      if (chain.some((other) => other.start <= piece.end && piece.start <= other.end)) return
      const before = chain.filter((other) => other.end < piece.start).at(-1)
      const after = chain.find((other) => other.start > piece.end)
      const costs = [before && linkCost(before, piece), after && linkCost(piece, after)].filter((value): value is number => value !== undefined)
      if (!costs.length || costs.some((value) => !Number.isFinite(value))) return
      const cost = costs.reduce((sum, value) => sum + value, 0) / costs.length
      if (cost <= linkingConfig.maxLinkCost && (!best || cost < best.cost)) best = { index, cost }
    })
    const chosen = best as { index: number; cost: number } | null
    if (chosen) result[chosen.index] = [...result[chosen.index], piece].sort((a, b) => a.start - b.start)
  }
  return result
}

export function identifyDancers(frames: DetectionFrame[], roleIds: string[], camera: Camera, stepSec: number): ReferenceTrack[] {
  const perFrame = observe(frames, camera)
  const people = linkTracklets(buildTracklets(perFrame, stepSec))
  const scored = people.map((chain) => ({ chain, track: toTrack('person', chain) }))
  const moving = scored.filter(({ track }) => track.frames.length >= 4 && trackMotion(track) >= 0.35)
  const pool = moving.length >= roleIds.length ? moving : scored
  const chosen = [...pool].sort((a, b) => b.track.frames.length - a.track.frames.length).slice(0, roleIds.length)
  const leftovers = scored.filter((item) => !chosen.includes(item)).flatMap((item) => item.chain)
  const kept = fillGaps(chosen.map((item) => item.chain), leftovers).map((chain, index) => toTrack(`person-${index}`, chain))
  if (!kept.length) return []
  const times = [...new Set(kept.flatMap((track) => track.frames.map((frame) => frame.timeSec)))].sort((a, b) => a - b)
  const visibleAt = (time: number) => kept.filter((track) => track.frames.some((frame) => Math.abs(frame.timeSec - time) < stepSec * 0.6)).length
  const reference = times.find((time) => visibleAt(time) >= Math.max(1, kept.length - 1)) ?? times[0]
  const xAt = (track: ReferenceTrack) => track.frames.reduce((best, frame) => (Math.abs(frame.timeSec - reference) < Math.abs(best.timeSec - reference) ? frame : best)).center.x
  return kept.sort((a, b) => xAt(a) - xAt(b)).map((track, index) => ({ ...track, id: roleIds[index] }))
}
