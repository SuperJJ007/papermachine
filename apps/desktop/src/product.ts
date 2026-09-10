import product from './product-version.json' with { type: 'json' }

/** Product identity is independent of the installed dsh package release. */
export const PAPER_MACHINE_VERSION = product.version
