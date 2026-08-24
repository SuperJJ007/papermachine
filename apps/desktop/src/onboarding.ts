/** Renderer controller for detecting and independently binding a Python and an R conda-family environment. */

import type { DesktopOnboardingBridge } from './preload.ts'
import type { CondaCandidate } from './detection.ts'

declare global {
  interface Window {
    readonly desktopOnboarding: DesktopOnboardingBridge
  }
}

const pythonSectionElement = document.querySelector('#python-section')
const pythonChoicesElement = document.querySelector('#python-choices')
const rSectionElement = document.querySelector('#r-section')
const rChoicesElement = document.querySelector('#r-choices')
const guidanceElement = document.querySelector('#guidance')
const guidanceMessageElement = document.querySelector('#guidance-message')
const bindElement = document.querySelector('#bind')
const redetectElement = document.querySelector('#redetect')
const statusElement = document.querySelector('#status')
if (!(pythonSectionElement instanceof HTMLElement)
  || !(pythonChoicesElement instanceof HTMLDivElement)
  || !(rSectionElement instanceof HTMLElement)
  || !(rChoicesElement instanceof HTMLDivElement)
  || !(guidanceElement instanceof HTMLDivElement)
  || !(guidanceMessageElement instanceof HTMLParagraphElement)
  || !(bindElement instanceof HTMLButtonElement)
  || !(redetectElement instanceof HTMLButtonElement)
  || !(statusElement instanceof HTMLParagraphElement)) {
  throw new Error('desktop onboarding: required controls are missing')
}
const pythonSection = pythonSectionElement
const pythonChoices = pythonChoicesElement
const rSection = rSectionElement
const rChoices = rChoicesElement
const guidance = guidanceElement
const guidanceMessage = guidanceMessageElement
const bind = bindElement
const redetect = redetectElement
const statusNode = statusElement

const NOTHING_DETECTED_MESSAGE = '未检测到可用环境 · No usable environment was detected.'
const DETECTION_FAILED_MESSAGE = '检测失败 · Detection failed.'

// The prefix chosen in each group, or `undefined` when that group's "不绑定
// / None" option is selected (or nothing has rendered yet). `desktop:bind`
// takes both independently — a Python-only, R-only, or both-interpreters
// binding are all valid, matching environment-binding.ts's own
// pythonPrefix/rPrefix independence.
let pythonSelected: string | undefined
let rSelected: string | undefined

function updateBindEnabled(): void {
  bind.disabled = pythonSelected === undefined && rSelected === undefined
}

/** Best-effort `--version` text for a candidate's interpreter, or a copy fallback when the probe failed. */
const VERSION_UNAVAILABLE = '解释器版本未知 · interpreter version unavailable'

/**
 * Render one interpreter group's single-select radio choices: an explicit
 * "不绑定 / None" option first, then every candidate whose {@link
 * CondaCandidate.presence} has this interpreter — presence, not a
 * successful `--version` probe, is the qualification authority, so a
 * candidate whose probe failed (or timed out) still appears here with
 * {@link VERSION_UNAVAILABLE} in place of its version. A candidate with
 * both interpreters appears in both groups. The group section itself is
 * shown whenever detection found any candidate at all, even one with zero
 * matches for this interpreter, so a Python-only machine still shows an R
 * group offering only None.
 *
 * Preselects `previousSelection` when it still names a candidate in this
 * render (preserving the user's choice across a re-detect that still finds
 * it), otherwise the first matching candidate in detection's root-scan
 * order, or None if there is no match.
 * @param section - the group's `<section>`, hidden when detection found nothing at all.
 * @param container - the group's choice-list container.
 * @param name - the radio input group name (must not collide with the other group's).
 * @param candidates - every candidate detection found, filtered here to this interpreter's presence.
 * @param interpreter - which interpreter this group selects for.
 * @param previousSelection - the prefix selected in this group before this render, if any.
 * @param onSelect - called with the chosen prefix (`undefined` for None) on
 *   every selection change, including once during render for the preselection.
 */
