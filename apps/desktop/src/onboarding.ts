/**
 * Renderer controller for onboarding's single route into a Science
 * environment: install one, standard or customised, from a chosen package
 * source.
 */

import type { CurrentEnvironment, DesktopOnboardingBridge, OfferedEnvironment, OfferedSource } from './preload.ts'

declare global {
  interface Window {
    readonly desktopOnboarding: DesktopOnboardingBridge
  }
}

const installSummaryElement = document.querySelector('#install-summary')
const currentEnvironmentElement = document.querySelector('#current-environment')
const currentIdElement = document.querySelector('#current-id')
const currentRevisionElement = document.querySelector('#current-revision')
const currentStatusElement = document.querySelector('#current-status')
const currentPrefixElement = document.querySelector('#current-prefix')
const reinstallNoticeElement = document.querySelector('#reinstall-notice')
const keepCurrentElement = document.querySelector('#keep-current')
const packagesElement = document.querySelector('#packages')
const advancedElement = document.querySelector('#advanced')
const customPackagesElement = document.querySelector('#custom-packages')
const provisionElement = document.querySelector('#provision')
const provisionCustomElement = document.querySelector('#provision-custom')
const confirmElement = document.querySelector('#confirm')
const confirmDetailElement = document.querySelector('#confirm-detail')
const confirmSourcesElement = document.querySelector('#confirm-sources')
const confirmStartElement = document.querySelector('#confirm-start')
const confirmCancelElement = document.querySelector('#confirm-cancel')
const progressElement = document.querySelector('#progress')
const progressPhaseElement = document.querySelector('#progress-phase')
const progressMessageElement = document.querySelector('#progress-message')
const cancelElement = document.querySelector('#cancel')
const statusElement = document.querySelector('#status')
if (!(installSummaryElement instanceof HTMLParagraphElement)
  || !(currentEnvironmentElement instanceof HTMLElement)
  || !(currentIdElement instanceof HTMLElement)
  || !(currentRevisionElement instanceof HTMLElement)
  || !(currentStatusElement instanceof HTMLElement)
  || !(currentPrefixElement instanceof HTMLElement)
  || !(reinstallNoticeElement instanceof HTMLParagraphElement)
  || !(keepCurrentElement instanceof HTMLButtonElement)
  || !(packagesElement instanceof HTMLUListElement)
  || !(advancedElement instanceof HTMLDetailsElement)
  || !(customPackagesElement instanceof HTMLTextAreaElement)
  || !(provisionElement instanceof HTMLButtonElement)
  || !(provisionCustomElement instanceof HTMLButtonElement)
  || !(confirmElement instanceof HTMLElement)
  || !(confirmDetailElement instanceof HTMLParagraphElement)
  || !(confirmSourcesElement instanceof HTMLDivElement)
  || !(confirmStartElement instanceof HTMLButtonElement)
  || !(confirmCancelElement instanceof HTMLButtonElement)
  || !(progressElement instanceof HTMLElement)
  || !(progressPhaseElement instanceof HTMLParagraphElement)
  || !(progressMessageElement instanceof HTMLParagraphElement)
  || !(cancelElement instanceof HTMLButtonElement)
  || !(statusElement instanceof HTMLParagraphElement)) {
  throw new Error('desktop onboarding: required controls are missing')
}
const installSummary = installSummaryElement
const currentEnvironment = currentEnvironmentElement
const currentId = currentIdElement
const currentRevision = currentRevisionElement
const currentStatus = currentStatusElement
const currentPrefix = currentPrefixElement
const reinstallNotice = reinstallNoticeElement
const keepCurrent = keepCurrentElement
const packages = packagesElement
const advanced = advancedElement
const customPackages = customPackagesElement
const provision = provisionElement
const provisionCustom = provisionCustomElement
const confirm = confirmElement
const confirmDetail = confirmDetailElement
const confirmSources = confirmSourcesElement
const confirmStart = confirmStartElement
const confirmCancel = confirmCancelElement
const progress = progressElement
const progressPhase = progressPhaseElement
const progressMessage = progressMessageElement
const cancel = cancelElement
const statusNode = statusElement

