import type { RehearsalManifest } from './domain'

const finitePoint = (point: { x: number; y: number }) => Number.isFinite(point.x) && Number.isFinite(point.y)

export function validateManifest(manifest: RehearsalManifest): string[] {
  const errors: string[] = []
  const phraseIds = new Set<string>()

  if (!manifest.title.trim()) errors.push('The rehearsal title is required.')
  if (manifest.referenceCalibration.widthM <= 0 || manifest.referenceCalibration.depthM <= 0) {
    errors.push('Reference floor dimensions must be positive.')
  }
  if (!manifest.referenceCalibration.corners.every(finitePoint)) errors.push('Reference calibration contains invalid points.')
  if (manifest.phrases.length === 0) errors.push('At least one phrase is required.')

  for (const phrase of manifest.phrases) {
    if (phraseIds.has(phrase.id)) errors.push(`Duplicate phrase ID: ${phrase.id}.`)
    phraseIds.add(phrase.id)
    if (!(phrase.startSec >= 0 && phrase.endSec > phrase.startSec)) errors.push(`${phrase.label} has invalid time bounds.`)
    if (phrase.counts.length !== 8) errors.push(`${phrase.label} must define counts 1 through 8.`)
    phrase.counts.forEach((mark, index) => {
      if (mark.count !== index + 1) errors.push(`${phrase.label} has unordered count marks.`)
      if (mark.timeSec < phrase.startSec || mark.timeSec > phrase.endSec) errors.push(`${phrase.label} count ${mark.count} lies outside the phrase.`)
      if (index > 0 && mark.timeSec <= phrase.counts[index - 1].timeSec) errors.push(`${phrase.label} count marks must increase.`)
    })
    if (phrase.roles.length < 2) errors.push(`${phrase.label} needs at least two roles.`)
    const roleIds = new Set<string>()
    for (const role of phrase.roles) {
      if (roleIds.has(role.id)) errors.push(`${phrase.label} has duplicate role ID ${role.id}.`)
      roleIds.add(role.id)
      if (role.highlights.length === 0) errors.push(`${role.label} needs highlight keyframes.`)
      if (role.pathFloor.length < 2) errors.push(`${role.label} needs a formation path.`)
      if (!finitePoint(role.finishFloor)) errors.push(`${role.label} has an invalid finish target.`)
      if (!role.poseTargets.some((target) => target.count === 8 && target.landmarks.length >= 29)) {
        errors.push(`${role.label} needs a count-eight body-pose target.`)
      }
    }
    for (const chunk of phrase.teachingChunks) {
      if (chunk.startCount < 1 || chunk.endCount > 8 || chunk.endCount < chunk.startCount) {
        errors.push(`${phrase.label} has an invalid teaching chunk.`)
      }
    }
  }

  return errors
}

