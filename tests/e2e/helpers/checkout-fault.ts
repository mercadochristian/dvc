import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { artifactDirectory, preflight } from '../../../scripts/e2e/target-guard.mjs'
import type { OwnedFixture } from './owned-fixture'

export type FaultKind = 'database' | 'storage'
type MaintenanceActor = 'postgres' | 'supabase_admin'

/** SQL only: exported for separately authorized, real-Postgres safety checks.
 * Importing/building this plan does not create any fixture or catalog object.
 */
export function checkoutFaultPlan(runId: string, checkoutId: string, kind: FaultKind, databaseActor: MaintenanceActor = 'postgres') {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  if (!uuid.test(runId) || !uuid.test(checkoutId) || !['database', 'storage'].includes(kind)) throw new Error('Invalid fault plan identity')
  const invocation = randomUUID()
  if (databaseActor !== 'postgres' && databaseActor !== 'supabase_admin') throw new Error('Invalid QA fault actor')
  const actor = kind === 'storage' ? 'supabase_admin' : databaseActor
  const name = `qa_m4_${runId.slice(0, 8)}_${invocation.replaceAll('-', '')}_${kind}`
  const marker = `dvc-qa-fault:${runId}:${invocation}`
  const table = kind === 'database' ? 'public.checkout_receipts' : 'storage.objects'
  const predicate = kind === 'database' ? `new.checkout_id='${checkoutId}'::uuid` : `new.bucket_id='dvc-private' and new.name like 'checkout-receipts/${checkoutId}/%'`
  const body = `begin if ${predicate} then raise exception 'Synthetic owned checkout ${kind} failure'; end if; return new; end`
  const catalogQuery = `select (select count(*) from pg_trigger where tgname='${name}')+(select count(*) from pg_proc where proname='${name}');`
  const createBody = `
    do $collision$ begin
      if (${catalogQuery.replace(/;$/, '')})<>0 then raise exception 'QA_FAULT_NAME_COLLISION'; end if;
    end $collision$;
    create function public.${name}() returns trigger language plpgsql set search_path=pg_catalog as $qa$${body}$qa$;
    create trigger ${name} before insert on ${table} for each row execute function public.${name}();
    comment on function public.${name}() is '${marker}';
    comment on trigger ${name} on ${table} is '${marker}';
  `
  // This proof is deliberately repeated after the function's DDL lock. A
  // same-name replacement between the first read and lock acquisition cannot
  // turn a failed CREATE into permission to delete a foreign object.
  const proof = `
    (select count(*) from pg_proc where proname='${name}')=1
    and (select count(*) from pg_trigger where tgname='${name}')=1
    and exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
      where p.oid=function_oid and n.nspname='public' and p.proname='${name}' and p.pronargs=0 and p.prokind='f'
      and p.prorettype='pg_catalog.trigger'::regtype and l.lanname='plpgsql'
      and p.proowner='${actor}'::regrole and current_user='${actor}'
      and p.prosrc=$expected$${body}$expected$ and p.proconfig=array['search_path=pg_catalog']::text[]
      and obj_description(p.oid,'pg_proc')='${marker}')
    and exists(select 1 from pg_trigger t where t.oid=trigger_oid and t.tgname='${name}'
      and t.tgrelid='${table}'::regclass and t.tgfoid=function_oid and not t.tgisinternal and t.tgtype=7
      and obj_description(t.oid,'pg_trigger')='${marker}')
  `
  const cleanupBody = `
    set local lock_timeout='5s'; set local statement_timeout='15s';
    select pg_advisory_xact_lock(hashtextextended('${marker}',0));
    lock table ${table} in access exclusive mode;
    do $cleanup$
    declare function_oid oid; trigger_oid oid;
    begin
      if (${catalogQuery.replace(/;$/, '')})=0 then return; end if;
      function_oid:=to_regprocedure('public.${name}()');
      select oid into trigger_oid from pg_trigger where tgname='${name}' and tgrelid='${table}'::regclass;
      if not coalesce((${proof}),false) then raise exception 'QA_FAULT_OWNERSHIP_MISMATCH_PRESERVED'; end if;
      -- OWNER/current_user match the fixed existing actor for this fault kind:
      -- this no-op obtains the retained function DDL lock, not a role change.
      execute 'alter function public.${name}() owner to current_user';
      if function_oid is distinct from to_regprocedure('public.${name}()')
        or not coalesce((${proof}),false) then raise exception 'QA_FAULT_OWNERSHIP_CHANGED_PRESERVED'; end if;
      execute 'drop trigger ${name} on ${table}';
      execute 'drop function public.${name}()';
    end $cleanup$;
  `
  return Object.freeze({ runId, checkoutId, kind, actor, invocation, name, marker, table, body, catalogQuery, createBody, cleanupBody, create: `begin; ${createBody} commit;`, cleanup: `begin; ${cleanupBody} commit;` })
}

