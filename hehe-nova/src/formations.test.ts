import { describe, expect, it } from 'vitest'
import { formationPositionsAt, formationsFromSnapshots, type FloorSnapshot } from './formations'

/** Two dancers hold a line, swap sides over three counts, then hold again. Small jitter throughout. */
function rehearsal(): FloorSnapshot[] {
  const snapshots: FloorSnapshot[] = []
  for (let count = 0; count < 14; count += 1) {
    const jitter = ((count * 7) % 3 - 1) * 0.05
    let progress = 0
    if (count >= 5 && count <= 8) progress = (count - 5) / 3
    if (count > 8) progress = 1
    snapshots.push({
      timeSec: count * 0.8,
      positions: {
        a: { x: -1 + 2 * progress + jitter, z: 4 },
        b: { x: 1 - 2 * progress, z: 4 + jitter },
      },
    })
  }
  return snapshots
}

describe('formations from the video', () => {
  it('finds the holds on either side of a transition', () => {
    const formations = formationsFromSnapshots(rehearsal())
    expect(formations.map((formation) => formation.name)).toEqual(['Formation 1', 'Formation 2'])
    expect(formations[0].positions.a.x).toBeCloseTo(-1, 0)
    expect(formations[1].positions.a.x).toBeCloseTo(1, 0)
    expect(formations[0].endSec).toBeLessThan(formations[1].startSec)
  })

  it('interpolates positions during the transition and reports the next formation', () => {
    const formations = formationsFromSnapshots(rehearsal())
    const middle = (formations[0].endSec + formations[1].startSec) / 2
    const state = formationPositionsAt(middle, formations)!
    expect(state.from).toBe(0)
    expect(state.to).toBe(1)
    expect(state.positions.a.x).toBeCloseTo(0, 0)
    expect(formationPositionsAt(formations[0].startSec, formations)!.next?.name).toBe('Formation 2')
  })
})
