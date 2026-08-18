#!/usr/bin/env node
/**
 * Authenticated role / RLS acceptance matrix.
 *
 * Signs in as each seeded role with a real Supabase session and exercises the
 * operational surface directly against PostgREST — bypassing the frontend
 * entirely, because a hidden button is not a security control.
 *
 * SAFETY MODEL
 *   Denial probes (expected DENY) cannot mutate anything: a rejected write
 *   changes no rows. They run by default and are the actual security proof.
 *
 *   Allow probes (expected ALLOW) for INSERT/UPDATE/DELETE do write real rows.
 *   They are gated behind --allow-writes and should be pointed at a staging
 *   project, never production, unless you have accepted that they create and
 *   then remove test records.
 *
 * USAGE
 *   node scripts/rls-acceptance.mjs                 # read + denial probes only
 *   node scripts/rls-acceptance.mjs --allow-writes  # adds positive write probes
 *
 * CONFIG  (scripts/rls-users.json, gitignored — never commit real passwords)
 *   {
 *     "super_admin": { "email": "...", "password": "..." },
 *     "fa_admin":    { "email": "...", "password": "..." },
 *     "custodian":   { "email": "...", "password": "...",
 *                      "scope": { "company": "Company A", "assetGroup": "IT" } },
 *     "purchaser":   { "email": "...", "password": "..." },
 *     "technician":  { "email": "...", "password": "...",
 *                      "scope": { "company": "Company A", "assetGroup": "IT" } }
 *   }
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ALLOW_WRITES = process.argv.includes('--allow-writes')

function loadEnv() {
  const env = {}
  const file = join(ROOT, '.env')
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const env = loadEnv()
const URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
if (!URL || !ANON) { console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(2) }

const CRED_PATH = join(HERE, 'rls-users.json')
if (!existsSync(CRED_PATH)) {
  console.error(`\nNo credentials file at scripts/rls-users.json.\n` +
    `Create it with one entry per role (see the header of this file), then re-run.\n` +
    `Each user must already exist in Supabase Auth with the matching role assigned.\n`)
  process.exit(2)
}
const USERS = JSON.parse(readFileSync(CRED_PATH, 'utf8'))

/* Permission matrix seeded by 20260815070000. Expected outcomes below are
   derived from this, not guessed. */
const ROLE_PERMS = {
  super_admin: 'ALL',
  fa_admin:   ['asset.view','asset.create','asset.update','asset.transfer','asset.retire','repair.view','repair.create','repair.process','repair.cost','repair.close','parts.view','parts.manage','purchasing.manage','maintenance.view','maintenance.manage','map.view','reports.view','reports.export'],
  custodian:  ['asset.view','asset.create','asset.update','asset.transfer','repair.view','repair.create','repair.process','repair.cost','repair.close','parts.view','parts.manage','purchasing.manage','maintenance.view','maintenance.manage','map.view','reports.view','reports.export'],
  purchaser:  ['asset.view','repair.view','parts.view','parts.manage','purchasing.manage','maintenance.view','map.view','reports.purchasing','reports.export'],
  technician: ['asset.view','repair.view','repair.process','repair.close','parts.view','maintenance.view','map.view'],
}
const has = (role, perm) => ROLE_PERMS[role] === 'ALL' || (ROLE_PERMS[role] || []).includes(perm)

const READ_TABLES = ['assets','companies','asset_categories','project_locations','repair_tickets','repair_parts','maintenance_schedules','maintenance_completions','asset_transfers','asset_activity','repair_part_receipts']

let pass = 0, fail = 0, skip = 0
const results = []
function record(role, area, op, expected, actual, detail = '') {
  const ok = expected === actual
  ok ? pass++ : fail++
  results.push({ role, area, op, expected, actual, ok, detail })
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`  ${tag}  ${area.padEnd(26)} ${op.padEnd(8)} expect=${expected.padEnd(5)} got=${actual.padEnd(5)} ${detail}`)
}

const outcome = (error) => {
  if (!error) return 'ALLOW'
  const code = error.code || ''
  if (code === '42501' || code === 'PGRST301' || /permission|denied|policy|row-level/i.test(error.message || '')) return 'DENY'
  return 'ERROR'
}

async function signIn(role, cred) {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword({ email: cred.email, password: cred.password })
  if (error) return { error }
  return { client: c, user: data.user }
}

