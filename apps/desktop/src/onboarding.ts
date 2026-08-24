/** Renderer controller for detecting and binding an existing conda-family environment. */

import type { DesktopOnboardingBridge } from './preload.ts'
import type { CondaCandidate } from './detection.ts'

declare global {
  interface Window {
    readonly desktopOnboarding: DesktopOnboardingBridge
  }
}

const choicesElement = document.querySelector('#choices')
const guidanceElement = document.querySelector('#guidance')
const bindElement = document.querySelector('#bind')
const redetectElement = document.querySelector('#redetect')
const statusElement = document.querySelector('#status')
if (!(choicesElement instanceof HTMLDivElement)
  || !(guidanceElement instanceof HTMLDivElement)
  || !(bindElement instanceof HTMLButtonElement)
  || !(redetectElement instanceof HTMLButtonElement)
  || !(statusElement instanceof HTMLParagraphElement)) {
  throw new Error('desktop onboarding: required controls are missing')
}
const choices = choicesElement
const guidance = guidanceElement
const bind = bindElement
const redetect = redetectElement
const statusNode = statusElement
let selected: string | undefined

function describe(candidate: CondaCandidate): string {
  const parts = [
    ...(candidate.pythonVersion === undefined ? [] : [candidate.pythonVersion]),
    ...(candidate.rVersion === undefined ? [] : [candidate.rVersion]),
  ]
  return parts.length > 0 ? parts.join(' · ') : '解释器版本未知 · interpreter version unavailable'
}

function renderCandidates(candidates: readonly CondaCandidate[]): void {
  choices.replaceChildren()
  selected = undefined
  bind.disabled = true
  guidance.hidden = candidates.length > 0
  choices.hidden = candidates.length === 0
  const preselect = candidates.find(candidate => candidate.pythonVersion !== undefined && candidate.rVersion !== undefined)
  for (const candidate of candidates) {
    const label = document.createElement('label')
    label.className = 'choice'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'environment'
    input.value = candidate.prefix
    input.addEventListener('change', () => {
      selected = candidate.prefix
      bind.disabled = false
    })
    const copy = document.createElement('span')
    const name = document.createElement('strong')
    name.textContent = candidate.prefix
    const detail = document.createElement('small')
    detail.textContent = describe(candidate)
    copy.append(name, detail)
    label.append(input, copy)
    choices.append(label)
    if (preselect === candidate) {
      input.checked = true
      selected = candidate.prefix
      bind.disabled = false
    }
  }
}

async function runDetection(): Promise<void> {
  redetect.disabled = true
  statusNode.textContent = '检测中… Detecting…'
  try {
    renderCandidates(await window.desktopOnboarding.detect())
    statusNode.textContent = entryStatus ?? ''
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    redetect.disabled = false
  }
}

async function bindSelected(): Promise<void> {
  if (selected === undefined) return
  bind.disabled = true
  redetect.disabled = true
  statusNode.textContent = '绑定中… Binding…'
  try {
    await window.desktopOnboarding.bind(selected)
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : String(error)
    bind.disabled = false
    redetect.disabled = false
  }
}

bind.addEventListener('click', () => { void bindSelected() })
redetect.addEventListener('click', () => { void runDetection() })

// The loud status this window opened with (an invalid binding found at
// launch), if any. `runDetection`'s closure above reads this module-scope
// binding once it is set here, before the first `runDetection()` call
// below; detection's own transient "Detecting…"/cleared status must not
// erase it, so a successful detection restores this instead of blanking
// the status line.
const entryStatus = await window.desktopOnboarding.onboardingStatus()
if (entryStatus !== undefined) statusNode.textContent = entryStatus
await runDetection()
