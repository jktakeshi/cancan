import { describe, expect, it } from 'vitest'
import { demoManifest } from './demoData'
import { validateManifest } from './manifestValidation'

describe('manifest validation', () => {
  it('accepts the complete placeholder manifest', () => {
    expect(validateManifest(demoManifest)).toEqual([])
  })

  it('reports incomplete role targets', () => {
    const broken = structuredClone(demoManifest)
    broken.phrases[0].roles[0].pathFloor = []
    broken.phrases[0].roles[0].poseTargets = []
    expect(validateManifest(broken)).toEqual(expect.arrayContaining([
      expect.stringContaining('formation path'),
      expect.stringContaining('body-pose target'),
    ]))
  })
})
