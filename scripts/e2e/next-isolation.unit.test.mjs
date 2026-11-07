import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareNextConfiguration, recordGeneratedTypes } from './next-isolation.mjs'
test('QA preparation writes fixed separate config and preserves root tsconfig bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dvc-next-unit-'))
  try {
    const original = '{"compilerOptions":{"strict":true}}\n'
    writeFileSync(join(directory, 'tsconfig.json'), original)
    prepareNextConfiguration(directory)
    assert.equal(readFileSync(join(directory, 'tsconfig.json'), 'utf8'), original)
    const generated = JSON.parse(readFileSync(join(directory, '.dvc-e2e/tsconfig.json'), 'utf8'))
    mkdirSync(join(directory, '.next-dvc-e2e'))
    writeFileSync(join(directory, '.next-dvc-e2e', 'generated-build-output'), 'temporary')
    rmSync(join(directory, '.next-dvc-e2e'), { recursive: true })
    assert.equal(JSON.parse(readFileSync(join(directory, '.dvc-e2e/tsconfig.json'), 'utf8')).extends, '../tsconfig.json')
    assert.equal(generated.extends, '../tsconfig.json')
    assert.deepEqual(generated.compilerOptions.paths, { '@/*': ['../src/*'] })
    assert.ok(generated.include.includes('../.next-dvc-e2e/dev/types/**/*.ts'))
    writeFileSync(join(directory, 'next-env.d.ts'), 'before')
    const finish = recordGeneratedTypes(directory, join(directory, 'artifacts'), 'unit')
    writeFileSync(join(directory, 'next-env.d.ts'), 'concurrent normal dev generation')
    finish()
    assert.equal(readFileSync(join(directory, 'next-env.d.ts'), 'utf8'), 'concurrent normal dev generation')
    const impact = JSON.parse(readFileSync(join(directory, 'artifacts/unit/generated-types/impact.json'), 'utf8'))
    assert.equal(impact.changed, true)
    assert.equal(impact.restored, false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('QA config preparation rejects directory and file symlinks without modifying their targets', () => {
  for (const destination of ['directory', 'file']) {
    const root = mkdtempSync(join(tmpdir(), 'dvc-next-symlink-unit-'))
    try {
      const target = join(root, 'preserve-me')
      if (destination === 'directory') {
        mkdirSync(target)
        writeFileSync(join(target, 'tsconfig.json'), 'unchanged')
        symlinkSync(target, join(root, '.dvc-e2e'), 'dir')
      } else {
        writeFileSync(target, 'unchanged')
        mkdirSync(join(root, '.dvc-e2e'))
        symlinkSync(target, join(root, '.dvc-e2e/tsconfig.json'))
      }
      assert.throws(() => prepareNextConfiguration(root))
      assert.equal(readFileSync(destination === 'directory' ? join(target, 'tsconfig.json') : target, 'utf8'), 'unchanged')
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
