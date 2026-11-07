import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { artifactDirectory, repositoryRoot, projectId } from './target-guard.mjs'
function setup() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dvc-artifacts-unit-')))
  const secret = 'unit-only-jwt-signing-secret-with-more-than-thirty-two-characters'
  const token = role => { const data = [{ alg: 'HS256' }, { role, exp: Math.floor(Date.now() / 1000) + 3600 }].map(item => Buffer.from(JSON.stringify(item)).toString('base64url')).join('.'); return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}` }
  const runId = randomUUID()
  const config = { schemaVersion: 1, purpose: 'dvc-e2e', repositoryRoot, projectId, runId, appUrl: 'http://127.0.0.1:3317', supabaseUrl: 'http://127.0.0.1:54331', databaseUrl: 'postgresql://postgres@127.0.0.1:54332/postgres', organizationId: randomUUID(), sessionSecret: secret, jwtSecret: secret, anonKey: token('anon'), serviceRoleKey: token('service_role'), containers: Object.fromEntries(['gateway','database','auth','rest','storage'].map((role, index) => [role, String(index + 1).repeat(64)])) }
  const file = join(directory, 'qa.json')
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 })
  const artifacts = join(directory, 'artifacts')
  mkdirSync(artifacts)
  const env = { DVC_E2E_ENV_FILE: file, DVC_E2E_ARTIFACT_DIR: artifacts }
  return { directory, artifacts, env, runId, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}
test('accepts existing canonical external evidence root and UUID output subdirectories', () => {
  const f = setup()
  try { assert.equal(artifactDirectory(f.env), f.artifacts); mkdirSync(join(f.artifacts, f.runId)); assert.equal(artifactDirectory(f.env), f.artifacts) } finally { f.cleanup() }
})
test('rejects absent, relative, traversal, non-directory and missing artifact roots', () => {
  const f = setup()
  try {
    const file = join(f.directory, 'not-directory'); writeFileSync(file, '')
    for (const path of [undefined, relative(process.cwd(), f.artifacts), join(f.directory, 'missing'), `${f.artifacts}/../artifacts`, file]) assert.throws(() => artifactDirectory({ ...f.env, DVC_E2E_ARTIFACT_DIR: path }))
    assert.throws(() => artifactDirectory({ ...f.env, DVC_E2E_ENV_FILE: relative(process.cwd(), f.env.DVC_E2E_ENV_FILE) }), /absolute/)
  } finally { f.cleanup() }
})
test('rejects root symlink escape, ancestor symlink, repository and unrelated external paths', () => {
  const f = setup()
  try {
    symlinkSync(repositoryRoot, join(f.directory, 'repo-link'), 'dir')
    symlinkSync(f.artifacts, join(f.directory, 'internal-link'), 'dir')
    for (const path of [join(f.directory, 'repo-link'), join(f.directory, 'repo-link', 'nested'), join(f.directory, 'internal-link'), repositoryRoot, tmpdir()]) assert.throws(() => artifactDirectory({ ...f.env, DVC_E2E_ARTIFACT_DIR: path }))
  } finally { f.cleanup() }
})
test('rejects pre-existing UUID and writer destination symlinks before any output write', () => {
  for (const suffix of ['', 'results', 'report', 'generated-types']) {
    const f = setup()
    try {
      if (suffix) mkdirSync(join(f.artifacts, f.runId))
      symlinkSync(repositoryRoot, join(f.artifacts, f.runId, suffix), 'dir')
      assert.throws(() => artifactDirectory(f.env), /symlink/)
    } finally { f.cleanup() }
  }
})
test('rejects traversal in runId instead of permitting a writer to leave the UUID directory', () => {
  const f = setup()
  try {
    const data = JSON.parse(readFileSync(f.env.DVC_E2E_ENV_FILE, 'utf8'))
    data.runId = '../escape'
    writeFileSync(f.env.DVC_E2E_ENV_FILE, JSON.stringify(data))
    assert.throws(() => artifactDirectory(f.env), /ownership/)
  } finally { f.cleanup() }
})
