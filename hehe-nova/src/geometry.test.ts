import { describe, expect, it } from 'vitest'
import type { Calibration } from './domain'
import { computeHomography, mapReferencePoint, projectToFloor } from './geometry'

const identityCalibration: Calibration = {
  corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  widthM: 1,
  depthM: 1,
}

describe('floor geometry', () => {
  it('projects image points through a calibrated floor', () => {
    const homography = computeHomography(identityCalibration)
    expect(homography).not.toBeNull()
    expect(projectToFloor({ x: 0.25, y: 0.75 }, homography!)).toEqual({ x: 0.25, y: 0.75 })
  })

  it('scales and centers a reference floor without enlarging it', () => {
    const reference = { ...identityCalibration, widthM: 4, depthM: 3 }
    const practice = { ...identityCalibration, widthM: 3, depthM: 3 }
    const mapped = mapReferencePoint({ x: 2, y: 1.5 }, reference, practice)
    expect(mapped.x).toBeCloseTo(1.5)
    expect(mapped.y).toBeCloseTo(1.5)
  })
})

