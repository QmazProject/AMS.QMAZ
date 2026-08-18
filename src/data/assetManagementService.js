import { supabase } from '../lib/supabase.js'

const RECEIPT_BUCKET = 'asset-receipts'
const NO_PROJECT = 'X'

const COLUMNS = {
  companies: 'id,name,short_code,contact_person,address,notes',
  categories: 'id,name,notes',
  projects: 'id,project_code,address,latitude,longitude,notes',
  assets: 'id,asset_number,asset_code,company_id,category_id,project_location_id,name,serial_number,engine_number,plate_number,mv_file_number,conduction_sticker,body_number,status,current_address,current_custodian,acquired_on,acquisition_cost,notes,retired_on,retirement_reason,retirement_details,revision',
  transfers: 'id,asset_id,from_project_location_id,to_project_location_id,from_address,to_address,from_custodian,to_custodian,effective_on,reason,reference,created_at',
  repairs: 'id,ticket_number,asset_id,stage,outcome,fault,reported_by_name,service_provider,hold_address,reported_on,target_completion_on,technician_name,started_on,work_done,repair_completed_on,test_result,labor_cost,other_cost,return_address,returned_to_name,closed_on,closure_reason',
  parts: 'id,repair_ticket_id,name,state,quantity,estimated_amount,unit_price,supplier,needed_on,ordered_on,purchased_on,order_reference,created_at',
  receipts: 'id,repair_part_id,storage_bucket,storage_object_path,original_filename,mime_type,size_bytes,receipt_number,receipt_date,removed_at,created_at',
  schedules: 'id,asset_id,name,repeat_every,interval_unit,next_due_on,last_completed_on,service_provider,estimated_cost,notes',
  completions: 'id,maintenance_schedule_id,completed_on,cost,service_provider,reference,notes,next_due_on,created_at',
  activity: 'id,asset_id,repair_ticket_id,transfer_id,event_type,event_date,title,details,metadata,created_at',
}

function db() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function resultData(result, context) {
  if (result.error) {
    const error = new Error(`${context}: ${result.error.message}`)
    error.cause = result.error
    throw error
  }
  return result.data
}

const optional = (value) => String(value ?? '').trim() || null
const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
const epoch = (value) => Number.isFinite(new Date(value || 0).getTime()) ? new Date(value || 0).getTime() : 0
const stateToDb = (value) => String(value || 'Needed').toLowerCase()
const stateToUi = (value) => value ? value[0].toUpperCase() + value.slice(1) : 'Needed'

function activityKind(row) {
  if (row.event_type === 'asset_registered') return 'register'
  if (row.event_type === 'asset_transferred') return 'transfer'
  if (row.event_type === 'fault_reported' || row.event_type === 'asset_sent_for_repair') return 'fault'
  if (row.event_type.includes('part') || row.event_type.includes('receipt')) return 'parts'
  if (row.event_type.includes('maintenance')) return 'maintenance'
  if (row.event_type === 'asset_retired') return 'retire'
  if (row.event_type.includes('returned_to_service') || row.event_type === 'asset_reinstated') return 'restore'
  if (row.event_type === 'repair_stage_changed') {
    const stage = row.metadata?.to_stage
    return stage === 'testing' ? 'testing' : stage === 'parts' ? 'parts' : stage === 'closed' ? 'restore' : 'repair'
  }
  return 'edit'
}

const mapActivity = (row) => ({
  id: row.id, ts: epoch(row.created_at), date: row.event_date, kind: activityKind(row), text: row.title,
  sub: row.details || '', ticket: row.metadata?.ticket_number, metadata: row.metadata || {},
})

function mapTransfer(row, projectById) {
  const registration = !row.from_address && !row.from_custodian && !row.from_project_location_id
  const fromProject = projectById.get(row.from_project_location_id)?.project_code || NO_PROJECT
  const toProject = projectById.get(row.to_project_location_id)?.project_code || NO_PROJECT
  const pieces = []
  if (!registration && row.from_address !== row.to_address) pieces.push(`${row.from_address || '—'} → ${row.to_address}`)
  if (!registration && row.from_custodian !== row.to_custodian) pieces.push(`${row.from_custodian || '—'} → ${row.to_custodian}`)
  if (!registration && fromProject !== toProject) pieces.push(`${fromProject} → ${toProject}`)
  return {
    id: row.id, ts: epoch(row.created_at), date: row.effective_on, kind: registration ? 'register' : 'transfer',
    text: registration ? `Registered at ${row.to_address}, under ${row.to_custodian}` : pieces.join(' · ') || 'Transfer recorded',
    sub: [row.reason, row.reference, `Project/Location ${toProject}`].filter(Boolean).join(' · '),
    move: { fromLoc: row.from_address, toLoc: row.to_address, fromPer: row.from_custodian, toPer: row.to_custodian, fromProject, project: toProject, why: row.reason || row.reference || 'Transfer' },
  }
}

