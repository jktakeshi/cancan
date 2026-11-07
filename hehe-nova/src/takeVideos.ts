/*
 * Recorded take videos (webcam with every overlay and the music) kept in this browser's IndexedDB,
 * so a learner can rewatch earlier takes next to the feedback they got. Nothing leaves the device.
 */

export type SavedTakeVideo = {
  id: string
  rehearsalId: string
  roleId: string
  phraseId: string
  takeNumber: number
  createdAt: number
  score: number | null
  /** The one correction the learner was given for this take. */
  fix: string
  mimeType: string
  blob: Blob
}

const DB_NAME = 'hehe-take-videos'
const STORE = 'takes'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveTakeVideo(video: SavedTakeVideo): Promise<boolean> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(video)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    return true
  } catch {
    // Storage can be full or blocked; the take is still playable for this session.
    return false
  }
}

/** Saved takes for one rehearsal, role, and phrase, newest first. */
export async function listTakeVideos(rehearsalId: string, roleId: string, phraseId: string): Promise<SavedTakeVideo[]> {
  try {
    const db = await open()
    const all = await new Promise<SavedTakeVideo[]>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as SavedTakeVideo[])
      request.onerror = () => reject(request.error)
    })
    return all.filter((item) => item.rehearsalId === rehearsalId && item.roleId === roleId && item.phraseId === phraseId).sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function deleteTakeVideo(id: string): Promise<void> {
  try {
    const db = await open()
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** File extension for a recorder MIME type. */
export const videoExtension = (mimeType: string) => (mimeType.includes('mp4') ? 'mp4' : 'webm')

/** The best recording format this browser supports. */
export function recorderMimeType(): string {
  const candidates = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) ?? ''
}
