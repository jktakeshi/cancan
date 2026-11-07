import { describe, expect, it } from 'vitest'
import { analyzeBeats, anchoredCountGrid, buildCountGrid, phrasesFromGrid } from './beatTracking'

/** Clicks with a noise burst on every beat, starting at `offset` seconds. */
function clickTrack(bpm: number, seconds: number, sampleRate = 22050, offset = 0.1) {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  const period = 60 / bpm
  let seed = 1
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1 }
  for (let beat = offset; beat < seconds; beat += period) {
    const start = Math.round(beat * sampleRate)
    for (let i = 0; i < 0.03 * sampleRate && start + i < samples.length; i += 1) samples[start + i] = noise() * Math.exp(-i / (0.008 * sampleRate))
  }
  return samples
}

describe('beat tracking', () => {
  it('finds the tempo and beat positions of a click track', () => {
    const result = analyzeBeats(clickTrack(120, 12), 22050)
    expect(result.bpm).toBeGreaterThan(117)
    expect(result.bpm).toBeLessThan(123)
    const nearest = (time: number) => Math.min(...result.beats.map((beat) => Math.abs(beat - time)))
    expect(nearest(4.1)).toBeLessThan(0.05)
    expect(nearest(8.1)).toBeLessThan(0.05)
  })
})

describe('count grid', () => {
  const beats = Array.from({ length: 40 }, (_, index) => index * 60 / 144)
  // Dancers stand still, then hit a new shape on the beat at 7.5 s and keep dancing.
  const deviation = Array.from({ length: 170 }, (_, index) => (index * 0.1 >= 7.45 ? 0.4 : 0.15))
  const motion = Array.from({ length: 170 }, (_, index) => (index * 0.1 >= 7.2 ? 1 + Math.sin(index) : 0.1))

  it('counts fast music in half time and starts count 1 on the first hit', () => {
    const grid = buildCountGrid(beats, motion, 0.1, 16.4, {}, deviation)
    expect(grid.beatsPerCount).toBe(2)
    expect(grid.counts[0]).toBeCloseTo(7.5, 1)
    expect(grid.countIn).toHaveLength(4)
    expect(grid.countIn.at(-1)).toBeCloseTo(7.5 - 2 * 60 / 144, 2)
  })

  it('applies manual count-rate and count-1 corrections', () => {
    const grid = buildCountGrid(beats, motion, 0.1, 16.4, { beatsPerCount: 1, shiftCounts: 1 }, deviation)
    expect(grid.beatsPerCount).toBe(1)
    expect(grid.counts[0]).toBeCloseTo(7.5 + 60 / 144, 1)
  })

  it('builds eight-count phrases only from count 1 onward', () => {
    const grid = buildCountGrid(beats, motion, 0.1, 16.4, {}, deviation)
    const phrases = phrasesFromGrid(grid, [], 16.4)
    expect(phrases[0].startSec).toBeCloseTo(grid.counts[0])
    expect(phrases[0].counts).toHaveLength(8)
    expect(phrases[0].counts[1].timeSec - phrases[0].counts[0].timeSec).toBeCloseTo(2 * 60 / 144, 2)
  })
})

describe('complete eight-counts only', () => {
  it('ignores counts left over at the end of the clip', () => {
    // 21 counts after count 1: two full eight-counts plus five leftovers.
    const counts = Array.from({ length: 21 }, (_, index) => 5.17 + index * 0.533)
    const phrases = phrasesFromGrid({ countSec: 0.533, beatsPerCount: 1, counts, countIn: [3.1, 3.6, 4.1, 4.6], danceStartSec: 5 }, [], 16.47)
    expect(phrases.map((phrase) => phrase.label)).toEqual(['Eight-count 1', 'Eight-count 2'])
    expect(phrases[0].startSec).toBeCloseTo(5.17)
    expect(phrases[1].startSec).toBeCloseTo(5.17 + 8 * 0.533)
  })
})

describe('counts pinned by a person', () => {
  it('follows the music pulse at the pinned tempo, with the 5-6-7-8 before count 1', () => {
    // Clicks every 0.711 s from 0.17 s, as in the bundled clip (84.4 counts a minute).
    const samples = clickTrack(84.4, 16, 22050, 0.17)
    const { envelope, frameRate } = analyzeBeats(samples, 22050)
    const grid = anchoredCountGrid(envelope, frameRate, 3.7, 8.8, 16)
    expect(grid.anchored).toBe(true)
    expect(grid.counts[0]).toBeCloseTo(0.17 + 5 * 0.711, 1)
    expect(grid.counts[7]).toBeCloseTo(0.17 + 12 * 0.711, 1)
    expect(grid.countIn).toHaveLength(4)
    expect(phrasesFromGrid(grid, [], 16)).toHaveLength(2)
  })

  it('falls back to an even grid through the anchors when there is no clear pulse', () => {
    const grid = anchoredCountGrid(new Float32Array(1000), 86, 3.7, 8.8, 16)
    expect(grid.counts[0]).toBeCloseTo(3.7, 2)
    expect(grid.counts[7]).toBeCloseTo(8.8, 2)
  })
})