export async function loadOperationalData() {
  const client = db()
  const requests = [
    client.from('companies').select(COLUMNS.companies).order('name'),
    client.from('asset_categories').select(COLUMNS.categories).order('name'),
    client.from('project_locations').select(COLUMNS.projects).order('project_code'),
    client.from('assets').select(COLUMNS.assets).order('asset_number'),
    client.from('asset_transfers').select(COLUMNS.transfers).order('effective_on').order('created_at'),
    client.from('repair_tickets').select(COLUMNS.repairs).order('reported_on', { ascending: false }),
    client.from('repair_parts').select(COLUMNS.parts).order('created_at'),
    client.from('repair_part_receipts').select(COLUMNS.receipts).is('removed_at', null).order('created_at'),
    client.from('maintenance_schedules').select(COLUMNS.schedules).order('next_due_on'),
    client.from('maintenance_completions').select(COLUMNS.completions).order('completed_on'),
    client.from('asset_activity').select(COLUMNS.activity).order('event_date').order('created_at'),
  ]
  const results = await Promise.all(requests)
  const labels = ['companies', 'asset groups', 'projects/locations', 'assets', 'transfers', 'repairs', 'parts', 'receipts', 'maintenance schedules', 'maintenance history', 'activity history']
  results.forEach((result, index) => resultData(result, `Could not load ${labels[index]}`))
  const [companyRows, categoryRows, projectRows, assetRows, transferRows, repairRows, partRows, receiptRows, scheduleRows, completionRows, activityRows] = results.map((result) => result.data || [])
  const companies = companyRows.map((row) => ({ id: row.id, name: row.name, code: row.short_code || '', contact: row.contact_person || '', address: row.address || '', notes: row.notes || '' }))
  const categories = categoryRows.map((row) => ({ id: row.id, name: row.name, notes: row.notes || '' }))
  const projects = projectRows.map((row) => ({ id: row.id, pid: row.project_code, location: row.address, geocode: row.latitude === null || row.longitude === null ? '' : `${row.latitude}, ${row.longitude}`, notes: row.notes || '' }))
  const companyById = new Map(companyRows.map((row) => [row.id, row]))
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]))
  const projectById = new Map(projectRows.map((row) => [row.id, row]))
  const activityByAsset = new Map()
  const activityByRepair = new Map()
  activityRows.forEach((row) => {
    const mapped = mapActivity(row)
    if (!row.transfer_id && row.event_type !== 'asset_registered') activityByAsset.set(row.asset_id, [...(activityByAsset.get(row.asset_id) || []), mapped])
    if (row.repair_ticket_id) activityByRepair.set(row.repair_ticket_id, [...(activityByRepair.get(row.repair_ticket_id) || []), mapped])
  })
  transferRows.forEach((row) => activityByAsset.set(row.asset_id, [...(activityByAsset.get(row.asset_id) || []), mapTransfer(row, projectById)]))
  const receiptsByPart = new Map(receiptRows.map((row) => [row.repair_part_id, {
    id: row.id, name: row.original_filename, type: row.mime_type, size: Number(row.size_bytes),
    at: row.receipt_date || String(row.created_at).slice(0, 10), path: row.storage_object_path, bucket: row.storage_bucket,
  }]))
  const partsByRepair = new Map()
  partRows.forEach((row) => {
    const part = { id: row.id, name: row.name, state: stateToUi(row.state), qty: row.quantity, unit: row.unit_price ?? row.estimated_amount ?? '', estimated: row.estimated_amount ?? '', supplier: row.supplier || '', date: row.purchased_on || row.ordered_on || row.needed_on, ref: row.order_reference || '', receipt: receiptsByPart.get(row.id) || null }
    partsByRepair.set(row.repair_ticket_id, [...(partsByRepair.get(row.repair_ticket_id) || []), part])
  })
  const completionBySchedule = new Map()
  completionRows.forEach((row) => {
    const completion = { id: row.id, date: row.completed_on, cost: row.cost, provider: row.service_provider || '', ref: row.reference || '', notes: row.notes || '' }
    completionBySchedule.set(row.maintenance_schedule_id, [...(completionBySchedule.get(row.maintenance_schedule_id) || []), completion])
  })
  const assets = assetRows.map((row) => ({
    id: row.id, tag: row.asset_number, code: row.asset_code || '', companyId: row.company_id, company: companyById.get(row.company_id)?.name || '', categoryId: row.category_id,
    category: categoryById.get(row.category_id)?.name || '', projectId: row.project_location_id, project: projectById.get(row.project_location_id)?.project_code || NO_PROJECT,
    name: row.name, serial: row.serial_number || '', engine: row.engine_number || '', plate: row.plate_number || '', mvFile: row.mv_file_number || '', conduction: row.conduction_sticker || '', body: row.body_number || '',
    status: row.status, location: row.current_address, custodian: row.current_custodian, acquired: row.acquired_on || '', cost: row.acquisition_cost ?? '', notes: row.notes || '',
    retiredOn: row.retired_on, retirementReason: row.retirement_reason, retirementDetails: row.retirement_details, revision: row.revision,
    history: [...(activityByAsset.get(row.id) || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.ts - b.ts),
  }))
  const repairs = repairRows.map((row) => ({
    id: row.id, assetId: row.asset_id, ticket: row.ticket_number, stage: row.stage, outcome: row.outcome, fault: row.fault, reportedBy: row.reported_by_name || '', provider: row.service_provider || '', holdAddress: row.hold_address || '', date: row.reported_on, due: row.target_completion_on || '',
    technician: row.technician_name || '', startedOn: row.started_on || '', work: row.work_done || '', repairCompletedOn: row.repair_completed_on || '', testResult: row.test_result || '', labor: row.labor_cost, other: row.other_cost,
    returnAddress: row.return_address || '', returnedTo: row.returned_to_name || '', closed: row.stage === 'closed', closedOn: row.closed_on || '', closureReason: row.closure_reason || '', parts: partsByRepair.get(row.id) || [], log: activityByRepair.get(row.id) || [],
  }))
  const plans = scheduleRows.map((row) => ({ id: row.id, assetId: row.asset_id, name: row.name, every: row.repeat_every, unit: row.interval_unit, nextDue: row.next_due_on, lastDone: row.last_completed_on || '', provider: row.service_provider || '', estCost: row.estimated_cost ?? '', notes: row.notes || '', done: completionBySchedule.get(row.id) || [] }))
  return { assets, repairs, plans, companies, categories, projects }
}

