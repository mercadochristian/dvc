import { test } from 'node:test'
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { validateConfiguration, validateContainers, applicationEnvironment, loadConfiguration, repositoryRoot, projectId, appOwnedEnvironment } from './target-guard.mjs'
function fixture() {
  const secret = 'qa-only-unit-secret-with-more-than-thirty-two-characters'
  const token = role => { const data = [ { alg: 'HS256' }, { role, exp: Math.floor(Date.now() / 1000) + 3600 } ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.'); return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}` }
  const config = { schemaVersion: 1, purpose: 'dvc-e2e', repositoryRoot, projectId, runId: randomUUID(), appUrl: 'http://127.0.0.1:3317', supabaseUrl: 'http://127.0.0.1:54331', databaseUrl: 'postgresql://postgres@127.0.0.1:54332/postgres', organizationId: randomUUID(), sessionSecret: secret, jwtSecret: secret, anonKey: token('anon'), serviceRoleKey: token('service_role'), containers: Object.fromEntries(['gateway','database','auth','rest','storage'].map((role, index) => [role, String(index + 1).repeat(64)])) }
  const containers = Object.entries(config.containers).map(([role, Id]) => ({ Id, Name: `/${role}_${projectId}`, State: { Running: true }, Config: { Labels: { 'com.supabase.cli.project': projectId }, Env: role === 'auth' ? [`GOTRUE_DB_DATABASE_URL=postgresql://postgres@database_${projectId}:5432/postgres`] : [`${role === 'rest' ? 'PGRST_DB_URI' : 'DATABASE_URL'}=postgresql://postgres@database_${projectId}:5432/postgres`] }, HostConfig: { NetworkMode: `network_${projectId}` }, NetworkSettings: { Networks: { [`network_${projectId}`]: {} }, Ports: role === 'gateway' ? { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '54331' }] } : role === 'database' ? { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54332' }] } : {} } }))
  return { config, containers }
}
test('accepts explicit owned local metadata; this does not test a live stack', () => { const { config, containers } = fixture(); validateConfiguration(config); assert.equal(validateContainers(config, containers), true) })
test('rejects absent QA config rather than falling back to developer environment', () => assert.throws(() => loadConfiguration({}), /DVC_E2E_ENV_FILE/))
test('rejects remote, shared/default ports and malformed URLs', () => {
  for (const [key, value] of [['appUrl','http://localhost:3317'],['appUrl','http://127.0.0.1:3000'],['supabaseUrl','https://example.supabase.co'],['supabaseUrl','http://127.0.0.1:54321'],['databaseUrl','postgresql://postgres@remote:54332/postgres']]) { const { config } = fixture(); config[key] = value; assert.throws(() => validateConfiguration(config), /loopback/) }
})
test('rejects missing owner, conflicting role IDs and hosted signing keys', () => {
  for (const change of [c => { delete c.purpose }, c => { c.projectId = 'shared' }, c => { c.repositoryRoot = '/tmp/other' }, c => { c.containers.storage = c.containers.database }, c => { c.jwtSecret = 'different-secret-with-more-than-thirty-two-chars' }]) { const { config } = fixture(); change(config); assert.throws(() => validateConfiguration(config)) }
})
test('rejects missing/stopped/unowned Docker services and public port binding', () => {
  for (const change of [cs => cs.pop(), cs => { cs[0].State.Running = false }, cs => { cs[1].Config.Labels = {} }, cs => { cs[0].NetworkSettings.Ports['8000/tcp'][0].HostIp = '0.0.0.0' }, cs => { cs[0].NetworkSettings.Ports['8000/tcp'][0].HostPort = '54321' }, cs => { cs[2].NetworkSettings.Networks = { shared: {} } }, cs => { cs[3].Config.Env = ['PGRST_DB_URI=postgresql://postgres@shared-db/postgres'] }]) { const { config, containers } = fixture(); change(containers); assert.throws(() => validateContainers(config, containers)) }
})
test('child environment overwrites every product-owned key, rejects inherited credentials', () => {
  const { config } = fixture()
  const env = applicationEnvironment(config, { ...Object.fromEntries(appOwnedEnvironment.map(key => [key, 'hosted-secret'])), SUPABASE_ACCESS_TOKEN: 'remote', DATABASE_URL: 'shared', NODE_OPTIONS: '--require evil', PATH: '/bin' })
  assert.equal(env.SUPABASE_URL, config.supabaseUrl)
  assert.equal(env.NEXT_PUBLIC_APP_URL, config.appUrl)
  assert.equal(env.GOOGLE_PRIVATE_KEY, '')
  assert.equal(env.VERCEL, '')
  assert.equal(env.DVC_E2E, '1')
  for (const key of appOwnedEnvironment) assert.notEqual(env[key], 'hosted-secret')
  for (const key of ['SUPABASE_ACCESS_TOKEN','DATABASE_URL','NODE_OPTIONS']) assert.equal(env[key], undefined)
})

test('every current source process.env key is explicitly controlled before Next dotenv loading', () => {
  function scan(path) { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? scan(join(path, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(path, entry.name)] : []) }
  const keys = new Set(scan(join(repositoryRoot, 'src')).flatMap(path => [...readFileSync(path, 'utf8').matchAll(/process\.env\.([A-Z_]+)/g)].map(match => match[1])))
  for (const key of keys) assert.ok(key === 'NODE_ENV' || appOwnedEnvironment.includes(key), `New app environment key needs QA isolation: ${key}`)
})

test('rejects a secret config inside a dot-prefixed repository directory', () => {
  const directory = mkdtempSync(join(repositoryRoot, '..qa-unit-'))
  try {
    const path = join(directory, 'environment.json')
    // Reject containment before parsing any credential-bearing file.
    writeFileSync(path, '{}')
    assert.throws(() => loadConfiguration({ DVC_E2E_ENV_FILE: path }), /outside the repository/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