const ENVIRONMENTS_UNAVAILABLE_MESSAGE = '无法读取环境清单 · The environment list could not be read.'
const EMPTY_CUSTOM_MESSAGE = '自定义清单不能为空 · The custom list cannot be empty.'

// The shipped environment, once `desktop:environments` has answered. Absent
// until then and after a failed read, which is what disables Install.
let standard: OfferedEnvironment | undefined
// The machine's applied pointer, independently of whether its revision still
// matches the declaration this build offers.
let current: CurrentEnvironment | undefined
// What the confirm panel is currently asking the user to approve, cleared
// when they confirm or dismiss it.
let pending: { readonly packages?: readonly string[]; readonly detail: string } | undefined
// The source chosen in the confirm panel's radio group, seeded from the
// offered environment's `defaultSourceId` each time the panel opens.
let selectedSourceId: string | undefined

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

/**
 * Render the confirm panel's package-source radio group: one choice per
 * offered source, preselecting `selected` (falling back to the first source
 * if `selected` names none of them).
 * @param sources - the environment's sources, in fallback order.
 * @param selected - the source id to preselect.
 */
function renderSources(sources: readonly OfferedSource[], selected: string | undefined): void {
  confirmSources.replaceChildren()
  const preselect = sources.some(source => source.id === selected) ? selected : sources[0]?.id
  selectedSourceId = preselect
  for (const source of sources) {
    const label = document.createElement('label')
    label.className = 'choice'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'package-source'
    input.value = source.id
    input.checked = source.id === preselect
    input.addEventListener('change', () => { selectedSourceId = source.id })
    const copy = document.createElement('span')
    const strong = document.createElement('strong')
    strong.textContent = source.name
    copy.append(strong)
    label.append(input, copy)
    confirmSources.append(label)
  }
}

/**
 * Render the shipped environment's advertised size, its package list, and
 * the prefilled custom editor. The custom editor starts from exactly the
 * shipped list so "customise" means editing a working set rather than
 * composing one from nothing.
 */
function renderStandard(environment: OfferedEnvironment): void {
  standard = environment
  const reinstalling = current?.id === environment.id && current.revision === environment.revision
  provision.textContent = reinstalling
    ? '重新安装 · Reinstall'
    : '下载并安装 · Download and install'
  reinstallNotice.textContent = `重新安装会再次下载 ${formatBytes(environment.estimatedDownloadBytes)}。 · Reinstalling will download ${formatBytes(environment.estimatedDownloadBytes)} again.`
  reinstallNotice.hidden = !reinstalling
  installSummary.textContent = `${environment.name}：${String(environment.packages.length)} 个包，约 ${formatBytes(environment.estimatedDownloadBytes)} 下载，需要 ${formatBytes(environment.requiredFreeBytes)} 可用磁盘空间。 · ${String(environment.packages.length)} packages, about ${formatBytes(environment.estimatedDownloadBytes)} to download, ${formatBytes(environment.requiredFreeBytes)} of free disk required.`
  packages.replaceChildren(...environment.packages.map((name) => {
    const item = document.createElement('li')
    item.textContent = name
    return item
  }))
  customPackages.value = environment.packages.join('\n')
}

/** Render the applied environment summary which remains actionable while onboarding is open. */
function renderCurrent(environment: CurrentEnvironment): void {
  current = environment
  currentId.textContent = environment.id
  currentRevision.textContent = environment.revision
  currentStatus.textContent = environment.status
  currentPrefix.textContent = environment.prefix
  currentEnvironment.hidden = false
}

/** Enable or disable every control that starts new work, for the lifetime of one provisioning run. */
function setBusy(busy: boolean): void {
  provision.disabled = busy || standard === undefined
  provisionCustom.disabled = busy
  keepCurrent.disabled = busy
}

/** Show the confirm panel for a download the user has not yet approved. */
function askToConfirm(detail: string, custom?: readonly string[]): void {
  pending = { detail, ...(custom === undefined ? {} : { packages: custom }) }
  confirmDetail.textContent = detail
  renderSources(standard?.sources ?? [], standard?.defaultSourceId)
  confirm.hidden = false
  statusNode.textContent = ''
}

function dismissConfirm(): void {
  pending = undefined
  confirm.hidden = true
}

