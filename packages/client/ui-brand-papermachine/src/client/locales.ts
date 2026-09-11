/** PaperMachine wordmark dictionary; the registered brand remains unchanged in both languages. */
export const zh = {
  'wordmark.paper': 'Paper',
  'wordmark.machine': 'Machine',
} satisfies Record<string, string>

/** Keys owned by the PaperMachine brand namespace. */
export type BrandKey = keyof typeof zh

/** English dictionary with the same required keys as Simplified Chinese. */
export const en = {
  'wordmark.paper': 'Paper',
  'wordmark.machine': 'Machine',
} satisfies Record<BrandKey, string>
