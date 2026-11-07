import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { preflight, repositoryRoot, applicationEnvironment } from './target-guard.mjs'
import { superviseChild } from './child-lifecycle.mjs'
const require = createRequire(import.meta.url)
try {
  const config = preflight()
  if (process.argv.length > 2) throw new Error('QA runner accepts no CLI overrides; configure approved coverage in playwright.config.mts')
  const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--workers=1', '--retries=0'], { cwd: repositoryRoot, env: { ...applicationEnvironment(config), DVC_E2E_ENV_FILE: process.env.DVC_E2E_ENV_FILE, DVC_E2E_ARTIFACT_DIR: process.env.DVC_E2E_ARTIFACT_DIR }, stdio: 'inherit' })
  process.exitCode = await superviseChild(child, process, { SIGTERM: 'SIGINT' })
} catch (error) { console.error(error.message); process.exitCode = 1 }
