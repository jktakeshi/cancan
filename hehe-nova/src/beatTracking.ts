import type { CountMark, Phrase, RoleTarget } from './domain'
/*
 * Audio beat tracking for the reference clip, plus the dance-count grid built on top of it.
 *
 * 1. Onset strength: half-wave-rectified spectral flux of the log-magnitude spectrogram.
 * 2. Tempo: autocorrelation of the onset envelope with a broad prior around 110 BPM.
 * 3. Beats: Ellis-style dynamic programming that trades onset strength against tempo regularity.
 *
 * Dancers often count at half the music tempo, and a rehearsal clip usually begins with a count-in
 * ("5, 6, 7, 8") before anyone moves. Neither is visible in the audio alone, so the count grid is
 * chosen with the dancers' own movement: the count rate whose period matches the movement rhythm,
 * and count 1 at the first count where the dancers start moving.
 */

export type BeatAnalysis = {
  /** Music tempo in beats per minute. */
  bpm: number
  /** Beat times in seconds. */
  beats: number[]
  /** Onset strength envelope (for diagnostics) and its frame rate. */
  envelope: Float32Array
  frameRate: number
  /** Accent strength at each beat (bass attack plus overall attack), used to find the "1". */
  accents: number[]
}

const FFT_SIZE = 1024
const HOP = 256

function fftMagnitudes(frame: Float32Array): Float32Array {
  const n = frame.length
  const re = Float64Array.from(frame)
  const im = new Float64Array(n)
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const wr = Math.cos(angle * k)
        const wi = Math.sin(angle * k)
        const a = start + k
        const b = a + size / 2
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
      }
    }
  }
  const out = new Float32Array(n / 2)
  for (let k = 0; k < n / 2; k += 1) out[k] = Math.hypot(re[k], im[k])
  return out
}

/** Spectral-flux onset envelope, mean-removed and normalized to unit standard deviation. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): { envelope: Float32Array; bass: Float32Array; frameRate: number } {
  const window = new Float32Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE))
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP))
  // Up to ~5 kHz: kick, snare, and claps carry the beat; hiss above does not.
  const maxBin = Math.min(FFT_SIZE / 2, Math.round(5000 / sampleRate * FFT_SIZE))
  const envelope = new Float32Array(frames)
  // Kick drums and bass hits mark downbeats; below ~200 Hz.
  const bassBins = Math.max(2, Math.round(200 / sampleRate * FFT_SIZE))
  const bass = new Float32Array(frames)
  let previous: Float32Array | null = null
  const buffer = new Float32Array(FFT_SIZE)
  for (let f = 0; f < frames; f += 1) {
    for (let i = 0; i < FFT_SIZE; i += 1) buffer[i] = samples[f * HOP + i] * window[i]
    const magnitude = fftMagnitudes(buffer)
    const log = new Float32Array(maxBin)
    for (let k = 0; k < maxBin; k += 1) log[k] = Math.log1p(1000 * magnitude[k])
    if (previous) {
      let flux = 0
      for (let k = 1; k < maxBin; k += 1) flux += Math.max(0, log[k] - previous[k])
      envelope[f] = flux
      let low = 0
      for (let k = 1; k < bassBins; k += 1) low += Math.max(0, log[k] - previous[k])
      bass[f] = low
    }
    previous = log
  }
  // Remove the slowly varying loudness so only the attacks remain.
  const frameRate = sampleRate / HOP
  const radius = Math.round(frameRate * 0.5)
  const detrended = new Float32Array(frames)
  for (let f = 0; f < frames; f += 1) {
    let sum = 0
    let n = 0
    for (let g = Math.max(0, f - radius); g <= Math.min(frames - 1, f + radius); g += 1) { sum += envelope[g]; n += 1 }
    detrended[f] = Math.max(0, envelope[f] - sum / n)
  }
  const mean = detrended.reduce((sum, value) => sum + value, 0) / Math.max(1, frames)
  const sd = Math.sqrt(detrended.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, frames)) || 1
  const bassMean = bass.reduce((sum, value) => sum + value, 0) / Math.max(1, frames)
  const bassSd = Math.sqrt(bass.reduce((sum, value) => sum + (value - bassMean) ** 2, 0) / Math.max(1, frames)) || 1
  return { envelope: detrended.map((value) => value / sd), bass: bass.map((value) => (value - bassMean) / bassSd), frameRate }
}

/** Autocorrelation strength at each candidate tempo, weighted by a log-normal prior. */
export function tempoStrengths(envelope: Float32Array, frameRate: number, minBpm = 50, maxBpm = 200) {
  const result: { bpm: number; strength: number; raw: number }[] = []
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const lag = frameRate * 60 / bpm
    const whole = Math.floor(lag)
    const fraction = lag - whole
    let sum = 0
    let n = 0
    for (let f = 0; f + whole + 1 < envelope.length; f += 1) {
      sum += envelope[f] * (envelope[f + whole] * (1 - fraction) + envelope[f + whole + 1] * fraction)
      n += 1
    }
    const raw = n ? sum / n : 0
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2)
    result.push({ bpm, strength: raw * prior, raw })
  }
  return result
}

