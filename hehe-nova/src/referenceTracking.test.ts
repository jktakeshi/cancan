import { describe, expect, it } from 'vitest'
import type { PoseLandmark } from './domain'
import { analysisCrops, appendTrackedFrame, dedupeDetections, detectionFromLandmarks, focusCrop, landmarksFromCrop, missingTracks, poseAt, reassignRole, sampleAppearance, type Appearance, type ReferenceTrack } from './referenceTracking'
import { containRect } from './skeleton'

function pose(x: number, scale: number): PoseLandmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({ x, y: 0.5, z: 0, visibility: 1 }))
  landmarks[23] = { x: x - 0.01, y: 0.6, z: 0, visibility: 1 }
  landmarks[24] = { x: x + 0.01, y: 0.6, z: 0, visibility: 1 }
  landmarks[11] = { x: x - 0.02, y: 0.6 - scale, z: 0, visibility: 1 }
  landmarks[12] = { x: x + 0.02, y: 0.6 - scale, z: 0, visibility: 1 }
  return landmarks
}

const light: Appearance = { torso: [0.85, 0.84, 0.8], legs: [0.1, 0.1, 0.1] }
const dark: Appearance = { torso: [0.1, 0.1, 0.12], legs: [0.6, 0.6, 0.6] }
const detect = (x: number, appearance?: Appearance) => detectionFromLandmarks(pose(x, 0.2), appearance)!

describe('reference dancer tracking', () => {
  it('initializes role IDs from left to right', () => {
    const tracks = appendTrackedFrame([], [0.8, 0.2, 0.5].map((x) => detect(x)), 0, ['a', 'b', 'c'])
    expect(tracks.map((track) => track.frames[0].center.x)).toEqual([0.2, 0.5, 0.8])
  })

  it('uses motion continuity instead of relabeling by current x position', () => {
    let tracks = appendTrackedFrame([], [0.3, 0.7].map((x) => detect(x)), 0, ['a', 'b'])
    tracks = appendTrackedFrame(tracks, [0.45, 0.55].map((x) => detect(x)), 0.1, ['a', 'b'])
    tracks = appendTrackedFrame(tracks, [0.6, 0.4].map((x) => detect(x)), 0.2, ['a', 'b'])
    expect(tracks[0].frames.at(-1)?.center.x).toBeCloseTo(0.6)
    expect(tracks[1].frames.at(-1)?.center.x).toBeCloseTo(0.4)
  })

  it('keeps identity by clothing when two dancers meet and separate without clear motion', () => {
    let tracks = appendTrackedFrame([], [detect(0.45, light), detect(0.55, dark)], 0, ['a', 'b'])
    tracks = appendTrackedFrame(tracks, [detect(0.5, light), detect(0.52, dark)], 0.1, ['a', 'b'])
    // Positions now favor a swap, but the clothing does not.
    tracks = appendTrackedFrame(tracks, [detect(0.47, dark), detect(0.56, light)], 0.2, ['a', 'b'])
    expect(tracks.find((track) => track.id === 'a')?.frames.at(-1)?.center.x).toBeCloseTo(0.56)
    expect(tracks.find((track) => track.id === 'b')?.frames.at(-1)?.center.x).toBeCloseTo(0.47)
  })

  it('adds a dancer who appears after tracking starts', () => {
    let tracks = appendTrackedFrame([], [detect(0.3)], 0, ['a', 'b'])
    tracks = appendTrackedFrame(tracks, [detect(0.3), detect(0.8)], 0.1, ['a', 'b'])
    expect(tracks.map((track) => track.id)).toEqual(['a', 'b'])
    expect(tracks[1].frames[0].center.x).toBeCloseTo(0.8)
  })

  it('drops a duplicate pose detected on the same dancer', () => {
    expect(dedupeDetections([detect(0.5), detect(0.505), detect(0.8)])).toHaveLength(2)
  })

  it('swaps role labels when a dancer is reassigned manually', () => {
    const tracks = appendTrackedFrame([], [detect(0.2), detect(0.8)], 0, ['a', 'b'])
    expect(reassignRole(tracks, 'a', 1).map((track) => track.id)).toEqual(['b', 'a'])
  })

  it('samples median clothing color inside the torso and thighs', () => {
    const landmarks = pose(0.5, 0.2)
    landmarks[25] = { x: 0.49, y: 0.75, z: 0, visibility: 1 }
    landmarks[26] = { x: 0.51, y: 0.75, z: 0, visibility: 1 }
    const appearance = sampleAppearance(landmarks, (_, y) => (y < 0.6 ? [1, 0, 0] : [0, 0, 1]))
    expect(appearance.torso).toEqual([1, 0, 0])
    expect(appearance.legs).toEqual([0, 0, 1])
  })

  it('interpolates poses between samples and hides long gaps', () => {
    const track: ReferenceTrack = {
      id: 'a',
      frames: [
        { timeSec: 0, center: { x: 0.2, y: 0.6 }, radius: 0.1, scale: 0.2, landmarks: pose(0.2, 0.2) },
        { timeSec: 0.2, center: { x: 0.4, y: 0.6 }, radius: 0.1, scale: 0.2, landmarks: pose(0.4, 0.2) },
        { timeSec: 2, center: { x: 0.4, y: 0.6 }, radius: 0.1, scale: 0.2, landmarks: pose(0.4, 0.2) },
      ],
    }
    expect(poseAt(track, 0.1)?.[0].x).toBeCloseTo(0.3)
    expect(poseAt(track, 1)).toBeNull()
  })
})

describe('detector crops', () => {
  it('covers a landscape frame with the full view plus overlapping squares', () => {
    const crops = analysisCrops(1280, 720)
    expect(crops[0]).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(crops).toHaveLength(4)
    expect(crops.at(-1)!.x + crops.at(-1)!.width).toBeCloseTo(1)
    expect(crops[1].width).toBeCloseTo(720 / 1280)
  })

  it('maps crop landmarks to the frame and rejects poses cut by an interior edge', () => {
    const crop = { x: 0.5, y: 0, width: 0.5, height: 1 }
    expect(landmarksFromCrop(pose(0.5, 0.2), crop)?.[23].x).toBeCloseTo(0.745)
    expect(landmarksFromCrop(pose(0.03, 0.2), crop)).toBeNull()
  })

  it('refocuses only on recently seen dancers with no matching detection', () => {
    const tracks = appendTrackedFrame([], [detect(0.2, light), detect(0.8, dark)], 0, ['a', 'b'])
    const missing = missingTracks(tracks, [detect(0.21, light)], 0.1)
    expect(missing.map((track) => track.id)).toEqual(['b'])
    const crop = focusCrop(missing[0].frames[0], 1280, 720)
    // Centered on the dancer where possible, but always clamped inside the frame.
    expect(crop.x).toBeLessThan(0.8 - 0.1)
    expect(crop.x + crop.width).toBeCloseTo(1)
    expect(missingTracks(tracks, [], 5)).toHaveLength(0)
  })
})

describe('video content rectangle', () => {
  it('pillarboxes a 16:9 video inside a 4:3 box', () => {
    expect(containRect(400, 300, 1280, 720)).toEqual({ left: 0, top: 37.5, width: 400, height: 225 })
  })
})
