import { useEffect } from 'react'

/** Fallback product name for a composition with no brand plugin (headless, ACP, a bare local source-launch run). */
const DEFAULT_CLIENT_TITLE = 'DSH Local Build'

/** Props for the browser title projection. */
export interface DocumentTitleProps {
  /** Durable title of the selected session, or undefined for the product title alone. */
  title?: string
  /** Active build's product name (the `clientBrand` service, resolved by the caller); {@link DEFAULT_CLIENT_TITLE} when absent. */
  productName?: string
}

/**
 * Project the selected durable session title into the browser title and
 * restore the brand-selected product name when unmounted.
 * @param props - Selected session title and resolved product-name projection.
 * @returns No rendered content.
 */
export function DocumentTitle({ title, productName }: DocumentTitleProps): null {
  const productTitle = productName ?? DEFAULT_CLIENT_TITLE
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`
    return () => { document.title = productTitle }
  }, [productTitle, title])
  return null
}
