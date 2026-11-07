/*
 * Mono audio from a video file, for beat detection.
 *
 * `decodeAudioData` is tried first. Some browsers reject audio inside QuickTime (.mov) or MP4
 * containers ("Unable to decode audio data"), so the fallback reads the AAC track directly from the
 * container's sample tables and decodes it with WebCodecs `AudioDecoder`.
 */

type Box = { type: string; start: number; end: number; body: number }

function boxes(view: DataView, start: number, end: number): Box[] {
  const found: Box[] = []
  let offset = start
  while (offset + 8 <= end) {
    let size = view.getUint32(offset)
    const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7))
    let body = offset + 8
    if (size === 1) { size = Number(view.getBigUint64(offset + 8)); body = offset + 16 } else if (size === 0) size = end - offset
    if (size < 8 || offset + size > end) break
    found.push({ type, start: offset, end: offset + size, body })
    offset += size
  }
  return found
}

const child = (view: DataView, box: Box | undefined, type: string, skip = 0) => (box ? boxes(view, box.body + skip, box.end).find((item) => item.type === type) : undefined)

/** Search a byte range for a box type at any nesting depth (for esds inside QuickTime 'wave'). */
function findDeep(view: DataView, start: number, end: number, type: string): Box | undefined {
  for (let offset = start; offset + 8 <= end; offset += 1) {
    const size = view.getUint32(offset)
    if (size >= 8 && offset + size <= end && view.getUint8(offset + 4) === type.charCodeAt(0) && view.getUint8(offset + 5) === type.charCodeAt(1) && view.getUint8(offset + 6) === type.charCodeAt(2) && view.getUint8(offset + 7) === type.charCodeAt(3)) {
      return { type, start: offset, end: offset + size, body: offset + 8 }
    }
  }
  return undefined
}

/** MPEG-4 descriptor length: up to four bytes, seven bits each. */
function descriptorLength(view: DataView, offset: number) {
  let length = 0
  let bytes = 0
  for (; bytes < 4; bytes += 1) {
    const value = view.getUint8(offset + bytes)
    length = (length << 7) | (value & 0x7f)
    if (!(value & 0x80)) break
  }
  return { length, next: offset + bytes + 1 }
}

/** AudioSpecificConfig from an 'esds' box. */
function audioSpecificConfig(view: DataView, esds: Box): Uint8Array | null {
  let offset = esds.body + 4
  while (offset < esds.end - 2) {
    const tag = view.getUint8(offset)
    const { length, next } = descriptorLength(view, offset + 1)
    if (tag === 0x05) return new Uint8Array(view.buffer, view.byteOffset + next, length)
    if (tag === 0x03) {
      const flags = view.getUint8(next + 2)
      offset = next + 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x40 ? 1 + view.getUint8(next + 3) : 0) + (flags & 0x20 ? 2 : 0)
    } else if (tag === 0x04) offset = next + 13
    else offset = next + length
  }
  return null
}

export type AacTrack = { config: Uint8Array; sampleRate: number; channels: number; samples: { offset: number; size: number }[] }

