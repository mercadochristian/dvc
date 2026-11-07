import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { superviseChild } from './child-lifecycle.mjs'

for (const [signal, expected] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`forwards ${signal}, waits for harmless child's cleanup, and rejects its interrupted zero exit`, { timeout: 5_000 }, async () => {
    const child = spawn(process.execPath, ['-e', `process.on('${signal}', () => { setTimeout(() => { console.log('cleanup-finished'); process.exit(0) }, 80) }); console.log('ready'); setInterval(() => {}, 1000)`], { stdio: ['ignore', 'pipe', 'pipe'] })
    const signals = new EventEmitter()
    let output = ''
    child.stdout.on('data', data => { output += data })
    const result = superviseChild(child, signals)
    try {
      await once(child.stdout, 'data')
      let settled = false
      result.then(() => { settled = true })
      signals.emit(signal)
      assert.equal(settled, false)
      assert.equal(await result, expected)
      assert.equal(child.exitCode, 0)
      assert.match(output, /cleanup-finished/)
      assert.equal(signals.listenerCount(signal), 0)
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
  })
}
test('preserves ordinary child failures and cleans up both signal handlers', async () => {
  const signals = new EventEmitter()
  const child = spawn(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' })
  assert.equal(await superviseChild(child, signals), 7)
  assert.equal(signals.listenerCount('SIGINT'), 0)
  assert.equal(signals.listenerCount('SIGTERM'), 0)
})
test('reports a child killed by a signal as nonzero', async () => {
  const child = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] })
  const result = superviseChild(child, new EventEmitter())
  await once(child.stdout, 'data')
  child.kill('SIGKILL')
  assert.notEqual(await result, 0)
})

test('translates parent SIGTERM to supported child SIGINT while retaining original 143 result', { timeout: 5_000 }, async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGINT', () => { console.log('received-SIGINT'); process.exit(130) }); console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] })
  const signals = new EventEmitter()
  let output = ''
  child.stdout.on('data', data => { output += data })
  const result = superviseChild(child, signals, { SIGTERM: 'SIGINT' })
  try {
    await once(child.stdout, 'data')
    signals.emit('SIGTERM')
    assert.equal(await result, 143)
    assert.match(output, /received-SIGINT/)
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
})
