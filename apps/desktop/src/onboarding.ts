/** Renderer controller for onboarding's two routes into a Science environment: bind one already on this machine, or install one. */

import type { DesktopOnboardingBridge, OfferedEnvironment } from './preload.ts'
import type { CondaCandidate } from './detection.ts'

declare global {
  interface Window {
    readonly desktopOnboarding: DesktopOnboardingBridge
  }
}

const detectedElement = document.querySelector('#detected')
const pythonSectionElement = document.querySelector('#python-section')
const pythonChoicesElement = document.querySelector('#python-choices')
const rSectionElement = document.querySelector('#r-section')
const rChoicesElement = document.querySelector('#r-choices')
const guidanceElement = document.querySelector('#guidance')
const guidanceMessageElement = document.querySelector('#guidance-message')
const bindElement = document.querySelector('#bind')
const redetectElement = document.querySelector('#redetect')
const installSummaryElement = document.querySelector('#install-summary')
const packagesElement = document.querySelector('#packages')
const advancedElement = document.querySelector('#advanced')
const customPackagesElement = document.querySelector('#custom-packages')
const provisionElement = document.querySelector('#provision')
const provisionCustomElement = document.querySelector('#provision-custom')
const confirmElement = document.querySelector('#confirm')
const confirmDetailElement = document.querySelector('#confirm-detail')
const confirmStartElement = document.querySelector('#confirm-start')
const confirmCancelElement = document.querySelector('#confirm-cancel')
const progressElement = document.querySelector('#progress')
const progressPhaseElement = document.querySelector('#progress-phase')
const progressMessageElement = document.querySelector('#progress-message')
const cancelElement = document.querySelector('#cancel')
const statusElement = document.querySelector('#status')
if (!(detectedElement instanceof HTMLElement)
  || !(pythonSectionElement instanceof HTMLElement)
  || !(pythonChoicesElement instanceof HTMLDivElement)
  || !(rSectionElement instanceof HTMLElement)
  || !(rChoicesElement instanceof HTMLDivElement)
  || !(guidanceElement instanceof HTMLDivElement)
  || !(guidanceMessageElement instanceof HTMLParagraphElement)
  || !(bindElement instanceof HTMLButtonElement)
  || !(redetectElement instanceof HTMLButtonElement)
  || !(installSummaryElement instanceof HTMLParagraphElement)
  || !(packagesElement instanceof HTMLUListElement)
  || !(advancedElement instanceof HTMLDetailsElement)
  || !(customPackagesElement instanceof HTMLTextAreaElement)
  || !(provisionElement instanceof HTMLButtonElement)
  || !(provisionCustomElement instanceof HTMLButtonElement)
  || !(confirmElement instanceof HTMLElement)
  || !(confirmDetailElement instanceof HTMLParagraphElement)
  || !(confirmStartElement instanceof HTMLButtonElement)
  || !(confirmCancelElement instanceof HTMLButtonElement)
  || !(progressElement instanceof HTMLElement)
  || !(progressPhaseElement instanceof HTMLParagraphElement)
  || !(progressMessageElement instanceof HTMLParagraphElement)
  || !(cancelElement instanceof HTMLButtonElement)
  || !(statusElement instanceof HTMLParagraphElement)) {
  throw new Error('desktop onboarding: required controls are missing')
}
const detected = detectedElement
const pythonSection = pythonSectionElement
const pythonChoices = pythonChoicesElement
const rSection = rSectionElement
const rChoices = rChoicesElement
const guidance = guidanceElement
const guidanceMessage = guidanceMessageElement
const bind = bindElement
const redetect = redetectElement
const installSummary = installSummaryElement
const packages = packagesElement
const advanced = advancedElement
const customPackages = customPackagesElement
const provision = provisionElement
const provisionCustom = provisionCustomElement
const confirm = confirmElement
const confirmDetail = confirmDetailElement
const confirmStart = confirmStartElement
const confirmCancel = confirmCancelElement
const progress = progressElement
const progressPhase = progressPhaseElement
const progressMessage = progressMessageElement
const cancel = cancelElement
const statusNode = statusElement

