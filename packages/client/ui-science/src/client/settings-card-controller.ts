/**
 * The Science settings card's own staged form over the `science-runtime`
 * settings namespace.
 *
 * `pythonPrefix`/`rPrefix` are `role('secret')` fields declared directly
 * inside the namespace section (`attachRuntimeSettings` registers the
 * namespace with `base: config.profiles`, so the section root IS the profile
 * map, not a wrapper field named `profiles`), so every wire read strips their
 * values from `value`/`base`/`user` alike — a present `science` key still
 * carries no field, whichever fields are actually set. Per-field presence
 * comes from `SettingsScopeSnapshot.secrets`, whose entries carry the field's
 * path from the section root — `['science', 'pythonPrefix']` for the fixed
 * profile this card edits — and whether the Host currently holds a value
 * there. This controller reads that list off the scope's own snapshot; it
 * never calls a wire method directly, and every write goes through the bound
 * `SettingsScope`, which owns revision fencing, write ordering, and
 * stale-write recovery.
 */

import type { SettingsScope, SettingsSecretPresence, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Namespace R6a's `with-settings` Runtime entry registers. Spelled here
 * rather than imported: a client package must not depend on a Host package.
 */
export const SCIENCE_RUNTIME_NS = 'science-runtime'

/**
 * Fixed profile id the shipped `science` preset addresses. Other deployment
 * profile ids remain file/configuration concerns this card does not manage.
 */
const PROFILE_ID = 'science'

/** The two profile fields this card edits. */
export type ScienceProfileField = 'pythonPrefix' | 'rPrefix'

const FIELDS: readonly ScienceProfileField[] = ['pythonPrefix', 'rPrefix']

/**
 * The redacted `science-runtime` namespace section as the browser ever sees
 * it: a present profile id always resolves to an object with neither secret
 * field, whichever fields the Host actually holds.
 */
export type ScienceRuntimeSettingsSection = Readonly<Record<string, Readonly<Record<string, never>>>>

/** One prefix field as the card's control renders it. */
export interface ScienceSettingsFieldState {
  /** Draft text the control renders; blank until typed, since a stored path never rides a response. */
  text: string
  /** Whether the Host currently holds a value for this field. */
  configured: boolean
  /** Whether the current draft is not an absolute path, which blocks the save. */
  invalid: boolean
}

/** What the Science settings card renders. */
export interface ScienceSettingsCardState {
  /** True before the first accepted section; the card shows a loading line, not the fields. */
  loading: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the `science` profile exists, from either the composition base or a user override. */
  configured: boolean
  /** Whether a user-layer override exists for the reset action to remove. */
  overridden: boolean
  /** The Python prefix field. */
  pythonPrefix: ScienceSettingsFieldState
  /** The R prefix field. */
  rPrefix: ScienceSettingsFieldState
  /** Whether any field holds a non-blank staged draft. */
  dirty: boolean
  /** Whether a staged draft blocks the save. */
  invalid: boolean
  /** Whether a save or reset is crossing the wire. */
  saving: boolean
  /** Whether the last save or reset did not land as staged; cleared by the next edit, save, or reset. */
  failed: boolean
  /** Whether any change has landed this session; every successful change requires a Host restart to apply. */
  restartRequired: boolean
}

/** The write actions the card's slot entry injects. */
export interface ScienceSettingsCardActions {
  /** Stage draft text for one field. */
  edit: (field: ScienceProfileField, text: string) => void
  /** Write every staged non-blank field, then confirm from the scope's own republished presence. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
  /** Remove the user-layer `science` profile, revealing the composition base if one exists. */
  reset: () => void
}

/** The registration-side face the card's slot entry injects. */
export interface ScienceSettingsCardFace extends ScienceSettingsCardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useScienceSettingsCard. */
    scienceSettingsCard: SnapshotStore<ScienceSettingsCardState>
  }
}

/** Whether a value is a plain data object whose own keys this controller may read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Advisory client-side absolute-path check. The Host's own validation
 * (`science-runtime`'s `parseProfiles`) remains the authority; this only
 * blocks an obviously relative draft before it reaches the wire.
 * @param text - trimmed draft text.
 * @returns whether the text looks like a POSIX, Windows drive, or UNC absolute path.
 */
function looksAbsolute(text: string): boolean {
  return /^\//.test(text) || /^[A-Za-z]:[/\\]/.test(text) || /^\\\\/.test(text)
}

