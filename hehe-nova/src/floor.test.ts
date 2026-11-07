import { describe, expect, it } from 'vitest'
import type { PoseLandmark } from './domain'
import { cameraFor, fitScaleToView, floorConfig, floorPosition, learnerView, moveInstruction, placeOnFloor, projectFloor, toLearnerFloor } from './floor'

const camera = cameraFor(1280, 720, 65)
const CAMERA_HEIGHT = 1.0

/** A front-facing person standing at floor point (x, z), rendered by a level camera 1 m high. */
function personAt(x: number, z: number): PoseLandmark[] {
  const project = (px: number, height: number): PoseLandmark => ({
    x: (camera.width / 2 + camera.fx * px / z) / camera.width,
    y: (camera.height / 2 + camera.fx * (CAMERA_HEIGHT - height) / z) / camera.height,
    z: 0,
    visibility: 1,
  })
  const pose = Array.from({ length: 33 }, () => project(x, 1.6))
  pose[11] = project(x + 0.2, 1.4); pose[12] = project(x - 0.2, 1.4)
  pose[23] = project(x + 0.1, 1.4 - floorConfig.torsoMeters); pose[24] = project(x - 0.1, 1.4 - floorConfig.torsoMeters)
  pose[27] = project(x + 0.1, 0); pose[28] = project(x - 0.1, 0)
  return pose
}

describe('single-camera floor positions', () => {
  it('recovers where a person stands from torso size and feet', () => {
    const spot = floorPosition(personAt(0.8, 3), camera)!
    expect(spot.x).toBeCloseTo(0.8, 1)
    expect(spot.z).toBeCloseTo(3, 1)
  })

  it('solves the camera height at the anchor and projects floor points back under the feet', () => {
    const pose = personAt(-0.5, 2.5)
    const view = learnerView(pose, camera)!
    expect(view.heightM).toBeCloseTo(CAMERA_HEIGHT, 1)
    const feet = projectFloor({ x: -0.5, z: 2.5 }, view)!
    expect(feet.y).toBeCloseTo(pose[27].y, 2)
  })

  it('stands a reference dancer on a learner floor spot at the right size', () => {
    const view = learnerView(personAt(0, 2.5), camera)!
    const placed = placeOnFloor(personAt(1, 4), camera, { x: 0.5, z: 3 }, view)!
    const expected = personAt(0.5, 3)
    expect(placed[27].y).toBeCloseTo(expected[27].y, 2)
    expect(placed[11].y).toBeCloseTo(expected[11].y, 2)
  })

  it('maps reference travel relative to the learner start spot, scaled to the room', () => {
    const mapping = { anchor: { x: 0, z: 2.5 }, origin: { x: 1, z: 4 }, scale: 0.5 }
    expect(toLearnerFloor({ x: 2, z: 4 }, mapping)).toEqual({ x: 0.5, z: 2.5 })
  })

  it('gives learner-relative directions (camera-right is your left)', () => {
    expect(moveInstruction({ x: 0, z: 3 }, { x: 1.3, z: 3 })).toBe('Take 2 steps to your left')
    expect(moveInstruction({ x: 0, z: 3 }, { x: -0.6, z: 2.6 })).toBe('Take 1 step to your right and a small step forward')
    expect(moveInstruction({ x: 0, z: 3 }, { x: 0.1, z: 3.1 })).toBeNull()
  })
})

describe('size-independent formation fit', () => {
  it('shrinks a wide formation until every dancer is inside the webcam view', () => {
    const view = learnerView(personAt(0, 2.5), camera)!
    const origin = { x: 0, z: 5 }
    // Dancers 3 m either side of the learner's role: too wide for a webcam 2.5 m away.
    const wide = [origin, { x: -3, z: 5 }, { x: 3, z: 5 }, { x: 0, z: 7 }]
    const scale = fitScaleToView(wide, origin, { x: 0, z: 2.5 }, view)
    expect(scale).toBeLessThan(1)
    expect(scale).toBeGreaterThan(0.2)
    for (const point of wide) {
      const projected = projectFloor(toLearnerFloor(point, { anchor: { x: 0, z: 2.5 }, origin, scale }), view)!
      expect(projected.x).toBeGreaterThanOrEqual(floorConfig.fitMargin - 1e-6)
      expect(projected.x).toBeLessThanOrEqual(1 - floorConfig.fitMargin + 1e-6)
    }
  })

  it('keeps a formation that already fits at full size', () => {
    const view = learnerView(personAt(0, 3), camera)!
    expect(fitScaleToView([{ x: 0, z: 5 }, { x: 0.5, z: 5 }], { x: 0, z: 5 }, { x: 0, z: 3 }, view)).toBe(1)
  })
})
