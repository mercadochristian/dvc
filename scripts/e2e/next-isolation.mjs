import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, openSync, closeSync, constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export function prepareNextConfiguration(root) {
  const directory = join(root, '.dvc-e2e')
  try { mkdirSync(directory, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('QA configuration directory must be a real directory')
  const file = join(directory, 'tsconfig.json')
  if (existsSync(file) && !lstatSync(file).isFile()) throw new Error('QA tsconfig must be a regular file')
  const descriptor = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(descriptor, JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: {
      incremental: true,
      tsBuildInfoFile: './qa.tsbuildinfo',
      paths: { '@/*': ['../src/*'] },
    },
    include: ['../next-env.d.ts', '../src/**/*.ts', '../src/**/*.tsx', '../src/**/*.mts', '../.next-dvc-e2e/types/**/*.ts', '../.next-dvc-e2e/dev/types/**/*.ts'],
    exclude: ['../node_modules'],
  }, null, 2) + '\n') } finally { closeSync(descriptor) }
}
export function recordGeneratedTypes(root, artifactDirectory, runId) {
  const directory = resolve(artifactDirectory, runId, 'generated-types')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(root, 'next-env.d.ts')
  const before = existsSync(file) ? readFileSync(file) : null
  if (before) writeFileSync(join(directory, 'next-env.before.txt'), before, { mode: 0o600 })
  const hash = bytes => bytes ? createHash('sha256').update(bytes).digest('hex') : null
  return () => {
    const after = existsSync(file) ? readFileSync(file) : null
    if (after) writeFileSync(join(directory, 'next-env.after.txt'), after, { mode: 0o600 })
    writeFileSync(join(directory, 'impact.json'), JSON.stringify({ before: hash(before), after: hash(after), changed: hash(before) !== hash(after), restored: false, reason: 'Ignored Next-generated file is shared with normal dev; preserve potential concurrent writes. Inspect snapshots before any manual restoration.' }, null, 2) + '\n', { mode: 0o600 })
  }
}