const assetPayload = (value) => ({
  asset_number: value.tag.trim(), asset_code: optional(value.code), company_id: value.companyId || null, category_id: value.categoryId || null, project_location_id: value.projectId || null,
  name: value.name.trim(), serial_number: optional(value.serial), engine_number: optional(value.engine), plate_number: optional(value.plate), mv_file_number: optional(value.mvFile), conduction_sticker: optional(value.conduction), body_number: optional(value.body),
  current_address: value.location.trim(), current_custodian: value.custodian.trim(), acquired_on: optional(value.acquired), acquisition_cost: numberOrNull(value.cost), notes: optional(value.notes),
})

export const createAsset = async (value) => resultData(await db().from('assets').insert(assetPayload(value)).select('id').single(), 'Could not register asset')
export const updateAsset = async (id, value) => resultData(await db().from('assets').update(assetPayload(value)).eq('id', id).select('id').single(), 'Could not update asset')
export const retireAsset = async (id, value) => resultData(await db().from('assets').update({ status: 'retired', retired_on: value.date, retirement_reason: value.reason.trim(), retirement_details: optional(value.detail) }).eq('id', id).select('id').single(), 'Could not retire asset')
export const deleteAsset = async (id) => resultData(await db().from('assets').delete().eq('id', id).select('id').single(), 'Could not delete asset')

export async function reinstateAsset(id, value) {
  return resultData(await db().rpc('reinstate_asset', { p_asset_id: id, p_project_location_id: value.projectId || null, p_address: value.location.trim(), p_custodian: value.custodian.trim(), p_effective_on: value.date, p_reason: optional(value.reason) }), 'Could not reinstate asset')
}

export async function transferAsset(asset, value) {
  return resultData(await db().from('asset_transfers').insert({ asset_id: asset.id, from_project_location_id: asset.projectId || null, to_project_location_id: value.projectId || null, from_address: asset.location, to_address: value.location.trim(), from_custodian: asset.custodian, to_custodian: value.custodian.trim(), effective_on: value.date, reason: optional(value.reason) }).select('id').single(), 'Could not transfer asset')
}

