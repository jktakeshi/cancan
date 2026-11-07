import { describe, expect, it } from 'vitest'
import type { PoseLandmark } from './domain'
import { cameraFor, floorConfig, floorPosition, learnerView, moveInstruction, placeOnFloor, projectFloor, toLearnerFloor } from './floor'

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
    expect(moveInstruction({ x: 0, z: 3 }, { x: 0.8, z: 3 })).toBe('Move 0.8 m to your left')
    expect(moveInstruction({ x: 0, z: 3 }, { x: -0.6, z: 2.4 })).toBe('Move 0.6 m to your right and 0.6 m forward')
    expect(moveInstruction({ x: 0, z: 3 }, { x: 0.1, z: 3.1 })).toBeNull()
  })
})
