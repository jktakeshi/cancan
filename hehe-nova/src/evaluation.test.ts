import { describe, expect, it } from 'vitest'
import type { Calibration, PoseLandmark, PoseSample, RoleTarget } from './domain'
import { correctionFor, extractStableLanding, scoreFormation } from './evaluation'

const calibration: Calibration = {
  corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  widthM: 1,
  depthM: 1,
}

const role = (id: string, x: number): RoleTarget => ({
  id, label: id, color: '#fff', highlights: [{ timeSec: 0, center: { x, y: 0.5 }, radius: 0.1 }],
  startFloor: { x, y: 0.5 }, pathFloor: [{ x, y: 0.5 }, { x, y: 0.5 }], finishFloor: { x, y: 0.5 },
  poseTargets: [{ count: 8, landmarks: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 })) }], movementEvents: [],
})
function sample(timeMs: number, leftX = 0.45, rightX = 0.55): PoseSample {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  landmarks[29] = { x: leftX, y: 0.5, z: 0, visibility: 1 }
  landmarks[30] = { x: rightX, y: 0.5, z: 0, visibility: 1 }
  return { timeMs, landmarks }
}

describe('attempt evaluation', () => {
  it('extracts a stable landing in the count-eight window', () => {
    const capture = extractStableLanding([sample(1200), sample(1300), sample(1400)], 1000, calibration)
    expect(capture.result.status).toBe('pass')
    expect(capture.landing?.x).toBeCloseTo(0.5)
  })

  it('scores the same landing differently for different roles', () => {
    const roleA = role('A', 0.5)
    const roleB = role('B', 0.9)
    const landing = { x: 0.5, y: 0.5 }
    expect(scoreFormation(landing, roleA, [roleA, roleB], calibration, calibration).status).toBe('pass')
    expect(scoreFormation(landing, roleB, [roleA, roleB], calibration, calibration).status).toBe('fail')
  })

  it('prioritizes visibility over lower-level corrections', () => {
    const result = { visibility: { status: 'inconclusive' as const, reason: 'feet missing' }, timing: { status: 'fail' as const, reason: 'late' }, footwork: { status: 'fail' as const, reason: 'wrong foot' }, formation: { status: 'fail' as const, reason: 'wrong place' }, posture: { status: 'fail' as const, reason: 'wrong shape' } }
    expect(correctionFor(result)).toContain('visible')
  })
})

