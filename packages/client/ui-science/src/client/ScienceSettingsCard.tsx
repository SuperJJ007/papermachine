/**
 * The Science settings card: the fixed `science` profile's Python and R
 * Conda prefixes, keyed on the `science-runtime` namespace R6a's
 * `with-settings` Runtime entry registers.
 *
 * A stored prefix never rides a response, so a configured field renders a
 * neutral "configured" badge and an empty input; typing replaces it, leaving
 * the field blank is a no-op, and the reset action removes only the
 * user-layer override. Every successful change requires a Host restart,
 * which the card states after it lands.
 */

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

/** One prefix field's control: label, configured badge, and the staged-text input. */
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
        <span className={css.badge}>{state.configured ? props.configuredLabel : props.notConfiguredLabel}</span>
      </div>
      <input
        id={props.id}
        className={state.invalid ? css.inputInvalid : css.input}
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
 * component only for a namespace the Host serves, so the card renders a
 * loading line before the first accepted section and the fields afterward —
 * it carries no "namespace absent" branch of its own.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ScienceSettingsCard(props: ScienceSettingsCardProps) {
  const { t } = props
  const state = props.useScienceSettingsCard(snapshot => snapshot)
  if (state.loading) {
    return (
      <li className={css.card}>
        <p className={css.notice} role="status">{t('settings.loading')}</p>
      </li>
    )
  }
  const disabled = !state.writable || state.saving
  const editField = (field: ScienceProfileField) => (text: string) => { props.edit(field, text) }
  return (
    <li className={css.card}>
      <div className={css.head}>
        <span className={css.name}>{t('settings.title')}</span>
        <span className={css.description}>{t('settings.description')}</span>
      </div>
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
            <button type="button" className={css.reset} disabled={disabled} onClick={props.reset}>
              {t('settings.reset')}
            </button>
          )
          : null}
        <button type="button" disabled={!state.dirty || state.saving} onClick={props.discard}>
          {t('settings.discard')}
        </button>
        <button type="button" disabled={!state.dirty || state.invalid || state.saving} onClick={props.save}>
          {t(state.saving ? 'settings.saving' : 'settings.save')}
        </button>
      </div>
    </li>
  )
}
