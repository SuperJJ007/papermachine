/** Simplified Chinese presentation labels for file tiles, versions, and edit targets. */
export const zh = {
  'display.file.csv': 'CSV',
  'display.file.json': 'JSON',
  'display.file.markdown': 'MD',
  'display.file.plain': 'TXT',
  'display.artifactVersion': '{name} v{version}',
  'display.editTarget': '{name} v{version} · {target}{comment}',
} satisfies Record<string, string>

/** English presentation labels with the same complete key set. */
export const en = {
  'display.file.csv': 'CSV',
  'display.file.json': 'JSON',
  'display.file.markdown': 'MD',
  'display.file.plain': 'TXT',
  'display.artifactVersion': '{name} v{version}',
  'display.editTarget': '{name} v{version} · {target}{comment}',
} satisfies Record<keyof typeof zh, string>
