const bridge = window.paperMachineSetup
const element = id => document.getElementById(id)
let messages
function busy(value) {
  for (const id of ['install', 'continue', 'choose-home', 'reset-home', 'source', 'custom', 'packages']) element(id).disabled = value
  element('cancel').hidden = !value
}
async function action(run) {
  busy(true)
  try { await run() } catch (error) { element('status').textContent = String(error) } finally { busy(false) }
}
bridge.progress(message => { element('status').textContent = message })
bridge.state().then(state => {
  messages = state.locale.messages
  document.documentElement.lang = state.locale.id
  element('version').textContent = state.version
  element('home').textContent = state.home
  element('description').textContent = messages.setupDescription
  element('reset-home').textContent = messages.resetHome
  element('choose-home').textContent = messages.chooseHome
  element('source-label').textContent = messages.packageSource
  element('custom-label').textContent = messages.customPackages
  element('use-custom').textContent = messages.useCustomPackages
  element('confirmation').textContent = messages.setupConfirmation
  element('install').textContent = messages.installEnvironment
  element('continue').textContent = messages.keepEnvironment
  element('cancel').textContent = messages.cancel
  element('packages').value = state.declaration.packages.join('\n')
  element('summary').textContent = messages.packageSummary.replace('{count}', String(state.declaration.packages.length)).replace('{megabytes}', String(Math.round(state.declaration.estimatedDownloadBytes / 1000000)))
  for (const source of state.declaration.sources) {
    const option = document.createElement('option')
    option.value = source.id
    option.textContent = source.name
    element('source').append(option)
  }
  element('source').value = state.defaultSource
  element('continue').hidden = state.status.kind !== 'bound'
  if (state.status.kind === 'invalid') element('status').textContent = state.status.reason
  element('install').disabled = false
}).catch(error => { element('status').textContent = String(error) })
element('install').onclick = () => action(() => bridge.install(element('source').value, element('custom').checked ? element('packages').value.split(/\r?\n/u).map(value => value.trim()).filter(Boolean) : undefined))
element('continue').onclick = () => action(() => bridge.continue())
element('choose-home').onclick = () => action(() => bridge.chooseHome())
element('cancel').onclick = () => { void bridge.cancel().catch(error => { element('status').textContent = String(error) }) }
element('reset-home').onclick = () => action(() => bridge.resetHome())
