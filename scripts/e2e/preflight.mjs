import { preflight } from './target-guard.mjs'
try { const config = preflight(); console.log(`Verified dedicated QA ownership: ${config.projectId}, run ${config.runId}`) }
catch (error) { console.error(error.message); process.exitCode = 1 }
