/** Private user notes attached to an exact artifact version. */
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactNote } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceRenderableVersion } from './version-summaries.ts'
import type { ScienceDetailsInjected } from './ScienceDetailsView.tsx'
import css from './ScienceDetailsView.module.css'

export function ArtifactNotes({ chart, notes, addArtifactNote, removeArtifactNote, t }: {
  chart: ScienceRenderableVersion
  notes: readonly ScienceArtifactNote[]
  addArtifactNote: ScienceDetailsInjected['addArtifactNote']
  removeArtifactNote: ScienceDetailsInjected['removeArtifactNote']
  t: TranslateNS<'science'>
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  return (
    <section className={css.notes} aria-label={t('notes.title')}>
      <h3>{t('notes.title')}</h3>
      {notes.length === 0 ? null : <ul>{notes.map(note => (
        <li key={note.seq}>
          <span>{note.text}</span>
          <small>{t('notes.version', { version: note.version, time: new Date(note.createdAt).toLocaleString() })}</small>
          <button type="button" aria-label={t('notes.delete')} disabled={pending} onClick={() => {
            setPending(true); setError(undefined)
            void removeArtifactNote({ artifactId: chart.artifactId, noteSeq: note.seq })
              .then((result) => { if (!result.ok) setError(result.error.message) })
              .finally(() => { setPending(false) })
          }}>{t('notes.delete')}</button>
        </li>
      ))}</ul>}
      <form onSubmit={(event) => {
        event.preventDefault()
        const value = text.trim()
        if (value === '') return
        setPending(true); setError(undefined)
        void addArtifactNote({ artifactId: chart.artifactId, version: chart.version, text: value })
          .then((result) => { if (result.ok) setText(''); else setError(result.error.message) })
          .finally(() => { setPending(false) })
      }}>
        <textarea value={text} aria-label={t('notes.input')} placeholder={`${t('notes.placeholder')}\n${t('notes.privacy')}`}
          onChange={(event) => { setText(event.currentTarget.value) }} />
        <button type="submit" disabled={pending || text.trim() === ''}>{t('notes.add')}</button>
      </form>
      {error !== undefined && <p role="alert">{error}</p>}
    </section>
  )
}
