const api = window.paperMachineRecovery
let messages
const node = id => document.getElementById(id)
api.state().then(state => {
  messages = state.locale.messages
  document.documentElement.lang = state.locale.id
  node('title').textContent = messages.startupFailed
  node('message').textContent = state.message
  node('choose').textContent = messages.chooseHome
  node('reset').textContent = messages.resetHome
  node('restart').textContent = messages.restart
  node('copy').textContent = messages.copyDiagnostics
  node('quit').textContent = messages.quit
}).catch(error => { node('message').textContent = String(error) })
for (const id of ['choose', 'reset', 'restart', 'quit']) node(id).onclick = async () => {
  for (const button of document.querySelectorAll('button')) button.disabled = true
  try { await api[id]() } catch (error) { node('message').textContent = String(error) }
  finally { for (const button of document.querySelectorAll('button')) button.disabled = false }
}
node('copy').onclick = async () => {
  try {
    await api.copy()
    node('copy-status').textContent = messages.diagnosticsCopied
  } catch (error) {
    node('copy-status').textContent = messages.diagnosticsCopyFailed.replace('{error}', String(error))
  }
}
