/**
 * downloads domain zod schemas. The download surface has no wire envelope:
 * each request arrives as query parameters or URL path segments (all
 * strings, already percent-decoded by the carrier), so its request schema
 * parses that raw string record into the method's exact request shape.
 * SessionId brand cast point: sessionIdSchema, and only there (hosted in
 * sessions.schema like every other cast); VersionId's own cast point is
 * scienceVersionIdSchema, hosted the same way.
 */

import { z } from 'zod'
import type { DownloadsApi } from './downloads.ts'
import { scienceVersionIdSchema, sessionIdSchema } from './sessions.schema.ts'

/**
 * session.export query params → the sessionLog request. `includeDescendants`
 * accepts exactly `true`/`false`/absent; any other value is rejected (400) so
 * a misspelled flag cannot silently under-export.
 */
export const sessionLogQuerySchema = z
  .object({
    sessionId: sessionIdSchema,
    includeDescendants: z.union([z.literal('true'), z.literal('false')]).optional(),
  })
  .transform(query => ({
    sessionId: query.sessionId,
    ...(query.includeDescendants === 'true' ? { includeDescendants: true } : {}),
  })) satisfies z.ZodType<Parameters<DownloadsApi['sessionLog']>[0]>

/**
 * `/api/science/artifact/:sessionId/:versionId` path segments → the
 * scienceArtifact request. No `projectId` segment exists — the route cannot
 * accept one, so a caller cannot select an authorization domain of its own
 * choosing; the session's own fold derives it, exactly as `session.scienceArtifact` does.
 */
export const scienceArtifactDownloadPathSchema = z.object({
  sessionId: sessionIdSchema,
  versionId: scienceVersionIdSchema,
}) satisfies z.ZodType<Parameters<DownloadsApi['scienceArtifact']>[0]>