export const createRepair = async (assetId, value) => resultData(await db().from('repair_tickets').insert({ asset_id: assetId, ...(optional(value.ticket) ? { ticket_number: optional(value.ticket) } : {}), fault: value.fault.trim(), reported_by_name: optional(value.reportedBy), service_provider: optional(value.provider), hold_address: optional(value.location), reported_on: value.date, target_completion_on: optional(value.due) }).select('id,ticket_number').single(), 'Could not open repair ticket')
export const updateRepair = async (id, patch) => resultData(await db().from('repair_tickets').update(patch).eq('id', id).select('id').single(), 'Could not update repair ticket')

export async function createRepairPart(repairTicketId, value) {
  const state = stateToDb(value.state)
  const date = value.date || new Date().toISOString().slice(0, 10)
  return resultData(await db().from('repair_parts').insert({ repair_ticket_id: repairTicketId, name: value.name.trim(), state, quantity: numberOrNull(value.qty) || 1, estimated_amount: numberOrNull(value.estimated ?? value.amount), unit_price: numberOrNull(value.unit), supplier: optional(value.supplier), needed_on: date, ordered_on: state === 'ordered' ? date : null, purchased_on: state === 'purchased' ? date : null, order_reference: optional(value.ref) }).select('id').single(), 'Could not add repair part')
}

export async function updateRepairPart(id, value) {
  const state = stateToDb(value.state)
  const date = value.date || new Date().toISOString().slice(0, 10)
  const patch = { state, quantity: numberOrNull(value.qty) || 1, unit_price: numberOrNull(value.unit), supplier: optional(value.supplier), order_reference: optional(value.ref) }
  if (state === 'ordered') patch.ordered_on = date
  if (state === 'purchased') patch.purchased_on = date
  return resultData(await db().from('repair_parts').update(patch).eq('id', id).select('id').single(), 'Could not update repair part')
}
export const deleteRepairPart = async (id) => resultData(await db().from('repair_parts').delete().eq('id', id).select('id').single(), 'Could not remove repair part')

export const createMaintenanceSchedule = async (assetId, value) => resultData(await db().from('maintenance_schedules').insert({ asset_id: assetId, name: value.name.trim(), repeat_every: Number.parseInt(value.every, 10) || 1, interval_unit: value.unit, next_due_on: value.nextDue, service_provider: optional(value.provider), estimated_cost: numberOrNull(value.estCost), notes: optional(value.notes) }).select('id').single(), 'Could not create maintenance schedule')
export const updateMaintenanceSchedule = async (id, value) => resultData(await db().from('maintenance_schedules').update({ name: value.name.trim(), repeat_every: Number.parseInt(value.every, 10) || 1, interval_unit: value.unit, next_due_on: value.nextDue, service_provider: optional(value.provider), estimated_cost: numberOrNull(value.estCost), notes: optional(value.notes) }).eq('id', id).select('id').single(), 'Could not update maintenance schedule')
export const completeMaintenance = async (id, value) => resultData(await db().from('maintenance_completions').insert({ maintenance_schedule_id: id, completed_on: value.date, cost: numberOrNull(value.cost) || 0, service_provider: optional(value.provider), reference: optional(value.ref), notes: optional(value.notes), next_due_on: value.nextDue }).select('id').single(), 'Could not record maintenance completion')
export const deleteMaintenanceSchedule = async (id) => resultData(await db().from('maintenance_schedules').delete().eq('id', id).select('id').single(), 'Could not delete maintenance schedule')

