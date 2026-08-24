/** Desktop-owned Host composition applied above the generic Web bundle. */

/** Render the immutable Science product and provisioned Runtime overlay. */
export function renderDesktopRuntimeOverlay(prefix: string): string {
  const path = JSON.stringify(prefix)
  return `- id: science-runtime\n  config:\n    profiles:\n      science:\n        pythonPrefix: ${path}\n        rPrefix: ${path}\n- id: agent-presets\n  config:\n    default: science\n- id: ui-agent-preset\n  disabled: true\n`
}
