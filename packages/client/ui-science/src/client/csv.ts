/**
 * Minimal RFC4180-style CSV parser for the artifact viewer's table renderer.
 * Handles quoted fields (embedded commas/newlines, doubled-quote escaping
 * for a literal `"`), `\n`/`\r\n` line endings, and a trailing newline with
 * no synthetic empty row. Hand-rolled rather than a dependency: this is a
 * read-only preview over auto-captured or model-annotated CSV files (never
 * arbitrary untrusted upload), and no second `packages/client` consumer
 * needs CSV parsing yet (`docs/AGENTS.md` "require evidence for public
 * choices") — see the ui-science README for the full home-decision
 * rationale. Rows are not padded to the header width; a short or long row
 * is returned exactly as parsed, and `ArtifactTable` renders a missing cell
 * as empty.
 */

/** One parsed CSV document: the header row plus every data row, in file order. */
export interface ParsedCsv {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

/**
 * Parse UTF-8 CSV text into a header row and data rows.
 * @param text - decoded CSV file content.
 * @returns the header row (first record) and every following record; both empty for blank input.
 */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false

  const endField = (): void => { record.push(field); field = '' }
  const endRecord = (): void => {
    endField()
    records.push(record)
    record = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i)
    if (inQuotes) {
      if (char === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i += 1 } else { inQuotes = false }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') { inQuotes = true; continue }
    if (char === ',') { endField(); continue }
    if (char === '\r') { if (text.charAt(i + 1) === '\n') i += 1; endRecord(); continue }
    if (char === '\n') { endRecord(); continue }
    field += char
  }
  // A trailing newline already closed the last record above (record is
  // empty again). A mid-record comma with no following newline leaves
  // pushed fields in `record`; any other trailing content leaves it in
  // `field`. Either means one more record is still pending flush.
  if (record.length > 0 || field !== '') endRecord()

  const [header, ...rows] = records
  return { header: header ?? [], rows }
}
