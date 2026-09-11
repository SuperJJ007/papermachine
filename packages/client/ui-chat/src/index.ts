/** Host registration for browser Chat preferences. */

import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_TURN_OUTPUT_COLLAPSED_COUNT, TURN_OUTPUT_COUNT_GLOBAL } from './turn-output-config.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { CHAT_SETTINGS_NAMESPACE, ChatSettingsSchema } from './chat-settings.ts'

export {
  CHAT_SETTINGS_NAMESPACE, DEFAULT_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD,
  TRANSCRIPT_VIEW_MODES, type ChatSettings, type TranscriptViewMode,
} from './chat-settings.ts'

/** Deployment-wide item count for each collapsed Turn output group. */
export interface Config {
  /** Positive number of cards visible before disclosure. */
  turnOutputCollapsedCount: number
}

/** Validate the deployment display limit before publishing it to the browser. */
export const Config: z<Config> = z.object({
  turnOutputCollapsedCount: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_TURN_OUTPUT_COLLAPSED_COUNT),
})

/**
 * Register Chat settings and publish resolved display configuration.
 * @param ctx - Host context.
 * @param config - Schema-resolved deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (rows) => {
    rows.push({ kind: 'global', name: TURN_OUTPUT_COUNT_GLOBAL, value: config.turnOutputCollapsedCount })
  })
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      CHAT_SETTINGS_NAMESPACE,
      ChatSettingsSchema,
    )
  })
}
