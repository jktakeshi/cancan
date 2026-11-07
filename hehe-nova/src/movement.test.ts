import { describe, expect, it } from 'vitest'
import type { Phrase, PoseLandmark, PoseSample } from './domain'
import { comparePoses, describeShape, limbCorrection, retargetPose, reviewTake, teachPhrase, travelCues } from './movement'
import type { ReferenceTrack } from './referenceTracking'

type Overrides = { hipX?: number; scale?: number; rightArm?: 'down' | 'out' | 'up'; leftArm?: 'down' | 'out' | 'up'; kneeBend?: boolean }

/**
 * A front-facing stick figure in normalized video coordinates (aspect 1). The dancer's left side
 * appears on the image's right, as for a real person facing the camera.
 */
function figure({ hipX = 0.5, scale = 0.2, rightArm = 'down', leftArm = 'down', kneeBend = false }: Overrides = {}): PoseLandmark[] {
  const p = (x: number, y: number): PoseLandmark => ({ x: hipX + x * scale, y: 0.6 + y * scale, z: 0, visibility: 1 })
  const lm = Array.from({ length: 33 }, () => p(0, -1.4))
  lm[11] = p(0.3, -1); lm[12] = p(-0.3, -1)
  lm[23] = p(0.15, 0); lm[24] = p(-0.15, 0)
  const arm = (shoulder: number, elbow: number, wrist: number, side: 1 | -1, state: string) => {
    const s = lm[shoulder]
    const offsets = state === 'up' ? [[0, -0.5], [0, -1]] : state === 'out' ? [[0.5, 0], [1, 0]] : [[0, 0.5], [0, 1]]
    lm[elbow] = { ...s, x: s.x + offsets[0][0] * side * scale, y: s.y + offsets[0][1] * scale }
    lm[wrist] = { ...s, x: s.x + offsets[1][0] * side * scale, y: s.y + offsets[1][1] * scale }
  }
  arm(11, 13, 15, 1, leftArm)
  arm(12, 14, 16, -1, rightArm)
  const knee = kneeBend ? 0.25 : 0
  lm[25] = p(0.15 + knee, 0.6); lm[26] = p(-0.15 - knee, 0.6)
  lm[27] = p(0.15, 1.2); lm[28] = p(-0.15, 1.2)
  return lm
}

const phrase: Phrase = {
  id: 'p', label: 'P', startSec: 0, endSec: 4,
  counts: Array.from({ length: 8 }, (_, index) => ({ count: (index + 1) as 1, timeSec: index * 0.5 })),
  roles: [], teachingChunks: [],
}

/** Reference: right arm goes up on count 3 and the dancer travels camera-right during count 5. */
function referenceTrack(): ReferenceTrack {
  const frames = []
  for (let t = 0; t <= 4.2; t += 0.1) {
    const hipX = t < 2 ? 0.4 : Math.min(0.7, 0.4 + (t - 2) * 0.6)
    const landmarks = figure({ hipX, rightArm: t >= 1 ? 'up' : 'down' })
    frames.push({ timeSec: Number(t.toFixed(2)), center: { x: hipX, y: 0.6 }, radius: 0.1, scale: 0.2, landmarks })
  }
  return { id: 'a', frames }
}

describe('pose comparison', () => {
  it('scores an identical pose at 100 regardless of position and size', () => {
    expect(comparePoses(figure(), 1, figure({ hipX: 0.3, scale: 0.12 }), 1).score).toBe(100)
  })

  it('names the limb that differs and how to fix it', () => {
    const comparison = comparePoses(figure({ rightArm: 'up' }), 1, figure({ rightArm: 'out' }), 1)
    expect(comparison.score).toBeLessThan(100)
    const [key, difference] = Object.entries(comparison.limbs).sort((a, b) => b[1].errorDeg - a[1].errorDeg)[0]
    expect(limbCorrection(key as 'rightArm', difference)).toBe('Lift your right arm higher')
  })

  it('places the target pose on the learner body', () => {
    const ghost = retargetPose(figure({ rightArm: 'up' }), 1, figure({ hipX: 0.3, scale: 0.1 }), 1)!
    expect((ghost[23].x + ghost[24].x) / 2).toBeCloseTo(0.3)
    expect(ghost[16].y).toBeLessThan(ghost[12].y)
  })
})

describe('teaching cues', () => {
  it('reads the arm shape and knee bend', () => {
    const shape = describeShape(figure({ leftArm: 'up', rightArm: 'out', kneeBend: true }), 1)!
    expect(shape.arms).toEqual({ left: 'up', right: 'out' })
    expect(shape.kneesBent).toBe(true)
    expect(shape.facing).toBe('front')
  })

  it('turns camera-right travel into "your left"', () => {
    expect(travelCues(figure({ hipX: 0.3 }), figure({ hipX: 0.5 }), 1)).toEqual(['Travel to your left'])
    expect(travelCues(figure({ scale: 0.2 }), figure({ scale: 0.24 }), 1)).toEqual(['Move forward, toward the front'])
  })

  it('describes only what changes on each count', () => {
    const lessons = teachPhrase(referenceTrack(), phrase, 1)
    expect(lessons[0].cues[0]).toBe('Start facing front, both arms down, feet together')
    expect(lessons[2].cues).toContain('Right arm up overhead')
    expect(lessons[3].cues).not.toContain('Right arm up overhead')
    expect(lessons[4].cues.some((cue) => cue.startsWith('Travel to your left'))).toBe(true)
  })
})

describe('take review', () => {
  const samplesFrom = (track: ReferenceTrack, lagSec: number, edit?: (landmarks: PoseLandmark[]) => PoseLandmark[]): PoseSample[] =>
    track.frames.filter((frame) => frame.timeSec + lagSec <= 4).map((frame) => ({ timeMs: (frame.timeSec + lagSec) * 1000, landmarks: edit ? edit(frame.landmarks) : frame.landmarks }))

  it('scores a faithful copy highly and reports the lag', () => {
    const track = referenceTrack()
    const review = reviewTake(samplesFrom(track, 0.3), track, phrase, 1, 1)
    expect(review.score).toBeGreaterThanOrEqual(95)
    expect(review.timing).toMatch(/behind/)
    expect(review.travel).toMatch(/Good travel to your left/)
  })

  it('flags the count where the arm never goes up', () => {
    const track = referenceTrack()
    const review = reviewTake(samplesFrom(track, 0, () => figure({ hipX: 0.4 })), track, phrase, 1, 1)
    // Arm goes up from count 3 on; every later count should ask for it.
    for (const index of [3, 5, 7]) expect(review.counts[index].correction).toBe('Lift your right arm higher')
    expect(review.counts[0].score).toBeGreaterThan(review.counts[3].score!)
    expect(review.travel).toMatch(/you stayed in place/)
  })
})