const NOTHING_DETECTED_MESSAGE = '未检测到本机环境，可以直接安装下面的标准环境。 · No environment was found on this machine; install the standard one below.'
const DETECTION_FAILED_MESSAGE = '检测失败，仍可安装下面的标准环境。 · Detection failed; the standard environment below can still be installed.'
const ENVIRONMENTS_UNAVAILABLE_MESSAGE = '无法读取环境清单 · The environment list could not be read.'
const EMPTY_CUSTOM_MESSAGE = '自定义清单不能为空 · The custom list cannot be empty.'

// The prefix chosen in each group, or `undefined` when that group's "不绑定
// / None" option is selected (or nothing has rendered yet). `desktop:bind`
// takes both independently — a Python-only, R-only, or both-interpreters
// binding are all valid, matching environment-binding.ts's own
// pythonPrefix/rPrefix independence.
let pythonSelected: string | undefined
let rSelected: string | undefined
// The shipped environment, once `desktop:environments` has answered. Absent
// until then and after a failed read, which is what disables Install.
let standard: OfferedEnvironment | undefined
// What the confirm panel is currently asking the user to approve, cleared
// when they confirm or dismiss it.
let pending: { readonly packages?: readonly string[]; readonly detail: string } | undefined

function updateBindEnabled(): void {
  bind.disabled = pythonSelected === undefined && rSelected === undefined
}

/**
 * Render a byte count the way the confirm panel states it: whole megabytes
 * below a gigabyte, one decimal above. Decimal units (not binary) because
 * the number is read against a download, which is how transfer sizes are
 * quoted everywhere else the user will see one.
 * @param bytes - the count to render.
 */
