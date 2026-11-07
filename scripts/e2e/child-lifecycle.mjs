/** Forward cancellation to an owned child and wait for its streams/process to close. */
export function superviseChild(child, signalSource = process, signalMap = {}) {
  return new Promise(resolve => {
    let interrupted = 0
    let failed = false
    const handlers = new Map()
    for (const [signal, result] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const forward = () => {
        interrupted ||= result
        if (child.exitCode === null && child.signalCode === null) child.kill(signalMap[signal] || signal)
      }
      handlers.set(signal, forward)
      signalSource.on(signal, forward)
    }
    child.once('error', () => { failed = true })
    child.once('close', (code, signal) => {
      for (const [name, handler] of handlers) signalSource.removeListener(name, handler)
      // Cooperative children can report zero after cancellation. The wrapper
      // must still fail so an interrupted acceptance run cannot appear green.
      resolve(failed ? 1 : interrupted || (code !== null && code !== 0 ? code : signal ? 1 : code ?? 1))
    })
  })
}
