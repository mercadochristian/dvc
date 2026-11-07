import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync, realpathSync, lstatSync, statSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute, sep, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
export const projectId = `dvc-e2e-${createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 8)}`
export const ports = Object.freeze({ app: 3317, api: 54331, database: 54332 })
const fail = message => { throw new Error(`QA target rejected: ${message}`) }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function validateConfiguration(config) {
  if (config.schemaVersion !== 1 || config.purpose !== 'dvc-e2e' || config.repositoryRoot !== repositoryRoot || config.projectId !== projectId || !uuid.test(config.runId)) fail('missing or mismatched ownership markers')
  if (config.appUrl !== `http://127.0.0.1:${ports.app}` || config.supabaseUrl !== `http://127.0.0.1:${ports.api}` || config.databaseUrl !== `postgresql://postgres@127.0.0.1:${ports.database}/postgres`) fail('use the dedicated literal loopback URLs and ports')
  if (!uuid.test(config.organizationId) || typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 32 || typeof config.jwtSecret !== 'string' || config.jwtSecret.length < 32 || config.jwtSecret.includes('super-secret-jwt-token')) fail('dedicated local organization/session/JWT configuration required')
  for (const [key, role] of [['anonKey', 'anon'], ['serviceRoleKey', 'service_role']]) {
    try {
      const parts = config[key].split('.')
      const header = JSON.parse(Buffer.from(parts[0], 'base64url'))
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url'))
      const expected = createHmac('sha256', config.jwtSecret).update(`${parts[0]}.${parts[1]}`).digest()
      const supplied = Buffer.from(parts[2], 'base64url')
      if (parts.length !== 3 || header.alg !== 'HS256' || claims.role !== role || (claims.ref && claims.ref !== projectId) || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail('invalid key')
    } catch { fail(`${key} must be a valid JWT signed by the dedicated local secret`) }
  }
  for (const role of ['gateway', 'database', 'auth', 'rest', 'storage']) if (!/^[a-f0-9]{64}$/.test(config.containers?.[role] || '')) fail(`exact owned ${role} container ID required`)
  if (new Set(Object.values(config.containers)).size !== 5) fail('container roles must be distinct')
  return config
}
export function validateContainers(config, containers) {
  const byId = new Map(containers.map(container => [container.Id, container]))
  let network
  for (const [role, id] of Object.entries(config.containers)) {
    const c = byId.get(id)
    if (!c || c.Config?.Labels?.['com.supabase.cli.project'] !== projectId || !c.State?.Running || c.HostConfig?.NetworkMode === 'host') fail(`${role} has missing ownership or is stopped`)
    const networks = Object.keys(c.NetworkSettings?.Networks || {})
    if (networks.length !== 1 || (network && network !== networks[0])) fail('all services must use one dedicated network')
    network = networks[0]
    for (const bindings of Object.values(c.NetworkSettings?.Ports || {})) for (const binding of bindings || []) if (binding.HostIp !== '127.0.0.1') fail('container port exposed beyond literal loopback')
    const expectedPort = role === 'gateway' ? ports.api : role === 'database' ? ports.database : undefined
    if (expectedPort && !Object.values(c.NetworkSettings?.Ports || {}).flat().some(b => b?.HostPort === String(expectedPort) && b.HostIp === '127.0.0.1')) fail(`${role} dedicated port binding missing`)
  }
  const databaseName = byId.get(config.containers.database).Name.replace(/^\//, '')
  for (const role of ['auth', 'rest', 'storage']) {
    const env = byId.get(config.containers[role]).Config?.Env || []
    const db = env.find(item => /^(GOTRUE_DB_DATABASE_URL|PGRST_DB_URI|DATABASE_URL)=/.test(item))
    try { if (!db || new URL(db.slice(db.indexOf('=') + 1)).hostname !== databaseName) fail('database mismatch') } catch { fail(`${role} must use the exact owned database container`) }
  }
  return true
}
export function loadConfiguration(env = process.env) {
  if (!env.DVC_E2E_ENV_FILE) fail('DVC_E2E_ENV_FILE is required; .env.local is never a QA configuration')
  const path = realpathSync(env.DVC_E2E_ENV_FILE)
  if (within(repositoryRoot, path)) fail('secret QA configuration must live outside the repository')
  let config
  try { config = JSON.parse(readFileSync(path, 'utf8')) } catch { fail('QA configuration cannot be read as JSON; values withheld') }
  return validateConfiguration(config)
}
export function preflight(env = process.env) {
  const config = loadConfiguration(env)
  let containers
  try { containers = JSON.parse(execFileSync('docker', ['inspect', ...Object.values(config.containers)], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })) } catch { fail('cannot inspect the declared owned Docker containers') }
  validateContainers(config, containers)
  return config
}
export const appOwnedEnvironment = [
  'DVC_APP_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'DVC_SESSION_SECRET', 'DVC_ORGANIZATION_ID', 'VERCEL', 'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_CONTACT_MESSENGER_URL', 'NEXT_PUBLIC_CONTACT_INSTAGRAM_URL',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'CACHE_CLEAR_SECRET',
  'REGISTRATION_WEBHOOK_SECRET', 'DVC_GAME_MAIL_FROM', 'DVC_GAME_MAIL_RESEND_KEY',
  'DVC_GAME_MAIL_WORKER_SECRET', 'DVC_GAME_MAIL_TEST_URL',
]
export function applicationEnvironment(config, source = process.env) {
  const env = {}
  for (const key of ['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','USER','LANG']) if (source[key]) env[key] = source[key]
  for (const key of appOwnedEnvironment) env[key] = ''
  return { ...env, NODE_ENV: 'development', DVC_E2E: '1', NEXT_TELEMETRY_DISABLED: '1', DVC_APP_ENABLED: 'true', SUPABASE_URL: config.supabaseUrl, SUPABASE_ANON_KEY: config.anonKey, SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey, DVC_SESSION_SECRET: config.sessionSecret, DVC_ORGANIZATION_ID: config.organizationId, NEXT_PUBLIC_APP_URL: config.appUrl }
}

function within(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
function absoluteWithoutTraversal(path) {
  return typeof path === 'string' && isAbsolute(path) && !path.split(/[\\/]/).includes('..')
}
function rejectSymlinkComponents(parent, target) {
  const parts = relative(parent, target).split(sep).filter(Boolean)
  let current = parent
  for (const part of parts) {
    current = join(current, part)
    try {
      const entry = lstatSync(current)
      if (entry.isSymbolicLink()) fail('artifact path contains a symlink')
      if (!entry.isDirectory()) fail('artifact path contains a non-directory')
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
  }
}
export function artifactDirectory(env = process.env) {
  if (!absoluteWithoutTraversal(env.DVC_E2E_ENV_FILE) || !absoluteWithoutTraversal(env.DVC_E2E_ARTIFACT_DIR)) fail('absolute QA config and artifact paths without traversal are required')
  const config = loadConfiguration(env)
  const approved = dirname(realpathSync(env.DVC_E2E_ENV_FILE))
  const requested = resolve(env.DVC_E2E_ARTIFACT_DIR)
  if (!within(approved, requested)) fail('artifacts must be contained within the external QA config parent')
  rejectSymlinkComponents(approved, requested)
  let actual = requested
  try {
    actual = realpathSync(requested)
    if (!statSync(actual).isDirectory()) fail('artifact root must be a directory')
  } catch { fail('artifact root must be an existing directory') }
  if (!within(approved, actual) || within(repositoryRoot, actual)) fail('artifact root escapes the approved external QA directory')
  // Check each writer destination as well: a pre-existing UUID or report symlink
  // must not redirect Playwright or generated-type evidence into the checkout.
  for (const suffix of ['', 'results', 'report', 'generated-types']) {
    rejectSymlinkComponents(actual, join(actual, config.runId, suffix))
  }
  return actual
}
