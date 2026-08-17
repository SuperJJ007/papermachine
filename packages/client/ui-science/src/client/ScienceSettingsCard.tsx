/**
 * The Science settings card: the fixed `science` profile's Python and R
 * Conda prefixes, keyed on the `science-runtime` namespace R6a's
 * `with-settings` Runtime entry registers.
 *
 * The card owns its own collapsed-by-default disclosure — the bundle-purity
 * gate forbids importing the Plugins section's `PluginCard` chrome as a
 * value, not owning equivalent chrome, and `docs/cookbook/adding-a-settings-card.md`
 * states a card "owns everything inside it — chrome, controls, and copy".
 * Collapsed, the header is the only content in the accessibility tree: no
 * field, hint, or action button renders until expanded, matching every
 * sibling card in the section.
 *
 * The header disclosure button is hand-rolled rather than built on
 * `DisclosureRow` (`@deepseek-ai/dsh-client-ui-primitives`): that primitive
 * is a compact 24px icon-leading row used by transcript/tool-row chrome
 * (`ReasoningRow`, `ToolRow`, and siblings), not by any settings card —
 * `PluginCard` (`ui-settings-plugins`, the section's own card chrome this
 * package may not import as a value) hand-rolls the identical header-button
 * pattern this component mirrors, for the same two-line name-over-description
 * shape neither `DisclosureRow` nor any other primitive provides. Every
 * other hand-rollable piece IS a shared primitive: prefix fields render
 * through `Input`, the Configured/Not configured badge through `Pill`, and
 * every action button through `Button`, so only the card container's
 * border/radius/background (a single rule; see `ScienceSettingsCard.module.css`)
 * and the header/chevron layout remain this file's own CSS.
 *
 * A stored prefix never rides a response, so a configured field renders a
 * neutral "configured" badge and an empty input; typing replaces it, leaving
 * the field blank is a no-op, and the reset action removes only the
 * user-layer override. Every successful change requires a Host restart,
 * which the card states after it lands.
 */

import { useState } from 'react'
import { Button, IconChevronDownOutline14, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {
  ScienceSettingsCardFace, ScienceSettingsFieldState, ScienceProfileField,
} from './settings-card-controller.ts'
import css from './ScienceSettingsCard.module.css'

/** Props the renderer binds for the Science settings card. */
export type ScienceSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'science'>
  & InjectFace<ScienceSettingsCardFace>

/** One prefix field's control: label, configured badge, and the staged-text input, all shared primitives. */
function PrefixField(props: {
  id: string
  label: string
  hint: string
  configuredLabel: string
  notConfiguredLabel: string
  invalidLabel: string
  disabled: boolean
  state: ScienceSettingsFieldState
  onEdit: (text: string) => void
}) {
  const { state } = props
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        <Pill>{state.configured ? props.configuredLabel : props.notConfiguredLabel}</Pill>
      </div>
      <Input
        id={props.id}
        className={`${css.fieldInput}${state.invalid ? ` ${css.fieldInputInvalid}` : ''}`}
        type="text"
        autoComplete="off"
        {...state.invalid ? { 'aria-invalid': true } : {}}
        value={state.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={state.invalid ? css.invalid : css.hint}>{state.invalid ? props.invalidLabel : props.hint}</p>
    </div>
  )
}

/**
 * Render the Science settings card. The Plugins tab dispatches this
 * component only for a namespace the Host serves — it carries no "namespace
 * absent" branch of its own — and disclosure is local component state, not a
 * card snapshot field: which card a person has open is a reading gesture the
 * Host has no stake in, exactly as the Plugins section's own cards treat it.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ScienceSettingsCard(props: ScienceSettingsCardProps) {
  const { t } = props
  const [open, setOpen] = useState(false)
  const state = props.useScienceSettingsCard(snapshot => snapshot)
  const title = t('settings.title')
  const disabled = !state.writable || state.saving
  const editField = (field: ScienceProfileField) => (text: string) => { props.edit(field, text) }
  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{t('settings.description')}</span>
        </span>
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open ? (
        <div className={css.body}>
          {state.loading ? (
            <p className={css.notice} role="status">{t('settings.loading')}</p>
          ) : (
            <>
              {!state.writable ? <p className={css.notice} role="status">{t('settings.readOnly')}</p> : null}
              {!state.configured ? <p className={css.notice} role="status">{t('settings.unconfiguredHint')}</p> : null}
              <PrefixField
                id="science-settings-python-prefix"
                label={t('settings.pythonPrefix')}
                hint={t('settings.pythonPrefixHint')}
                configuredLabel={t('settings.configured')}
                notConfiguredLabel={t('settings.notConfigured')}
                invalidLabel={t('settings.invalidPath')}
                disabled={disabled}
                state={state.pythonPrefix}
                onEdit={editField('pythonPrefix')}
              />
              <PrefixField
                id="science-settings-r-prefix"
                label={t('settings.rPrefix')}
                hint={t('settings.rPrefixHint')}
                configuredLabel={t('settings.configured')}
                notConfiguredLabel={t('settings.notConfigured')}
                invalidLabel={t('settings.invalidPath')}
                disabled={disabled}
                state={state.rPrefix}
                onEdit={editField('rPrefix')}
              />
              {state.failed ? <p className={css.notice} data-tone="error" role="status">{t('settings.saveFailed')}</p> : null}
              {state.restartRequired ? <p className={css.notice} role="status">{t('settings.restartRequired')}</p> : null}
              <div className={css.footer}>
                {state.overridden
                  ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={css.resetSlot}
                      disabled={disabled}
                      onClick={props.reset}
                    >
                      {t('settings.reset')}
                    </Button>
                  )
                  : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!state.dirty || state.saving}
                  onClick={props.discard}
                >
                  {t('settings.discard')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!state.dirty || state.invalid || state.saving}
                  onClick={props.save}
                >
                  {t(state.saving ? 'settings.saving' : 'settings.save')}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </li>
  )
}