const companyPayload = (value) => ({ name: value.name.trim(), short_code: optional(value.code), contact_person: optional(value.contact), address: optional(value.address), notes: optional(value.notes) })
const categoryPayload = (value) => ({ name: value.name.trim(), notes: optional(value.notes) })
const projectPayload = (value) => {
  const match = String(value.geocode || '').match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/)
  return { project_code: value.pid.trim(), address: value.location.trim(), latitude: match ? Number(match[1]) : null, longitude: match ? Number(match[2]) : null, notes: optional(value.notes) }
}
export const createCompany = async (value) => resultData(await db().from('companies').insert(companyPayload(value)).select('id').single(), 'Could not create company')
export const updateCompany = async (id, value) => resultData(await db().from('companies').update(companyPayload(value)).eq('id', id).select('id').single(), 'Could not update company')
export const deleteCompany = async (id) => resultData(await db().from('companies').delete().eq('id', id).select('id').single(), 'Could not delete company')
export const createCategory = async (value) => resultData(await db().from('asset_categories').insert(categoryPayload(value)).select('id').single(), 'Could not create asset group')
export const updateCategory = async (id, value) => resultData(await db().from('asset_categories').update(categoryPayload(value)).eq('id', id).select('id').single(), 'Could not update asset group')
export const deleteCategory = async (id) => resultData(await db().from('asset_categories').delete().eq('id', id).select('id').single(), 'Could not delete asset group')
export const createProject = async (value) => resultData(await db().from('project_locations').insert(projectPayload(value)).select('id').single(), 'Could not create project/location')
export const updateProject = async (id, value) => resultData(await db().from('project_locations').update(projectPayload(value)).eq('id', id).select('id').single(), 'Could not update project/location')
export const deleteProject = async (id) => resultData(await db().from('project_locations').delete().eq('id', id).select('id').single(), 'Could not delete project/location')

export async function upsertProjects(rows, existingProjects) {
  let added = 0
  let updated = 0
  for (const row of rows) {
    const existing = existingProjects.find((project) => project.pid.trim().toLowerCase() === row.pid.trim().toLowerCase())
    if (existing) { await updateProject(existing.id, row); updated += 1 } else { await createProject(row); added += 1 }
  }
  return { added, updated }
}

const safeFilename = (name) => String(name || 'receipt').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-120) || 'receipt'

export async function saveReceipt(partId, file, fields, previousReceipt = null) {
  const client = db()
  const user = resultData(await client.auth.getUser(), 'Could not verify receipt uploader').user
  if (!user) throw new Error('You must be signed in to upload a receipt.')
  const path = `${user.id}/${partId}/${crypto.randomUUID()}-${safeFilename(file.name)}`
  resultData(await client.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type, upsert: false }), 'Could not upload receipt file')
  if (previousReceipt) {
    const removed = await client.from('repair_part_receipts').update({ removed_at: new Date().toISOString() }).eq('id', previousReceipt.id).is('removed_at', null).select('id').single()
    if (removed.error) { await client.storage.from(RECEIPT_BUCKET).remove([path]); resultData(removed, 'Could not replace receipt metadata') }
  }
  const metadata = await client.from('repair_part_receipts').insert({ repair_part_id: partId, storage_object_path: path, original_filename: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, receipt_number: optional(fields.ref), receipt_date: optional(fields.date), replaced_receipt_id: previousReceipt?.id || null }).select('id').single()
  if (metadata.error) {
    if (previousReceipt) await client.from('repair_part_receipts').update({ removed_at: null }).eq('id', previousReceipt.id)
    await client.storage.from(RECEIPT_BUCKET).remove([path])
    resultData(metadata, 'Could not save receipt metadata')
  }
  if (previousReceipt?.path) await client.storage.from(RECEIPT_BUCKET).remove([previousReceipt.path])
  return metadata.data
}

export const updateReceiptMetadata = async (id, fields) => resultData(await db().from('repair_part_receipts').update({ receipt_number: optional(fields.ref), receipt_date: optional(fields.date) }).eq('id', id).select('id').single(), 'Could not update receipt metadata')

export async function removeReceipt(receipt) {
  const client = db()
  resultData(await client.from('repair_part_receipts').update({ removed_at: new Date().toISOString() }).eq('id', receipt.id).is('removed_at', null).select('id').single(), 'Could not remove receipt metadata')
  const removal = await client.storage.from(receipt.bucket || RECEIPT_BUCKET).remove([receipt.path])
  if (removal.error) throw new Error(`Receipt was detached but its stored file needs cleanup: ${removal.error.message}`)
}

export async function getReceiptUrl(receipt) {
  return resultData(await db().storage.from(receipt.bucket || RECEIPT_BUCKET).createSignedUrl(receipt.path, 120), 'Could not open receipt').signedUrl
}

export const operationalMapping = Object.freeze({ assets: 'assets', transfers: 'asset_transfers', custody: 'asset_transfers + assets', repairs: 'repair_tickets', parts: 'repair_parts', purchasing: 'repair_parts + repair_part_receipts', maintenance: 'maintenance_schedules + maintenance_completions', companies: 'companies', assetGroups: 'asset_categories', projects: 'project_locations', activity: 'asset_activity', audit: 'asset_audit_log', receipts: 'storage:asset-receipts' })
