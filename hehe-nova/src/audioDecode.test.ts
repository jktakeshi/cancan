/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readAacTrack } from './audioDecode'

const clip = 'public/rehearsal1.mov'

describe('container audio reader', () => {
  it.skipIf(!existsSync(clip))('finds every AAC frame of the rehearsal clip', () => {
    const bytes = readFileSync(clip)
    const track = readAacTrack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))!
    expect(track.sampleRate).toBe(44100)
    expect(track.channels).toBe(2)
    // AAC-LC: AudioSpecificConfig starts with object type 2.
    expect(track.config[0] >> 3).toBe(2)
    // 53.08 s of audio at 1024 samples per AAC frame.
    expect(track.samples.length).toBeGreaterThan(2270)
    expect(track.samples.length).toBeLessThan(2300)
    expect(track.samples.every((sample) => sample.offset + sample.size <= bytes.byteLength && sample.size > 0)).toBe(true)
  })
})