function formatBytes(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${String(Math.round(bytes / 1_000_000))} MB`
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
  detected.hidden = true
  pythonSection.hidden = true
  rSection.hidden = true
  pythonChoices.replaceChildren()
  rChoices.replaceChildren()
}

function renderCandidates(candidates: readonly CondaCandidate[]): void {
  guidanceMessage.textContent = NOTHING_DETECTED_MESSAGE
  guidance.hidden = candidates.length > 0
  detected.hidden = candidates.length === 0
  renderGroup(pythonSection, pythonChoices, 'python-environment', candidates, 'python', pythonSelected, (prefix) => {
    pythonSelected = prefix
    updateBindEnabled()
  })
  renderGroup(rSection, rChoices, 'r-environment', candidates, 'r', rSelected, (prefix) => {
    rSelected = prefix
    updateBindEnabled()
  })
}

/**
 * Render the shipped environment's advertised size, its package list, and
 * the prefilled custom editor. The custom editor starts from exactly the
 * shipped list so "customise" means editing a working set rather than
 * composing one from nothing.
 */
function renderStandard(environment: OfferedEnvironment): void {
  standard = environment
  installSummary.textContent = `${environment.name}：${String(environment.packages.length)} 个包，约 ${formatBytes(environment.estimatedDownloadBytes)} 下载，需要 ${formatBytes(environment.requiredFreeBytes)} 可用磁盘空间。 · ${String(environment.packages.length)} packages, about ${formatBytes(environment.estimatedDownloadBytes)} to download, ${formatBytes(environment.requiredFreeBytes)} of free disk required.`
  packages.replaceChildren(...environment.packages.map((name) => {
    const item = document.createElement('li')
    item.textContent = name
    return item
  }))
  customPackages.value = environment.packages.join('\n')
}

/** Enable or disable every control that starts new work, for the lifetime of one provisioning run. */
function setBusy(busy: boolean): void {
  redetect.disabled = busy
  provision.disabled = busy || standard === undefined
  provisionCustom.disabled = busy
  bind.disabled = busy || (pythonSelected === undefined && rSelected === undefined)
}

/** Show the confirm panel for a download the user has not yet approved. */
function askToConfirm(detail: string, custom?: readonly string[]): void {
  pending = { detail, ...(custom === undefined ? {} : { packages: custom }) }
  confirmDetail.textContent = detail
  confirm.hidden = false
  statusNode.textContent = ''
}

function dismissConfirm(): void {
  pending = undefined
  confirm.hidden = true
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

async function loadEnvironments(): Promise<void> {
  provision.disabled = true
  try {
    const offered = await window.desktopOnboarding.environments()
    const shipped = offered[0]
    if (shipped === undefined) throw new Error(ENVIRONMENTS_UNAVAILABLE_MESSAGE)
    renderStandard(shipped)
    provision.disabled = false
  } catch (error) {
    installSummary.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function bindSelected(): Promise<void> {
  if (pythonSelected === undefined && rSelected === undefined) return
  dismissConfirm()
  setBusy(true)
  bind.disabled = true
  statusNode.textContent = '绑定中… Binding…'
  try {
    await window.desktopOnboarding.bind({
      ...(pythonSelected === undefined ? {} : { pythonPrefix: pythonSelected }),
      ...(rSelected === undefined ? {} : { rPrefix: rSelected }),
    })
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : String(error)
    setBusy(false)
  }
}

/**
 * Run the download the confirm panel is holding. The workspace opens from
 * the main process when the run succeeds, so this window is replaced rather
 * than returning to a ready state; only a failure re-enables the page.
 */
async function startConfirmed(): Promise<void> {
  const approved = pending
  if (approved === undefined) return
  dismissConfirm()
  setBusy(true)
  progress.hidden = false
  cancel.disabled = false
  progressPhase.textContent = '准备中… Preparing…'
  progressMessage.textContent = ''
  statusNode.textContent = ''
  try {
    await (approved.packages === undefined
      ? window.desktopOnboarding.provision(standard?.id ?? '')
      : window.desktopOnboarding.provisionCustom(approved.packages))
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : String(error)
    progress.hidden = true
    setBusy(false)
  }
}

bind.addEventListener('click', () => { void bindSelected() })
redetect.addEventListener('click', () => { void runDetection() })
advanced.addEventListener('toggle', () => { provisionCustom.hidden = !advanced.open })
provision.addEventListener('click', () => {
  if (standard === undefined) return
  askToConfirm(`即将下载 ${standard.name}：约 ${formatBytes(standard.estimatedDownloadBytes)}。 · About to download ${standard.name}: roughly ${formatBytes(standard.estimatedDownloadBytes)}.`)
})
provisionCustom.addEventListener('click', () => {
  const list = customPackages.value.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  if (list.length === 0) {
    statusNode.textContent = EMPTY_CUSTOM_MESSAGE
    return
  }
  askToConfirm(`即将按自定义清单安装 ${String(list.length)} 个包，下载量取决于清单本身。 · About to install ${String(list.length)} packages from the edited list; the download size depends on the list.`, list)
})
confirmStart.addEventListener('click', () => { void startConfirmed() })
confirmCancel.addEventListener('click', () => { dismissConfirm() })
cancel.addEventListener('click', () => {
  cancel.disabled = true
  progressPhase.textContent = '正在取消… Cancelling…'
  void window.desktopOnboarding.cancelProvisioning()
})
window.desktopOnboarding.onProvisioningProgress((update) => {
  progress.hidden = false
  progressPhase.textContent = update.phase
  progressMessage.textContent = update.message
})

// The loud status this window opened with (an invalid binding found at
// launch), if any. `runDetection`'s closure above reads this module-scope
// binding once it is set here, before the first `runDetection()` call
// below; detection's own transient "Detecting…"/cleared status must not
// erase it, so a successful detection restores this instead of blanking
// the status line.
const entryStatus = await window.desktopOnboarding.onboardingStatus()
if (entryStatus !== undefined) statusNode.textContent = entryStatus
await loadEnvironments()
await runDetection()