/** Beat times from the onset envelope at a fixed tempo (Ellis 2007 dynamic programming). */
export function trackBeats(envelope: Float32Array, frameRate: number, bpm: number, tightness = 100): number[] {
  const period = frameRate * 60 / bpm
  const n = envelope.length
  const score = new Float32Array(n)
  const back = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t += 1) {
    let best = 0
    let bestIndex = -1
    for (let p = Math.max(0, Math.round(t - 2 * period)); p <= t - Math.round(period / 2); p += 1) {
      const candidate = score[p] - tightness * Math.log((t - p) / period) ** 2
      if (bestIndex < 0 || candidate > best) { best = candidate; bestIndex = p }
    }
    score[t] = envelope[t] + (bestIndex >= 0 ? Math.max(0, best) : 0)
    back[t] = bestIndex >= 0 && best > 0 ? bestIndex : -1
  }
  // Start from the best-scoring frame within the final beat period.
  let t = n - 1
  for (let f = Math.max(0, Math.round(n - period)); f < n; f += 1) if (score[f] > score[t]) t = f
  const beats: number[] = []
  while (t >= 0) { beats.push(t / frameRate); t = back[t] }
  beats.reverse()
  // Extend the regular grid to the clip edges where onsets were too weak to anchor beats.
  const step = 60 / bpm
  const duration = n / frameRate
  while (beats.length && beats[0] - step >= 0) beats.unshift(beats[0] - step)
  while (beats.length && beats.at(-1)! + step <= duration) beats.push(beats.at(-1)! + step)
  return beats
}

export function analyzeBeats(samples: Float32Array, sampleRate: number): BeatAnalysis {
  const { envelope, bass, frameRate } = onsetEnvelope(samples, sampleRate)
  const strengths = tempoStrengths(envelope, frameRate)
  const bpm = strengths.reduce((best, item) => (item.strength > best.strength ? item : best)).bpm
  const beats = trackBeats(envelope, frameRate, bpm)
  const radius = Math.round(frameRate * 0.05)
  const accents = beats.map((beat) => {
    const center = Math.round(beat * frameRate)
    let peak = 0
    for (let f = Math.max(0, center - radius); f <= Math.min(envelope.length - 1, center + radius); f += 1) peak = Math.max(peak, bass[f] + 0.5 * envelope[f])
    return peak
  })
  return { bpm, beats, envelope, frameRate, accents }
}

/* ---------------------------------------------------------------- count grid ---------------- */

export type CountGrid = {
  /** Seconds per dance count. */
  countSec: number
  /** How many music beats make one count (1 = on every beat, 2 = half time, 0.5 = double time). */
  beatsPerCount: number
  /** Count times; index 0 is count 1 of the first phrase. Earlier counts form the count-in. */
  counts: number[]
  /** The counts before count 1 (the "5, 6, 7, 8" lead-in), possibly empty. */
  countIn: number[]
  /** When the dancers start moving, used to place count 1. */
  danceStartSec: number | null
}

/** Strength of periodicity in a movement-energy signal at a given period (seconds). */
function periodicity(signal: number[], stepSec: number, periodSec: number) {
  const lag = periodSec / stepSec
  const whole = Math.floor(lag)
  const fraction = lag - whole
  const mean = signal.reduce((sum, value) => sum + value, 0) / Math.max(1, signal.length)
  let sum = 0
  let n = 0
  for (let i = 0; i + whole + 1 < signal.length; i += 1) {
    const later = signal[i + whole] * (1 - fraction) + signal[i + whole + 1] * fraction
    sum += (signal[i] - mean) * (later - mean)
    n += 1
  }
  return n ? sum / n : 0
}

/**
 * First time movement energy rises well above the still opening and stays there.
 * `motion` is sampled every `stepSec` seconds from time 0.
 */