/** Approved exact-owned local fault. No DDL runs outside an explicitly called
 * acceptance/developer safety check. Ownership mismatch always preserves objects.
 */
export async function withCheckoutFault<T>(owned: OwnedFixture, checkoutId: string, kind: FaultKind, run: () => Promise<T>): Promise<T> {
  const target = preflight()
  if (!/^[a-f0-9-]{36}$/.test(checkoutId) || target.organizationId !== owned.target.organizationId) throw new Error('Fault ownership mismatch')
  const checkout = await owned.rows('checkouts', { id: `eq.${checkoutId}`, organization_id: `eq.${target.organizationId}` })
  if (checkout.length !== 1 || checkout[0].status !== 'holding') throw new Error('Fault requires an exact owned holding checkout')
  function sqlAs(actor: MaintenanceActor, source: string) {
    const current = preflight()
    if (current.runId !== target.runId || current.containers.database !== target.containers.database) throw new Error('Fault target changed')
    return execFileSync('docker', ['exec', target.containers.database, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', actor, '-d', 'postgres', '-t', '-A', '-c', source], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
  const databaseOwner = sqlAs('postgres', "select pg_get_userbyid(relowner) from pg_class where oid='public.checkout_receipts'::regclass;")
  if (databaseOwner !== 'postgres' && databaseOwner !== 'supabase_admin') throw new Error('Checkout receipts has no allowlisted maintenance owner')
  const plan = checkoutFaultPlan(target.runId, checkoutId, kind, databaseOwner)
  const sql = (source: string) => sqlAs(plan.actor, source)
  const actorReady = sql(`select (current_user='${plan.actor}' and exists(select 1 from pg_roles where rolname=current_user and rolcanlogin${plan.actor === 'supabase_admin' ? ' and rolsuper' : ''}))::int;`)
  if (actorReady !== '1') throw new Error('Existing allowlisted local maintenance actor is unavailable; no fault DDL allowed')
  const storageOwnerBefore = sql("select pg_get_userbyid(relowner) from pg_class where oid='storage.objects'::regclass;")
  if (sql("select (to_regprocedure('public.dvc_checkout_receipt(uuid,uuid,text,uuid,uuid,uuid)') is not null)::int;") !== '1') throw new Error('Reviewed combined-checkout schema is missing')
  const baseline = sql(plan.catalogQuery)
  if (baseline !== '0') throw new Error('Refusing to overwrite an existing fault object')
  const directory = join(artifactDirectory(), target.runId, 'faults')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const manifest = { ...plan, organizationId: target.organizationId, existingActorVerified: true, storageOwnerBefore, catalogBefore: baseline, creationAttempted: false, installed: false, removed: false, cleanupVerdict: 'NOT RUN' }
  const file = join(directory, `${plan.name}.json`)
  const record = () => writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
  record()
  try { manifest.creationAttempted = true; record(); sql(plan.create); manifest.installed = true; record(); return await run() }
  finally {
    if (manifest.creationAttempted) {
      try {
        sql(plan.cleanup)
        if (sql(plan.catalogQuery) !== '0') throw new Error('Owned fault cleanup not proven')
        if (sql("select pg_get_userbyid(relowner) from pg_class where oid='storage.objects'::regclass;") !== storageOwnerBefore) throw new Error('Storage table ownership changed; preserve evidence')
        manifest.removed = true; manifest.cleanupVerdict = 'PASS exact provenance or already absent'; record()
      } catch {
        manifest.cleanupVerdict = 'BLOCKED: ownership/cleanup not proven; objects preserved for inspection'; record()
        throw new Error('QA fault cleanup blocked; preserve evidence and inspect recorded provenance before any further cleanup')
      }
    }
  }
}