async function loadEnvironments(): Promise<void> {
  provision.disabled = true
  try {
    const [offered, applied] = await Promise.all([
      window.desktopOnboarding.environments(),
      window.desktopOnboarding.currentEnvironment(),
    ])
    const shipped = offered[0]
    if (shipped === undefined) throw new Error(ENVIRONMENTS_UNAVAILABLE_MESSAGE)
    if (applied !== undefined) renderCurrent(applied)
    renderStandard(shipped)
    provision.disabled = false
  } catch (error) {
    installSummary.textContent = error instanceof Error ? error.message : String(error)
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
  const sourceId = selectedSourceId
  dismissConfirm()
  setBusy(true)
  progress.hidden = false
  cancel.disabled = false
  progressPhase.textContent = '准备中… Preparing…'
  progressMessage.textContent = ''
  statusNode.textContent = ''
  try {
    await (approved.packages === undefined
      ? window.desktopOnboarding.provision(standard?.id ?? '', sourceId ?? '')
      : window.desktopOnboarding.provisionCustom(approved.packages, sourceId ?? ''))
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    statusNode.textContent = errorText
    progress.hidden = true
    setBusy(false)

    let copyBtn = document.querySelector('#copy-diagnostics') as HTMLButtonElement | null
    if (!copyBtn) {
      copyBtn = document.createElement('button')
      copyBtn.id = 'copy-diagnostics'
      copyBtn.className = 'choice'
      copyBtn.style.marginTop = '12px'
      copyBtn.style.cursor = 'pointer'
      copyBtn.textContent = '📋 一键复制报错诊断 · Copy Diagnostic Report'
      copyBtn.addEventListener('click', () => {
        const report = `## PaperMachine Environment Install Failure\n- Platform: ${navigator.platform}\n- UserAgent: ${navigator.userAgent}\n- Time: ${new Date().toISOString()}\n- Error:\n```\n${errorText}\n```\n`
        void navigator.clipboard.writeText(report).then(() => {
          if (copyBtn) copyBtn.textContent = '✓ 已复制诊断信息 · Copied!'
          setTimeout(() => { if (copyBtn) copyBtn.textContent = '📋 一键复制报错诊断 · Copy Diagnostic Report' }, 2000)
        })
      })
      statusNode.parentElement?.append(copyBtn)
    }
  }
}

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
keepCurrent.addEventListener('click', () => {
  keepCurrent.disabled = true
  statusNode.textContent = ''
  void window.desktopOnboarding.keepCurrentEnvironment().catch((error: unknown) => {
    statusNode.textContent = error instanceof Error ? error.message : String(error)
    keepCurrent.disabled = false
  })
})
window.desktopOnboarding.onProvisioningProgress((update) => {
  progress.hidden = false
  if (update.phase === 'installing' && update.retryAttempt && update.retryAttempt.index > 1) {
    progressPhase.textContent = `安装中 · Installing (源 ${String(update.retryAttempt.index)}/${String(update.retryAttempt.total)})`
  } else {
    progressPhase.textContent = update.phase
  }

  let text = update.message
  if (update.phase === 'installing') {
    const metrics: string[] = []
    if (update.currentPackage) metrics.push(`[${update.currentPackage}]`)
    if (update.percent !== undefined) metrics.push(`${update.percent.toFixed(0)}%`)
    if (update.bytesDownloaded !== undefined && update.bytesTotal !== undefined) {
      metrics.push(`${formatBytes(update.bytesDownloaded)} / ${formatBytes(update.bytesTotal)}`)
    }
    if (update.speedBytesPerSec !== undefined) {
      metrics.push(`${formatBytes(update.speedBytesPerSec)}/s`)
    }
    if (update.etaSeconds !== undefined) {
      const mins = Math.floor(update.etaSeconds / 60)
      const secs = update.etaSeconds % 60
      metrics.push(`ETA ${mins > 0 ? `${String(mins)}m ${String(secs)}s` : `${String(secs)}s`}`)
    }
    if (metrics.length > 0) {
      text = `${metrics.join(' · ')}\n${update.message}`
    }
  }
  progressMessage.textContent = text
})

// The loud status this window opened with (an invalid binding found at
// launch), if any.
const entryStatus = await window.desktopOnboarding.onboardingStatus()
if (entryStatus !== undefined) statusNode.textContent = entryStatus
await loadEnvironments()