export function detectDanceStart(motion: number[], stepSec: number): number | null {
  if (motion.length < 10) return null
  const sorted = [...motion].sort((a, b) => a - b)
  const quiet = sorted[Math.floor(sorted.length * 0.2)]
  const busy = sorted[Math.floor(sorted.length * 0.8)]
  if (busy <= quiet * 1.5) return null
  const threshold = quiet + (busy - quiet) * 0.4
  const sustain = Math.max(3, Math.round(0.8 / stepSec))
  for (let i = 0; i + sustain <= motion.length; i += 1) {
    const window = motion.slice(i, i + sustain)
    if (window.filter((value) => value > threshold).length >= sustain * 0.6) return i * stepSec
  }
  return null
}

export type GridOverrides = {
  /** Force the music beats per count (0.5, 1, or 2) instead of choosing automatically. */
  beatsPerCount?: number
  /** Move count 1 later (positive) or earlier (negative) by whole counts. */
  shiftCounts?: number
}

/** Dancers typically count around this many counts per minute, counting fast music in half time. */
const PREFERRED_COUNTS_PER_MINUTE = 95

/**
 * Choose the count rate and count 1.
 *
 * Count rate: the beat multiple (½×, 1×, 2× beats per count) closest to the usual dance-count
 * tempo, unless the movement rhythm clearly favors another (grooves bounce on every music beat,
 * so movement alone over-favors 1×). Count 1: the count nearest the moment dancing starts;
 * everything earlier is the count-in.
 */
/**
 * The first count on which the dancers hold a clearly different shape from their still opening
 * pose: the first hit of the choreography. `deviation` is sampled every `stepSec` from time 0.
 */
export function firstHitIndex(grid: number[], deviation: number[], stepSec: number): { index: number; strength: number } | null {
  if (deviation.length < 10) return null
  const sorted = [...deviation].sort((a, b) => a - b)
  const still = sorted[Math.floor(sorted.length * 0.2)]
  const dancing = sorted[Math.floor(sorted.length * 0.8)]
  // Too little contrast between the opening and the dance to call a first hit.
  if (dancing - still < 0.05) return null
  const threshold = still + (dancing - still) * 0.5
  const holdThreshold = still + (dancing - still) * 0.35
  const at = (time: number) => deviation[Math.min(deviation.length - 1, Math.max(0, Math.round(time / stepSec)))]
  // Require the shape to stay changed on the next count too, so a fidget is not count 1.
  const index = grid.findIndex((time, i) => at(time) >= threshold && (grid[i + 1] === undefined || at(grid[i + 1]) >= holdThreshold))
  return index < 0 ? null : { index, strength: at(grid[index]) }
}

/**
 * Which position in the repeating eight-count is "1", from the music: count 1 (and, more weakly,
 * count 5) usually carries the strongest downbeat accents. Returns null when the clip is too short
 * or the accents show no clear pattern.
 */
export function musicPhase(accents: number[]): number | null {
  if (accents.length < 16) return null
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const scores = Array.from({ length: 8 }, (_, phase) => {
    const ones = accents.filter((_, index) => (index - phase + 800) % 8 === 0)
    const fives = accents.filter((_, index) => (index - phase + 800) % 8 === 4)
    return mean(ones) + 0.5 * mean(fives)
  })
  const best = scores.indexOf(Math.max(...scores))
  const sorted = [...scores].sort((a, b) => b - a)
  // Ambiguous when the runner-up is nearly as strong (and is not just the "5" of the same grid).
  const runnerUp = scores.map((score, phase) => ({ score, phase })).filter((item) => item.phase !== best && item.phase !== (best + 4) % 8).sort((a, b) => b.score - a.score)[0]
  return sorted[0] > 0 && (!runnerUp || sorted[0] - runnerUp.score > 0.05 * Math.abs(sorted[0])) ? best : null
}

