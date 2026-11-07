import { describe, expect, it } from 'vitest'
import type { PoseLandmark } from './domain'
import { cameraFor } from './floor'
import { identifyDancers, type DetectionFrame } from './offlineTracking'
import { detectionFromLandmarks, type Appearance } from './referenceTracking'

function person(x: number, sway: number): PoseLandmark[] {
  const p = (dx: number, y: number): PoseLandmark => ({ x: x + dx, y, z: 0, visibility: 1 })
  const pose = Array.from({ length: 33 }, () => p(0, 0.4))
  pose[11] = p(-0.02, 0.45); pose[12] = p(0.02, 0.45)
  pose[23] = p(-0.015, 0.6); pose[24] = p(0.015, 0.6)
  pose[25] = p(-0.015 + sway, 0.7); pose[26] = p(0.015 - sway, 0.7)
  pose[27] = p(-0.015 + sway, 0.8); pose[28] = p(0.015 - sway, 0.8)
  pose[15] = p(-0.05 + sway, 0.5); pose[16] = p(0.05 - sway, 0.5)
  return pose
}

const red: Appearance = { torso: [0.8, 0.1, 0.1], legs: [0.1, 0.1, 0.1], shins: [0.1, 0.1, 0.1] }
const white: Appearance = { torso: [0.9, 0.9, 0.9], legs: [0.9, 0.9, 0.9], shins: [0.9, 0.9, 0.9] }

describe('offline identity linking', () => {
  it('keeps two dancers apart through a crossing where frame-to-frame matching is ambiguous', () => {
    const frames: DetectionFrame[] = []
    for (let i = 0; i <= 60; i += 1) {
      const t = i * 0.15
      // Red walks left→right, white right→left; they pass each other around t = 4.5 s, and during
      // the crossing only one of them is detected (the other is hidden).
      const redX = 0.2 + 0.6 * (i / 60)
      const whiteX = 0.8 - 0.6 * (i / 60)
      const sway = 0.02 * Math.sin(i)
      const detections = []
      const crossing = Math.abs(redX - whiteX) < 0.08
      detections.push(detectionFromLandmarks(person(redX, sway), red)!)
      if (!crossing) detections.push(detectionFromLandmarks(person(whiteX, -sway), white)!)
      frames.push({ timeSec: t, detections })
    }
    const tracks = identifyDancers(frames, ['d1', 'd2'], cameraFor(1280, 720, 69), 0.15)
    expect(tracks).toHaveLength(2)
    // d1 starts on the left (red); it must end on the right, still red.
    const d1 = tracks.find((track) => track.id === 'd1')!
    expect(d1.frames[0].center.x).toBeLessThan(0.3)
    expect(d1.frames.at(-1)!.center.x).toBeGreaterThan(0.7)
    expect(d1.appearance?.torso?.[1]).toBeLessThan(0.3)
    const d2 = tracks.find((track) => track.id === 'd2')!
    expect(d2.frames.at(-1)!.center.x).toBeLessThan(0.3)
  })
})
