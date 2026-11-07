import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { preflight, applicationEnvironment, repositoryRoot, ports, artifactDirectory } from './target-guard.mjs'
import { prepareNextConfiguration, recordGeneratedTypes } from './next-isolation.mjs'
import { superviseChild } from './child-lifecycle.mjs'
const require = createRequire(import.meta.url)
try {
  const config = preflight()
  const artifacts = artifactDirectory()
  const recordTypes = recordGeneratedTypes(repositoryRoot, artifacts, config.runId)
  prepareNextConfiguration(repositoryRoot)
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(ports.app)], { cwd: repositoryRoot, env: applicationEnvironment(config), stdio: 'inherit' })
  process.exitCode = await superviseChild(child)
  recordTypes()
} catch (error) { console.error(error.message); process.exitCode = 1 }
