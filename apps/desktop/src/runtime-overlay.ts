/** Desktop-owned Host composition applied above the generic Web bundle. */

/** The prefix(es) to bind into the `science` profile; at least one is required. */
export interface RuntimeOverlayPrefixes {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
}

/**
 * Render the immutable Science product and bound Runtime overlay.
 * @param prefixes - the Python and/or R prefix to bind; at least one is required.
 * @throws when neither prefix is present.
 */
export function renderDesktopRuntimeOverlay(prefixes: RuntimeOverlayPrefixes): string {
  if (prefixes.pythonPrefix === undefined && prefixes.rPrefix === undefined) {
    throw new Error('desktop runtime overlay: requires pythonPrefix or rPrefix')
  }
  const fields = [
    ...(prefixes.pythonPrefix === undefined ? [] : [`        pythonPrefix: ${JSON.stringify(prefixes.pythonPrefix)}`]),
    ...(prefixes.rPrefix === undefined ? [] : [`        rPrefix: ${JSON.stringify(prefixes.rPrefix)}`]),
  ].join('\n')
  return `- id: science-runtime\n  config:\n    profiles:\n      science:\n${fields}\n- id: agent-presets\n  config:\n    default: science\n- id: ui-agent-preset\n  disabled: true\n`
}