/**
 * Whether the scope's own secret-presence list marks one field as currently
 * holding a value.
 * @param secrets - {@link SettingsScopeSnapshot.secrets} for the bound namespace.
 * @param field - the field to look up under the fixed `science` profile id.
 * @returns whether that field is set.
 */
function secretIsSet(secrets: readonly SettingsSecretPresence[], field: ScienceProfileField): boolean {
  return secrets.some(secret => secret.set && secret.path.length === 2
    && secret.path[0] === PROFILE_ID && secret.path[1] === field)
}

/** Bridges the `science-runtime` scope onto the Science settings card. */
export class ScienceSettingsCardController {
  private readonly store: SnapshotStore<ScienceSettingsCardState>
  private readonly staged = new Map<ScienceProfileField, string>()
  private saving = false
  private failed = false
  private restartRequired = false

  /** @param scope - the bound settings scope for the `science-runtime` namespace. */
  constructor(private readonly scope: SettingsScope<ScienceRuntimeSettingsSection>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.publish() })
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): ScienceSettingsCardFace {
    return {
      hooks: { scienceSettingsCard: this.store },
      edit: (field, text) => {
        this.staged.set(field, text)
        this.failed = false
        this.publish()
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
      reset: () => { void this.resetProfile() },
    }
  }

  /**
   * Write every staged non-blank, valid field, then read whether it landed
   * off the scope's own republished secret-presence list — the write's
   * settlement already reflects the Host's accepted view or its stale-write
   * recovery read, so no separate poll is needed.
   * @returns settlement after every write.
   */
  async save(): Promise<void> {
    const dirty = this.dirtyFields()
    if (dirty.length === 0 || this.saving || dirty.some(entry => !looksAbsolute(entry.text))) return
    this.saving = true
    this.failed = false
    this.publish()
    for (const entry of dirty) {
      await this.scope.setPath([PROFILE_ID, entry.field], entry.text)
    }
    const landed = dirty.every(entry => this.isSet(entry.field))
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    if (landed) this.restartRequired = true
    this.publish()
  }

  /**
   * Remove the user-layer `science` profile, then confirm removal from the
   * scope's own user layer, whose key presence survives redaction and
   * updates synchronously with the write's settlement.
   * @returns settlement after the clear.
   */
  async resetProfile(): Promise<void> {
    if (this.saving || !this.currentlyOverridden()) return
    this.saving = true
    this.failed = false
    this.publish()
    await this.scope.unsetPath([PROFILE_ID])
    const landed = !this.currentlyOverridden()
    this.saving = false
    this.failed = !landed
    if (landed) {
      this.restartRequired = true
      this.staged.clear()
    }
    this.publish()
  }

  private isSet(field: ScienceProfileField): boolean {
    return secretIsSet(this.scope.getSnapshot().secrets, field)
  }

  private currentlyOverridden(): boolean {
    const user = this.scope.getSnapshot().user
    return isRecord(user) && Object.hasOwn(user, PROFILE_ID)
  }

  /**
   * Every field with a non-blank staged draft, trimmed once.
   * @returns the dirty fields, in FIELDS order.
   */
  private dirtyFields(): { field: ScienceProfileField; text: string }[] {
    const dirty: { field: ScienceProfileField; text: string }[] = []
    for (const field of FIELDS) {
      const text = (this.staged.get(field) ?? '').trim()
      if (text !== '') dirty.push({ field, text })
    }
    return dirty
  }

  private field(field: ScienceProfileField): ScienceSettingsFieldState {
    const text = this.staged.get(field) ?? ''
    const trimmed = text.trim()
    return { text, configured: this.isSet(field), invalid: trimmed !== '' && !looksAbsolute(trimmed) }
  }

  private projection(): ScienceSettingsCardState {
    const snapshot = this.scope.getSnapshot()
    const configured = isRecord(snapshot.value) && Object.hasOwn(snapshot.value, PROFILE_ID)
    const dirty = this.dirtyFields()
    return {
      loading: snapshot.status !== 'ready',
      writable: snapshot.writable,
      configured,
      overridden: this.currentlyOverridden(),
      pythonPrefix: this.field('pythonPrefix'),
      rPrefix: this.field('rPrefix'),
      dirty: dirty.length > 0,
      invalid: dirty.some(entry => !looksAbsolute(entry.text)),
      saving: this.saving,
      failed: this.failed,
      restartRequired: this.restartRequired,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
