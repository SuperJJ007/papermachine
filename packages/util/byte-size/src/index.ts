/**
 * Byte-count display formatting: one pure function turning a byte count into
 * a compact `B`/`KB`/`MB` label, shared by any capability or Client package
 * that shows a file or attachment size without owning byte-count semantics
 * itself.
 * @module @deepseek-ai/dsh-byte-size
 */

/**
 * Human-readable byte count as a compact `B`/`KB`/`MB` label. Not localized:
 * every current consumer renders unlocalized model- or developer-facing
 * text, matching the register of an unlocalized file extension.
 * @param bytes - exact byte count.
 * @returns a compact `B`/`KB`/`MB` label, one decimal place above 1024 bytes.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
