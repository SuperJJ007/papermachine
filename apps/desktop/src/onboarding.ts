/** Renderer controller for discipline selection and environment provisioning. */

import type { DesktopOnboardingBridge } from './preload.ts'

declare global {
  interface Window {
    readonly desktopOnboarding: DesktopOnboardingBridge
  }
}

const choicesElement = document.querySelector('#choices')
const startElement = document.querySelector('#start')
const cancelElement = document.querySelector('#cancel')
const progressElement = document.querySelector('#progress')
const statusElement = document.querySelector('#status')
if (!(choicesElement instanceof HTMLDivElement)
  || !(startElement instanceof HTMLButtonElement)
  || !(cancelElement instanceof HTMLButtonElement)
  || !(progressElement instanceof HTMLProgressElement)
  || !(statusElement instanceof HTMLParagraphElement)) {
  throw new Error('desktop onboarding: required controls are missing')
}
const choices = choicesElement
const start = startElement
const cancel = cancelElement
const progress = progressElement
const statusNode = statusElement
let selected: string | undefined

function bytes(value: number): string {
  return `${(value / 1_000_000_000).toFixed(1)} GB`
}

for (const item of await window.desktopOnboarding.environments()) {
  const label = document.createElement('label')
  label.className = 'choice'
  const input = document.createElement('input')
  input.type = 'radio'
  input.name = 'environment'
  input.value = item.id
  input.addEventListener('change', () => {
    selected = item.id
    start.disabled = false
  })
  const copy = document.createElement('span')
  const name = document.createElement('strong')
  name.textContent = item.name
  const size = document.createElement('small')
  size.textContent = `${bytes(item.estimatedDownloadBytes)} download · ${bytes(item.requiredFreeBytes)} free space`
  copy.append(name, size)
  label.append(input, copy)
  choices.append(label)
}

window.desktopOnboarding.onProgress((update) => {
  progress.hidden = false
  statusNode.textContent = update.message
})

async function startProvisioning(): Promise<void> {
  if (selected === undefined) return
  start.disabled = true
  cancel.hidden = false
  statusNode.textContent = 'Starting…'
  try {
    await window.desktopOnboarding.provision(selected)
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : String(error)
    start.disabled = false
    start.textContent = 'Retry'
    cancel.hidden = true
  }
}

start.addEventListener('click', () => { void startProvisioning() })

async function cancelProvisioning(): Promise<void> {
  await window.desktopOnboarding.cancel()
  cancel.hidden = true
}

cancel.addEventListener('click', () => { void cancelProvisioning() })
