import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { preflight, artifactDirectory, repositoryRoot } from './scripts/e2e/target-guard.mjs'

const target = preflight()
const artifacts = artifactDirectory()
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  forbidOnly: true,
  outputDir: resolve(artifacts, target.runId, 'results'),
  reporter: [['list'], ['html', { outputFolder: resolve(artifacts, target.runId, 'report'), open: 'never' }]],
  use: { baseURL: target.appUrl, browserName: 'chromium', timezoneId: 'Asia/Manila', serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'only-on-failure' },
  webServer: { cwd: repositoryRoot, command: 'node scripts/e2e/start-app.mjs', url: target.appUrl, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 }, timeout: 120_000 },
})
