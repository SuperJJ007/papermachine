/**
 * The settings-namespace scope contract. The type lives here, in the common
 * dependency of every feature that owns a preference, while the implementation
 * and its Host transport live with the Settings surface
 * (`dsh-client-ui-settings`): a feature service accepts a scope through
 * `attachSettings` without depending on the surface that binds it, which would
 * otherwise close a reference cycle.
 */

/**
 * Whether the Host currently holds a value for one schema-declared secret
 * field — presence only; the value itself never reaches the browser, on this
 * type or anywhere else. `path` is ordered from the section root, the same
 * coordinates {@link SettingsScope.setPath} takes, and addresses a
 * `dict`-nested secret by its key.
 */
export interface SettingsSecretPresence {
  /** Ordered field path from the section root; a `dict` entry is addressed by its key. */
  path: readonly string[]
  /** Whether the Host currently holds a value at this path. */
  set: boolean
}

/** Client-side sync state of one settings namespace. */
export interface SettingsScopeSnapshot<T> {
  /**
   * `loading` until the first accepted section, `ready` while one stands, and
   * `unavailable` when the namespace is not exposed to this client or the
   * connection keeps preferences process-local (memory mode).
   */
  status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  value: T | undefined
  /**
   * Redacted value the RUNNING Host owner actually reads, as of the last
   * accepted section. Equal to `value` for a `live`-applies namespace; for a
   * `restart`-applies one, this stays fixed at what the owner read at its own
   * registration even as `value`/`user` move with later writes — the fact a
   * settings card needs to tell "saved" apart from "in effect."
   */
  effective: unknown
  /**
   * Composition layer the Host resolved {@link value} over, when the owning
   * plugin declared one. What a field reverts to once cleared.
   */
  base: unknown
  /**
   * Raw user layer as stored, when one exists. A field's PRESENCE here is what
   * marks it overridden — an override whose value equals the composition
   * default is still an override, and comparing values could not see it.
   */
  user: unknown
  /**
   * Every schema-declared secret field's presence — the only place this
   * snapshot ever answers whether a `role('secret')` field holds a value,
   * since that field's value is never present on {@link value}, {@link base},
   * or {@link user}. Empty before the first accepted Host view.
   */
  secrets: readonly SettingsSecretPresence[]
  /** Namespace revision fencing the next write; undefined before the first Host view. */
  revision: number | undefined
  /** Whether the Host document accepts writes; memory mode never does. */
  writable: boolean
  /** `host` syncs with the Host document; `memory` keeps a remote browser process-local. */
  mode: 'host' | 'memory'
}

/** Domain-owned description of one settings namespace consumed by a browser plugin. */
export interface SettingsScopeSpec<T> {
  /** Settings namespace registered by the owning Host plugin. */
  namespace: string
  /**
   * Narrow one wire section; undefined keeps the last accepted value. The
   * default validates the section against the namespace's own serialized wire
   * schema, so domains add a decoder only to narrow beyond that schema.
   */
  decode?: (section: unknown) => T | undefined
}

/**
 * Reactive owner handle over one namespace's durable section — the browser
 * mirror of the Host-side `SettingsScope` owner seam. Domain services read
 * and observe the snapshot and route explicit user choices through `set`.
 */
export interface SettingsScope<T> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T>
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Queue one path-addressed write, creating intermediate objects along
   * `path` as needed — the primitive {@link set} delegates to with a
   * one-element path. An empty `path` addresses the section root and
   * replaces it wholesale, so `value` must then be a plain object. Rapid
   * writes preserve mutation order, each carries the latest known namespace
   * revision, and only the latest settlement may publish; a rejected or
   * failed latest write reloads Host state instead.
   * @param path - ordered field path from the section root; `[]` is the section root.
   * @param value - JSON-shaped value selected by the user.
   * @returns settlement after the write and any latest-write recovery read.
   */
  setPath(path: readonly string[], value: unknown): Promise<void>
  /**
   * Queue one field write; the single-segment convenience over {@link setPath}.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   * @returns settlement after the write and any latest-write recovery read.
   */
  set(field: string, value: unknown): Promise<void>
  /**
   * Queue one path-addressed clear, so the field at `path` re-inherits the
   * composition layer — the primitive {@link unset} delegates to with a
   * one-element path. An empty `path` clears the whole section. Shares
   * {@link setPath}'s ordering, revision, and recovery contract.
   * @param path - ordered field path from the section root; `[]` is the section root.
   * @returns settlement after the clear and any latest-write recovery read.
   */
  unsetPath(path: readonly string[]): Promise<void>
  /**
   * Queue one field clear, so the field re-inherits the composition layer;
   * the single-segment convenience over {@link unsetPath}.
   * @param field - scalar field inside the namespace section.
   * @returns settlement after the clear and any latest-write recovery read.
   */
  unset(field: string): Promise<void>
}