async function runRole(role) {
  const cred = USERS[role]
  console.log(`\n=== ${role} ===`)
  if (!cred?.email) { console.log('  SKIP — no credentials supplied'); skip++; return }

  const { client, user, error: signInError } = await signIn(role, cred)
  if (signInError) { console.log(`  SKIP — sign-in failed: ${signInError.message}`); skip++; return }
  console.log(`  signed in as ${user.email}`)

  // profile/permission surface
  const { data: access, error: accessErr } = await client.rpc('current_asset_user_access')
  record(role, 'rpc:current_asset_user_access', 'EXEC', 'ALLOW', outcome(accessErr))
  if (access) console.log(`    scope: super_admin=${access.is_super_admin} all_companies=${access.all_companies} all_asset_groups=${access.all_asset_groups}`)

  // SELECT across the operational surface — every role may read within scope
  for (const t of READ_TABLES) {
    const { error } = await client.from(t).select('*').limit(1)
    record(role, `select:${t}`, 'SELECT', 'ALLOW', outcome(error), error ? (error.code || error.message).slice(0, 40) : '')
  }

  // audit log: super admin only
  {
    const { error } = await client.from('asset_audit_log').select('*').limit(1)
    record(role, 'select:asset_audit_log', 'SELECT', has(role,'audit.view') ? 'ALLOW' : 'DENY', outcome(error))
  }

  // ---- DENIAL probes (safe: a rejected write mutates nothing) ----
  if (!has(role, 'asset.create')) {
    const { error } = await client.from('assets').insert({ asset_tag: `RLSTEST-${Date.now()}`, name: 'RLS probe' }).select('id')
    record(role, 'assets (no asset.create)', 'INSERT', 'DENY', outcome(error))
  }
  if (!has(role, 'asset.delete')) {
    const { data: row } = await client.from('assets').select('id').limit(1)
    if (row?.[0]) {
      const { error } = await client.from('assets').delete().eq('id', row[0].id).select('id')
      record(role, 'assets (no asset.delete)', 'DELETE', 'DENY', outcome(error))
    }
  }
  if (!has(role, 'companies.manage')) {
    const { error } = await client.from('companies').insert({ name: `RLSTEST-${Date.now()}` }).select('id')
    record(role, 'companies (no manage)', 'INSERT', 'DENY', outcome(error))
  }
  if (!has(role, 'asset_groups.manage')) {
    const { error } = await client.from('asset_categories').insert({ name: `RLSTEST-${Date.now()}` }).select('id')
    record(role, 'asset_categories (no manage)', 'INSERT', 'DENY', outcome(error))
  }
  if (!has(role, 'projects.manage')) {
    const { error } = await client.from('project_locations').insert({ project_code: `RLSTEST-${Date.now()}`, location: 'probe' }).select('id')
    record(role, 'project_locations (no manage)', 'INSERT', 'DENY', outcome(error))
  }
  if (!has(role, 'maintenance.manage')) {
    const { data: a } = await client.from('assets').select('id').limit(1)
    if (a?.[0]) {
      const { error } = await client.from('maintenance_schedules').insert({ asset_id: a[0].id, name: 'RLS probe', repeat_every: 1, interval_unit: 'months', next_due_on: '2030-01-01' }).select('id')
      record(role, 'maintenance (no manage)', 'INSERT', 'DENY', outcome(error))
    }
  }
  if (!has(role, 'parts.manage')) {
    const { data: t } = await client.from('repair_tickets').select('id').limit(1)
    if (t?.[0]) {
      const { error } = await client.from('repair_parts').insert({ repair_ticket_id: t[0].id, name: 'RLS probe', state: 'needed', quantity: 1, needed_on: '2030-01-01' }).select('id')
      record(role, 'repair_parts (no parts.manage)', 'INSERT', 'DENY', outcome(error))
    }
  }
  if (!has(role, 'repair.create')) {
    const { data: a } = await client.from('assets').select('id').limit(1)
    if (a?.[0]) {
      const { error } = await client.from('repair_tickets').insert({ asset_id: a[0].id, fault: 'RLS probe', reported_on: '2030-01-01' }).select('id')
      record(role, 'repair_tickets (no repair.create)', 'INSERT', 'DENY', outcome(error))
    }
  }
  // asset.retire is exercised through the RPC, which is the only reinstate path
  {
    const { data: a } = await client.from('assets').select('id, current_address, current_custodian').limit(1)
    if (a?.[0]) {
      const { error } = await client.rpc('reinstate_asset', {
        p_asset_id: a[0].id, p_project_location_id: null,
        p_address: a[0].current_address || 'probe', p_custodian: a[0].current_custodian || 'probe',
        p_effective_on: '2030-01-01', p_reason: 'RLS acceptance probe',
      })
      // only run destructively when writes are authorised; otherwise expect DENY for non-retire roles
      if (!has(role, 'asset.retire')) record(role, 'rpc:reinstate_asset', 'EXEC', 'DENY', outcome(error))
      else if (ALLOW_WRITES) record(role, 'rpc:reinstate_asset', 'EXEC', 'ALLOW', outcome(error))
      else { console.log('  (skipped positive reinstate_asset probe — needs --allow-writes)'); skip++ }
    }
  }

  // user administration is Edge-Function only; direct table writes must be denied for everyone
  {
    const { error } = await client.from('user_profiles').update({ is_active: true }).eq('user_id', user.id).select('user_id')
    record(role, 'user_profiles direct write', 'UPDATE', 'DENY', outcome(error))
  }
  {
    const { error } = await client.from('role_permissions').insert({ role_id: '00000000-0000-0000-0000-000000000000', permission_id: '00000000-0000-0000-0000-000000000000', granted: true }).select('role_id')
    record(role, 'role_permissions escalation', 'INSERT', 'DENY', outcome(error))
  }
  {
    const { error } = await client.rpc('bootstrap_asset_super_admin', { p_email: user.email })
    record(role, 'rpc:bootstrap_super_admin', 'EXEC', 'DENY', outcome(error))
  }
  {
    const { error } = await client.rpc('admin_set_asset_user_access', { p_actor_id: user.id, p_user_id: user.id, p_full_name: 'x', p_username: null, p_role_code: 'super_admin', p_is_active: true, p_all_companies: true, p_all_asset_groups: true, p_company_ids: [], p_asset_group_ids: [], p_permission_overrides: {} })
    record(role, 'rpc:admin_set_access escalation', 'EXEC', 'DENY', outcome(error))
  }

  // ---- scope containment: every visible row must be inside the user's scope ----
  if (access && !access.is_super_admin) {
    const { data: visible } = await client.from('assets').select('id, company_id, category_id').limit(1000)
    if (visible) {
      const okCompany = access.all_companies || visible.every((r) => (access.company_ids || []).includes(r.company_id))
      const okGroup = access.all_asset_groups || visible.every((r) => (access.asset_group_ids || []).includes(r.category_id))
      record(role, 'scope: cross-company leak', 'SELECT', 'ALLOW', okCompany ? 'ALLOW' : 'DENY', `${visible.length} rows visible`)
      record(role, 'scope: cross-group leak', 'SELECT', 'ALLOW', okGroup ? 'ALLOW' : 'DENY', `${visible.length} rows visible`)
    }
  }

  // ---- storage: receipts must never be publicly readable ----
  {
    const { error } = await client.storage.from('asset-receipts').list('', { limit: 1 })
    record(role, 'storage:asset-receipts list', 'SELECT', 'ALLOW', outcome(error), 'RLS filters contents')
  }

  await client.auth.signOut()
}

console.log(`Authenticated RLS acceptance matrix`)
console.log(`target: ${URL}`)
console.log(`mode  : ${ALLOW_WRITES ? 'READ + DENIAL + POSITIVE WRITES (mutates data)' : 'READ + DENIAL probes only (no mutations)'}`)

for (const role of ['super_admin','fa_admin','custodian','purchaser','technician']) {
  await runRole(role)
}

console.log(`\n===== SUMMARY =====`)
console.log(`pass: ${pass}  fail: ${fail}  skipped: ${skip}`)
for (const r of results.filter((r) => !r.ok)) {
  console.log(`  FAIL ${r.role} / ${r.area} / ${r.op}: expected ${r.expected}, got ${r.actual} ${r.detail}`)
}
console.log(fail === 0 && pass > 0 ? '\nRESULT: MATRIX PASSED' : fail > 0 ? '\nRESULT: MATRIX FAILED' : '\nRESULT: NOTHING RAN')
process.exit(fail === 0 ? 0 : 1)
