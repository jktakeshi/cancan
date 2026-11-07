import { describe, expect, it } from 'vitest'
import type { PoseLandmark } from './domain'
import { appendTrackedFrame, detectionFromLandmarks } from './referenceTracking'

function pose(x: number, scale: number): PoseLandmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({ x, y: 0.5, z: 0, visibility: 1 }))
  landmarks[23] = { x: x - 0.01, y: 0.6, z: 0, visibility: 1 }
  landmarks[24] = { x: x + 0.01, y: 0.6, z: 0, visibility: 1 }
  landmarks[11] = { x: x - 0.02, y: 0.6 - scale, z: 0, visibility: 1 }
  landmarks[12] = { x: x + 0.02, y: 0.6 - scale, z: 0, visibility: 1 }
  return landmarks
}

describe('reference dancer tracking', () => {
  it('initializes role IDs from left to right', () => {
    const detections = [0.8, 0.2, 0.5].map((x) => detectionFromLandmarks(pose(x, 0.2))!)
    const tracks = appendTrackedFrame([], detections, 0, ['a', 'b', 'c'])
    expect(tracks.map((track) => track.frames[0].center.x)).toEqual([0.2, 0.5, 0.8])
  })

  it('uses motion continuity instead of relabeling by current x position', () => {
    let tracks = appendTrackedFrame([], [0.3, 0.7].map((x) => detectionFromLandmarks(pose(x, 0.2))!), 0, ['a', 'b'])
    tracks = appendTrackedFrame(tracks, [0.45, 0.55].map((x) => detectionFromLandmarks(pose(x, 0.2))!), 0.1, ['a', 'b'])
    tracks = appendTrackedFrame(tracks, [0.6, 0.4].map((x) => detectionFromLandmarks(pose(x, 0.2))!), 0.2, ['a', 'b'])
    expect(tracks[0].frames.at(-1)?.center.x).toBeCloseTo(0.6)
    expect(tracks[1].frames.at(-1)?.center.x).toBeCloseTo(0.4)
  })
})