function renderGroup(
  section: HTMLElement,
  container: HTMLDivElement,
  name: string,
  candidates: readonly CondaCandidate[],
  interpreter: 'python' | 'r',
  previousSelection: string | undefined,
  onSelect: (prefix: string | undefined) => void,
): void {
  container.replaceChildren()
  section.hidden = candidates.length === 0

  const noneInput = document.createElement('input')
  noneInput.type = 'radio'
  noneInput.name = name
  noneInput.value = ''
  noneInput.addEventListener('change', () => { onSelect(undefined) })
  const noneStrong = document.createElement('strong')
  noneStrong.textContent = '不绑定 · None'
  const noneCopy = document.createElement('span')
  noneCopy.append(noneStrong)
  const noneLabel = document.createElement('label')
  noneLabel.className = 'choice'
  noneLabel.append(noneInput, noneCopy)
  container.append(noneLabel)

  const matching = candidates.filter(candidate => (interpreter === 'python' ? candidate.presence.python : candidate.presence.r))
  const preselectPrefix = previousSelection !== undefined && matching.some(candidate => candidate.prefix === previousSelection)
    ? previousSelection
    : matching[0]?.prefix

  for (const candidate of matching) {
    const version = (interpreter === 'python' ? candidate.pythonVersion : candidate.rVersion) ?? VERSION_UNAVAILABLE
    const label = document.createElement('label')
    label.className = 'choice'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = name
    input.value = candidate.prefix
    input.addEventListener('change', () => { onSelect(candidate.prefix) })
    const copy = document.createElement('span')
    const strong = document.createElement('strong')
    strong.textContent = candidate.prefix
    const small = document.createElement('small')
    small.textContent = version
    copy.append(strong, small)
    label.append(input, copy)
    container.append(label)
    if (candidate.prefix === preselectPrefix) input.checked = true
  }
  if (preselectPrefix === undefined) noneInput.checked = true
  onSelect(preselectPrefix)
}

/** Reset both groups and Bind to their pre-detection state: hidden, unselected, disabled. */
function resetSelectionState(): void {
  pythonSelected = undefined
  rSelected = undefined
  updateBindEnabled()
  pythonSection.hidden = true
  rSection.hidden = true
  pythonChoices.replaceChildren()
  rChoices.replaceChildren()
}

function renderCandidates(candidates: readonly CondaCandidate[]): void {
  guidanceMessage.textContent = NOTHING_DETECTED_MESSAGE
  guidance.hidden = candidates.length > 0
  renderGroup(pythonSection, pythonChoices, 'python-environment', candidates, 'python', pythonSelected, (prefix) => {
    pythonSelected = prefix
    updateBindEnabled()
  })
  renderGroup(rSection, rChoices, 'r-environment', candidates, 'r', rSelected, (prefix) => {
    rSelected = prefix
    updateBindEnabled()
  })
}

async function runDetection(): Promise<void> {
  redetect.disabled = true
  statusNode.textContent = '检测中… Detecting…'
  try {
    renderCandidates(await window.desktopOnboarding.detect())
    statusNode.textContent = entryStatus ?? ''
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : String(error)
    resetSelectionState()
    guidanceMessage.textContent = DETECTION_FAILED_MESSAGE
    guidance.hidden = false
  } finally {
    redetect.disabled = false
  }
}

async function bindSelected(): Promise<void> {
  if (pythonSelected === undefined && rSelected === undefined) return
  bind.disabled = true
  redetect.disabled = true
  statusNode.textContent = '绑定中… Binding…'
  try {
    await window.desktopOnboarding.bind({
      ...(pythonSelected === undefined ? {} : { pythonPrefix: pythonSelected }),
      ...(rSelected === undefined ? {} : { rPrefix: rSelected }),
    })
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
