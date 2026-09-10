/** Strict `https://` URL validation shared by every desktop-owned closed record whose value reaches a child process argv or a network layer unescaped. */

// Https only, and every character after the scheme is drawn from a fixed
// allowlist (letters, digits, and `._~/-`) that admits no whitespace, control
// character, or shell metacharacter (`;&|$()<>\`'"\\`) — this is a parser
// boundary the value crosses on the way to a child process argv or an HTTP
// request, so it is validated by allowlist rather than by excluding
// known-bad characters. Shared by `environment-declaration.ts`'s conda
// channel URLs and `telemetry-config.ts`'s endpoint URLs.
export const HTTPS_URL = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9._~/-]*[A-Za-z0-9])?$/u