/** Locate the AAC audio track's codec config and the byte range of every encoded frame. */
export function readAacTrack(buffer: ArrayBuffer): AacTrack | null {
  const view = new DataView(buffer)
  const moov = boxes(view, 0, view.byteLength).find((box) => box.type === 'moov')
  if (!moov) return null
  for (const trak of boxes(view, moov.body, moov.end).filter((box) => box.type === 'trak')) {
    const mdia = child(view, trak, 'mdia')
    const hdlr = child(view, mdia, 'hdlr')
    if (!hdlr || String.fromCharCode(...new Uint8Array(buffer, hdlr.body + 8, 4)) !== 'soun') continue
    const stbl = child(view, child(view, mdia, 'minf'), 'stbl')
    const stsd = child(view, stbl, 'stsd')
    const entry = stsd && boxes(view, stsd.body + 8, stsd.end)[0]
    if (!entry || entry.type !== 'mp4a') continue
    const channels = view.getUint16(entry.body + 16)
    const sampleRate = view.getUint32(entry.body + 24) >>> 16
    const esds = findDeep(view, entry.body + 28, entry.end, 'esds')
    const config = esds && audioSpecificConfig(view, esds)
    const stsz = child(view, stbl, 'stsz')
    const stsc = child(view, stbl, 'stsc')
    const stco = child(view, stbl, 'stco') ?? child(view, stbl, 'co64')
    if (!config || !stsz || !stsc || !stco) continue

    const fixedSize = view.getUint32(stsz.body + 4)
    const count = view.getUint32(stsz.body + 8)
    const sizes = Array.from({ length: count }, (_, i) => (fixedSize || view.getUint32(stsz.body + 12 + i * 4)))
    const chunkCount = view.getUint32(stco.body + 4)
    const chunkOffsets = Array.from({ length: chunkCount }, (_, i) => (stco.type === 'co64' ? Number(view.getBigUint64(stco.body + 8 + i * 8)) : view.getUint32(stco.body + 8 + i * 4)))
    const runs = Array.from({ length: view.getUint32(stsc.body + 4) }, (_, i) => ({ firstChunk: view.getUint32(stsc.body + 8 + i * 12), perChunk: view.getUint32(stsc.body + 12 + i * 12) }))

    const samples: { offset: number; size: number }[] = []
    let sample = 0
    for (let chunk = 0; chunk < chunkCount && sample < count; chunk += 1) {
      const run = runs.filter((item) => item.firstChunk <= chunk + 1).at(-1)
      let offset = chunkOffsets[chunk]
      for (let i = 0; i < (run?.perChunk ?? 1) && sample < count; i += 1) {
        samples.push({ offset, size: sizes[sample] })
        offset += sizes[sample]
        sample += 1
      }
    }
    return { config, sampleRate, channels, samples }
  }
  return null
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const output = new Float32Array(Math.floor(input.length * to / from))
  for (let i = 0; i < output.length; i += 1) {
    const position = i * from / to
    const index = Math.floor(position)
    const fraction = position - index
    output[i] = input[index] * (1 - fraction) + (input[index + 1] ?? input[index]) * fraction
  }
  return output
}

async function decodeWithWebCodecs(buffer: ArrayBuffer, sampleRate: number): Promise<Float32Array> {
  if (typeof AudioDecoder === 'undefined') throw new Error('This browser cannot decode the video audio (no WebCodecs).')
  const track = readAacTrack(buffer)
  if (!track) throw new Error('No AAC audio track found in the video.')
  const objectType = track.config[0] >> 3
  const parts: Float32Array[] = []
  let failure: unknown = null
  const decoder = new AudioDecoder({
    output: (data) => {
      const mono = new Float32Array(data.numberOfFrames)
      const plane = new Float32Array(data.numberOfFrames)
      for (let channel = 0; channel < data.numberOfChannels; channel += 1) {
        data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' })
        for (let i = 0; i < plane.length; i += 1) mono[i] += plane[i] / data.numberOfChannels
      }
      parts.push(mono)
      data.close()
    },
    error: (error) => { failure = error },
  })
  decoder.configure({ codec: `mp4a.40.${objectType || 2}`, sampleRate: track.sampleRate, numberOfChannels: track.channels, description: track.config })
  track.samples.forEach((sample, index) => {
    decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(index * 1024 / track.sampleRate * 1e6), data: new Uint8Array(buffer, sample.offset, sample.size) }))
  })
  await decoder.flush()
  decoder.close()
  if (failure) throw failure instanceof Error ? failure : new Error('Audio decoding failed.')
  const joined = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { joined.set(part, offset); offset += part.length }
  return resample(joined, track.sampleRate, sampleRate)
}

/** Decode a video's audio track to mono samples at `sampleRate`. */
export async function decodeMonoAudio(buffer: ArrayBuffer, sampleRate: number): Promise<Float32Array> {
  try {
    // An offline context resamples while decoding. decodeAudioData detaches its input, so pass a copy.
    const decoded = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(buffer.slice(0))
    const mono = new Float32Array(decoded.length)
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel)
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / decoded.numberOfChannels
    }
    return mono
  } catch {
    return decodeWithWebCodecs(buffer, sampleRate)
  }
}