export function buildCountGrid(beats: number[], motion: number[], motionStepSec: number, duration: number, overrides: GridOverrides = {}, deviation: number[] = [], accents: number[] = []): CountGrid {
  const beatSec = beats.length > 1 ? (beats.at(-1)! - beats[0]) / (beats.length - 1) : 0.5
  const options = [0.5, 1, 2].map((beatsPerCount) => {
    const countSec = beatSec * beatsPerCount
    const prior = Math.exp(-0.5 * (Math.log2(60 / countSec / PREFERRED_COUNTS_PER_MINUTE) / 0.35) ** 2)
    return { beatsPerCount, countSec, prior, motionFit: Math.max(0, periodicity(motion, motionStepSec, countSec)) }
  }).filter((option) => option.countSec >= 0.3 && option.countSec <= 1.3)
  const byPrior = options.reduce((best, option) => (option.prior > best.prior ? option : best))
  const byMotion = options.reduce((best, option) => (option.motionFit > best.motionFit ? option : best))
  const automatic = byMotion.motionFit > 2.5 * Math.max(byPrior.motionFit, 1e-9) && byMotion.prior > 0.05 ? byMotion : byPrior
  const chosen = options.find((option) => option.beatsPerCount === overrides.beatsPerCount) ?? automatic

  const danceStartSec = detectDanceStart(motion, motionStepSec)
  let grid: number[]
  if (chosen.beatsPerCount === 0.5) {
    grid = beats.flatMap((beat, index) => (beats[index + 1] === undefined ? [beat] : [beat, (beat + beats[index + 1]) / 2]))
  } else if (chosen.beatsPerCount === 2) {
    // Half time has two phase options; count 1 should sit on the beat nearest the dance start.
    const phases = [0, 1].map((offset) => beats.filter((_, index) => index % 2 === offset))
    // Prefer the first clear shape change; the start of motion is only a fallback.
    // The phase whose first hit is the strongest shape change carries the counts.
    const hits = phases.map((phase) => firstHitIndex(phase, deviation, motionStepSec)).map((found, offset) => (found ? { time: phases[offset][found.index], strength: found.strength } : null))
    const strongest = hits.filter((found) => found !== null).sort((a, b) => b.strength - a.strength)[0]
    const anchor = strongest?.time ?? danceStartSec ?? beats[0]
    const distance = (times: number[]) => Math.min(...times.map((time) => Math.abs(time - anchor)))
    grid = distance(phases[0]) <= distance(phases[1]) ? phases[0] : phases[1]
  } else {
    grid = beats
  }

  // Where the dancing starts, from movement (null before dancers are tracked).
  const hit = firstHitIndex(grid, deviation, motionStepSec)
  let movementIndex: number | null = hit?.index ?? null
  if (movementIndex === null && danceStartSec !== null) {
    const index = grid.findIndex((time) => time >= danceStartSec - chosen.countSec * 0.5)
    movementIndex = index < 0 ? null : index
  }
  // Which counts are a "1", from the music's accents on the count grid.
  const accentAt = (time: number) => {
    let best = -Infinity
    beats.forEach((beat, index) => { if (Math.abs(beat - time) < 0.06) best = Math.max(best, accents[index] ?? 0) })
    return Number.isFinite(best) ? best : 0
  }
  const phase = accents.length === beats.length ? musicPhase(grid.map(accentAt)) : null
  let firstIndex = movementIndex ?? 0
  if (phase !== null) {
    // Eight-counts follow the music; the dance starts on the musical "1" nearest the first move.
    const ones = grid.map((_, index) => index).filter((index) => (index - phase) % 8 === 0)
    firstIndex = movementIndex === null ? ones[0] : ones.reduce((best, index) => (Math.abs(index - movementIndex!) < Math.abs(best - movementIndex!) ? index : best), ones[0])
  }
  firstIndex = Math.max(0, Math.min(grid.length - 1, firstIndex + (overrides.shiftCounts ?? 0)))
  const counts = grid.slice(firstIndex).filter((time) => time < duration)
  const countIn = grid.slice(Math.max(0, firstIndex - 4), firstIndex)
  return { countSec: chosen.countSec, beatsPerCount: chosen.beatsPerCount, counts, countIn, danceStartSec }
}

/* ---------------------------------------------------------------- phrases ------------------- */


/**
 * Eight-count phrases from the count grid, starting at count 1 (the count-in is excluded). A
 * trailing phrase is kept when at least six of its counts fall inside the clip; its remaining
 * counts continue the grid past the end.
 */
export function phrasesFromGrid(grid: CountGrid, roles: RoleTarget[], duration: number): Phrase[] {
  const phrases: Phrase[] = []
  for (let start = 0; start < grid.counts.length; start += 8) {
    const inside = grid.counts.slice(start, start + 8)
    if (inside.length < 6) break
    const times = [...inside]
    while (times.length < 8) times.push(times.at(-1)! + grid.countSec)
    const counts = times.map((timeSec, index) => ({ count: (index + 1) as CountMark['count'], timeSec }))
    const endSec = times[7] + grid.countSec
    const number = phrases.length + 1
    phrases.push({
      id: `phrase-${number}`,
      label: `Eight-count ${number}${inside.length < 8 || endSec > duration + 0.05 ? ' (clip ends early)' : ''}`,
      startSec: times[0],
      endSec: Math.min(endSec, duration),
      counts,
      roles,
      teachingChunks: [
        { startCount: 1, endCount: 4, instruction: 'Counts 1–4: follow the cues for each count below.' },
        { startCount: 5, endCount: 8, instruction: 'Counts 5–8: follow the cues and land the final position on 8.' },
      ],
    })
  }
  return phrases
}
