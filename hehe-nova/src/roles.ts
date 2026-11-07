import type { RoleTarget } from './domain'

/*
 * Roles generated from a dancer count. Dancers are numbered left to right as the camera sees them
 * when tracking starts; a role can be moved to another dancer with "Wrong dancer? Pick…".
 */

function hslToHex(hue: number, saturation: number, lightness: number) {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Bright, well-separated colors (golden-angle hues), always as #rrggbb so alpha can be appended. */
export function roleColor(index: number) {
  return hslToHex((index * 137.508 + 340) % 360, 0.85, index % 2 ? 0.62 : 0.68)
}

export function makeRoles(count: number): RoleTarget[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    id: `dancer-${index + 1}`,
    label: `Dancer ${index + 1}`,
    color: roleColor(index),
    // Positions and pose targets come from the video, not from hand-written metadata.
    highlights: [],
    startFloor: { x: 0, y: 0 },
    pathFloor: [],
    finishFloor: { x: 0, y: 0 },
    poseTargets: [],
    movementEvents: [],
  }))
}
