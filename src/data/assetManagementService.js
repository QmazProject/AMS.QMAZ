import { supabase } from '../lib/supabase.js'

const RECEIPT_BUCKET = 'asset-receipts'
const TRANSFER_BUCKET = 'transfer-forms'
const PHOTO_BUCKET = 'asset-photos'
const LOGO_BUCKET = 'company-logos'
const NO_PROJECT = 'X'

const COLUMNS = {
  companies: 'id,name,short_code,contact_person,address,notes,logo_path,is_header_brand,theme_color',
  people: 'id,first_name,middle_name,last_name,is_active,notes',
  categories: 'id,name,notes',
  projects: 'id,project_code,address,latitude,longitude,notes',
  assets: 'id,asset_number,asset_code,company_id,category_id,project_location_id,name,brand,model,photo_path,serial_number,engine_number,plate_number,mv_file_number,conduction_sticker,body_number,status,current_address,current_custodian,acquired_on,acquisition_cost,notes,retired_on,retirement_reason,retirement_details,revision',
  brands: 'id,name,notes',
  models: 'id,brand_id,name,notes',
  transferAttachments: 'id,transfer_id,storage_bucket,storage_object_path,original_filename,mime_type,size_bytes,note,uploaded_by_name,created_at',
  transfers: 'id,asset_id,transfer_number,recorded_by_name,from_project_location_id,to_project_location_id,from_address,to_address,from_custodian,to_custodian,effective_on,reason,reference,created_at',
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
    /* assigned by the database when the movement was recorded, so everyone
       reads the same number off the same movement */
    number: row.transfer_number ?? null,
    /* the account that processed it, stamped on the row when it was written */
    recordedBy: row.recorded_by_name || '',
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
    client.from('responsible_persons').select(COLUMNS.people).order('last_name').order('first_name'),
    client.from('responsible_person_companies').select('responsible_person_id,company_id'),
    client.from('asset_transfer_attachments').select(COLUMNS.transferAttachments).is('removed_at', null).order('created_at'),
    client.from('asset_brands').select(COLUMNS.brands).order('name'),
    client.from('asset_models').select(COLUMNS.models).order('name'),
  ]
  /* Outside the batch above on purpose: a register that has not run the asset
     number migration yet must still load, and simply falls back to the
     browser's own numbering until it does. */
  const nextTagRequest = client.rpc('next_asset_number').then(
    (result) => (result.error ? '' : String(result.data || '')),
    () => '',
  )
  const results = await Promise.all(requests)
  const labels = ['companies', 'asset groups', 'projects/locations', 'assets', 'transfers', 'repairs', 'parts', 'receipts', 'maintenance schedules', 'maintenance history', 'activity history', 'responsible persons', 'responsible person companies', 'transfer attachments', 'brands', 'models']
  results.forEach((result, index) => resultData(result, `Could not load ${labels[index]}`))
  const [companyRows, categoryRows, projectRows, assetRows, transferRows, repairRows, partRows, receiptRows, scheduleRows, completionRows, activityRows, personRows, personCompanyRows, attachmentRows, brandRows, modelRows] = results.map((result) => result.data || [])
  const companies = companyRows.map((row) => ({
    id: row.id, name: row.name, code: row.short_code || '', contact: row.contact_person || '', address: row.address || '', notes: row.notes || '',
    /* the bucket is public, so the mark resolves without a round trip and
       without an expiry to nurse while a page sits open */
    logoPath: row.logo_path || '', logoUrl: row.logo_path ? companyLogoUrl(row.logo_path) : '',
    isHeaderBrand: row.is_header_brand === true, themeColor: row.theme_color || '',
  }))
  const categories = categoryRows.map((row) => ({ id: row.id, name: row.name, notes: row.notes || '' }))
  /* a brand carries its own models, because that is how the registration form
     asks for them: pick the make, then pick from what that make sells */
  const modelsByBrand = new Map()
  modelRows.forEach((row) => {
    modelsByBrand.set(row.brand_id, [...(modelsByBrand.get(row.brand_id) || []), { id: row.id, name: row.name, notes: row.notes || '' }])
  })
  const brands = brandRows.map((row) => ({
    id: row.id, name: row.name, notes: row.notes || '', models: modelsByBrand.get(row.id) || [],
  }))
  /* The display name is assembled once, here, so the forms, the register and
     any report all spell a person the same way. */
  const companiesByPerson = new Map()
  personCompanyRows.forEach((row) => {
    companiesByPerson.set(row.responsible_person_id, [...(companiesByPerson.get(row.responsible_person_id) || []), row.company_id])
  })
  const people = personRows.map((row) => ({
    id: row.id, first: row.first_name, middle: row.middle_name || '', last: row.last_name,
    name: personDisplayName(row), active: row.is_active !== false, notes: row.notes || '',
    companyIds: companiesByPerson.get(row.id) || [],
  }))
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
  const filesByTransfer = new Map()
  attachmentRows.forEach((row) => {
    filesByTransfer.set(row.transfer_id, [...(filesByTransfer.get(row.transfer_id) || []), {
      id: row.id, transferId: row.transfer_id, bucket: row.storage_bucket, path: row.storage_object_path,
      name: row.original_filename, type: row.mime_type, size: Number(row.size_bytes), note: row.note || '',
      at: String(row.created_at).slice(0, 10),
      /* the audit trail on the paperwork: when it was filed, and by whom */
      by: row.uploaded_by_name || '',
    }])
  })
  transferRows.forEach((row) => activityByAsset.set(row.asset_id, [
    ...(activityByAsset.get(row.asset_id) || []),
    { ...mapTransfer(row, projectById), files: filesByTransfer.get(row.id) || [] },
  ]))
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
    name: row.name, brand: row.brand || '', model: row.model || '',
    photoPath: row.photo_path || '', photoUrl: row.photo_path ? assetPhotoUrl(row.photo_path) : '', serial: row.serial_number || '', engine: row.engine_number || '', plate: row.plate_number || '', mvFile: row.mv_file_number || '', conduction: row.conduction_sticker || '', body: row.body_number || '',
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
  return { assets, repairs, plans, companies, categories, projects, people, brands, nextTag: await nextTagRequest }
}

const assetPayload = (value) => ({
  asset_number: String(value.tag ?? '').trim(), asset_code: optional(value.code), company_id: value.companyId || null, category_id: value.categoryId || null, project_location_id: value.projectId || null,
  name: value.name.trim(), brand: optional(value.brand), model: optional(value.model), photo_path: value.photoPath || null, serial_number: optional(value.serial), engine_number: optional(value.engine), plate_number: optional(value.plate), mv_file_number: optional(value.mvFile), conduction_sticker: optional(value.conduction), body_number: optional(value.body),
  current_address: value.location.trim(), current_custodian: value.custodian.trim(), acquired_on: optional(value.acquired), acquisition_cost: numberOrNull(value.cost), notes: optional(value.notes),
})

/* Every identifier on an asset is unique across the whole register, including
   the companies a user cannot see, so a clash with one of those only surfaces
   as a Postgres index name. Say which field it was and what it holds. */
const ASSET_UNIQUE = [
  ['assets_asset_number_ci_uq', 'Asset number', 'tag'],
  ['assets_asset_code_ci_uq', 'Asset code', 'code'],
  ['assets_serial_number_ci_uq', 'Serial number', 'serial'],
  ['assets_engine_number_ci_uq', 'Engine number', 'engine'],
  ['assets_plate_number_ci_uq', 'Plate number', 'plate'],
  ['assets_mv_file_number_ci_uq', 'MV file number', 'mvFile'],
  ['assets_conduction_sticker_ci_uq', 'Conduction sticker', 'conduction'],
  ['assets_body_number_ci_uq', 'Body number', 'body'],
]

function assetResult(result, context, value) {
  const error = result.error
  if (error?.code === '23505') {
    const text = `${error.message || ''} ${error.details || ''}`
    const clash = ASSET_UNIQUE.find(([index]) => text.includes(index))
    if (!clash) throw new Error('That asset is already on the register.')
    const [, label, key] = clash
    const held = String(value?.[key] ?? '').trim()
    throw new Error(held
      ? `${label} "${held}" is already registered to another asset.`
      : `That ${label.toLowerCase()} is already registered to another asset.`)
  }
  return resultData(result, context)
}

/* The number is left blank so the database issues the next one. It comes from
   a sequence every user shares, which is what keeps the register running in
   one unbroken series whatever companies a user can reach. A number typed in
   or carried by an Excel import is kept as it is. */
export const createAsset = async (value) => assetResult(
  await db().from('assets').insert({ ...assetPayload(value), asset_number: String(value.tag ?? '').trim() || null }).select('id, asset_number').single(),
  'Could not register asset', value)
export const updateAsset = async (id, value) => assetResult(await db().from('assets').update(assetPayload(value)).eq('id', id).select('id').single(), 'Could not update asset', value)
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

export const personDisplayName = (row) => [row.first_name ?? row.first, row.middle_name ?? row.middle, row.last_name ?? row.last]
  .map((part) => String(part || '').trim())
  .filter(Boolean)
  .join(' ')

const personPayload = (value) => ({
  first_name: String(value.first || '').trim(),
  middle_name: optional(value.middle),
  last_name: String(value.last || '').trim(),
  notes: optional(value.notes),
})

/* The companies a person belongs to are replaced as a set: whatever the
   checkboxes say after an edit is what the person belongs to. */
async function setPersonCompanies(personId, companyIds) {
  const client = db()
  resultData(await client.from('responsible_person_companies').delete().eq('responsible_person_id', personId), 'Could not update the person\'s companies')
  const wanted = [...new Set((companyIds || []).filter(Boolean))]
  if (!wanted.length) return
  resultData(
    await client.from('responsible_person_companies').insert(wanted.map((companyId) => ({ responsible_person_id: personId, company_id: companyId }))),
    'Could not update the person\'s companies',
  )
}

function personResult(result, context) {
  if (result.error?.code === '23505') throw new Error('Someone with that exact name is already on the list.')
  return resultData(result, context)
}

export async function createPerson(value) {
  const created = personResult(await db().from('responsible_persons').insert(personPayload(value)).select('id').single(), 'Could not add the person')
  await setPersonCompanies(created.id, value.companyIds)
  return created
}

export async function updatePerson(id, value) {
  const saved = personResult(await db().from('responsible_persons').update(personPayload(value)).eq('id', id).select('id').single(), 'Could not update the person')
  await setPersonCompanies(id, value.companyIds)
  return saved
}

/* The models are edited as a list on the brand, so saving one replaces the set:
   anything dropped from the list goes, anything new arrives, and the rows that
   stayed keep their ids. */
async function setBrandModels(brandId, names) {
  const client = db()
  const wanted = []
  const seen = new Set()
  ;(names || []).forEach((raw) => {
    const name = String(raw || '').trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) return
    seen.add(key)
    wanted.push(name)
  })
  const existing = resultData(await client.from('asset_models').select('id,name').eq('brand_id', brandId), 'Could not read the brand\'s models')
  const keep = new Set(wanted.map((name) => name.toLowerCase()))
  const gone = existing.filter((row) => !keep.has(String(row.name).trim().toLowerCase())).map((row) => row.id)
  if (gone.length) resultData(await client.from('asset_models').delete().in('id', gone), 'Could not remove a model')
  const held = new Set(existing.map((row) => String(row.name).trim().toLowerCase()))
  const added = wanted.filter((name) => !held.has(name.toLowerCase()))
  if (added.length) {
    resultData(await client.from('asset_models').insert(added.map((name) => ({ brand_id: brandId, name }))), 'Could not add a model')
  }
}

const brandPayload = (value) => ({ name: value.name.trim(), notes: optional(value.notes) })
const modelList = (value) => String(value.models || '').split(/[\n,]/).map((name) => name.trim()).filter(Boolean)

function brandResult(result, context) {
  if (result.error?.code === '23505') throw new Error('That brand is already on the list.')
  return resultData(result, context)
}

export async function createBrand(value) {
  const created = brandResult(await db().from('asset_brands').insert(brandPayload(value)).select('id').single(), 'Could not add the brand')
  await setBrandModels(created.id, modelList(value))
  return created
}

export async function updateBrand(id, value) {
  const saved = brandResult(await db().from('asset_brands').update(brandPayload(value)).eq('id', id).select('id').single(), 'Could not update the brand')
  await setBrandModels(id, modelList(value))
  return saved
}

export const deleteBrand = async (id) =>
  resultData(await db().from('asset_brands').delete().eq('id', id).select('id').single(), 'Could not remove the brand')

export const deletePerson = async (id) =>
  resultData(await db().from('responsible_persons').delete().eq('id', id).select('id').single(), 'Could not remove the person')

const companyPayload = (value) => ({ name: value.name.trim(), short_code: optional(value.code), contact_person: optional(value.contact), address: optional(value.address), notes: optional(value.notes), logo_path: value.logoPath || null, theme_color: /^#[0-9a-fA-F]{6}$/.test(String(value.theme || '')) ? String(value.theme).toLowerCase() : null })
const categoryPayload = (value) => ({ name: value.name.trim(), notes: optional(value.notes) })
const projectPayload = (value) => {
  const match = String(value.geocode || '').match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/)
  return { project_code: value.pid.trim(), address: value.location.trim(), latitude: match ? Number(match[1]) : null, longitude: match ? Number(match[2]) : null, notes: optional(value.notes) }
}
/* The dialog can only compare a new name against the companies this user is
   allowed to see, so a clash with one outside their scope only surfaces here.
   Postgres names the index it caught; say what it means instead. */
function companyResult(result, context) {
  const error = result.error
  if (error?.code === '23505') {
    const constraint = `${error.message || ''} ${error.details || ''}`
    throw new Error(constraint.includes('short_code')
      ? 'Another company already uses that short code. Pick a different one.'
      : 'A company with that name is already on the register.')
  }
  return resultData(result, context)
}

export const createCompany = async (value) => companyResult(await db().from('companies').insert(companyPayload(value)).select('id').single(), 'Could not create company')
export const updateCompany = async (id, value) => companyResult(await db().from('companies').update(companyPayload(value)).eq('id', id).select('id').single(), 'Could not update company')
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

export const companyLogoUrl = (path) => db().storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl

/* Uploaded under a random name so replacing a logo never collides with a
   cached copy of the old one, and returns the path the row stores. */
export async function uploadCompanyLogo(file) {
  const client = db()
  const user = resultData(await client.auth.getUser(), 'Could not verify who is uploading the logo').user
  if (!user) throw new Error('You must be signed in to upload a company logo.')
  const path = `${crypto.randomUUID()}-${safeFilename(file.name)}`
  resultData(await client.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false }), 'Could not upload the company logo')
  return path
}

/* A replaced or cleared logo is deleted after the row has been saved, so a
   failed save never leaves the company pointing at a file that is gone. */
/* One company at a time, cleared and set in a single server-side transaction;
   pass null to leave the workspace unbranded. */
export const setCompanyHeaderBrand = async (companyId) =>
  resultData(await db().rpc('set_company_header_brand', { p_company_id: companyId || null }), 'Could not change the workspace brand')

export async function deleteCompanyLogo(path) {
  if (!path) return
  const removal = await db().storage.from(LOGO_BUCKET).remove([path])
  if (removal.error) throw new Error(`The company was saved but its old logo needs cleanup: ${removal.error.message}`)
}

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

/* The signed form that came back on paper. Uploaded under the caller's own
   folder because that is all the storage policy can check before the metadata
   row exists; from then on the row is what decides who may read the file. */
/* A photograph of the asset itself. Same shape as the company mark: uploaded
   under a random name so replacing one never collides with a cached copy of
   the old, and the row stores the path. */
export const assetPhotoUrl = (path) => db().storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl

export async function uploadAssetPhoto(file) {
  const client = db()
  const user = resultData(await client.auth.getUser(), 'Could not verify who is uploading the photo').user
  if (!user) throw new Error('You must be signed in to add a photo.')
  const path = `${user.id}/${crypto.randomUUID()}-${safeFilename(file.name)}`
  resultData(await client.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false }), 'Could not upload the photo')
  return path
}

/* Deleted after the row is saved, so a failed save never leaves an asset
   pointing at a file that is gone. */
export async function deleteAssetPhoto(path) {
  if (!path) return
  const removal = await db().storage.from(PHOTO_BUCKET).remove([path])
  if (removal.error) throw new Error(`The asset was saved but its old photo needs cleanup: ${removal.error.message}`)
}

export async function saveTransferAttachment(transferId, file, note = '') {
  const client = db()
  const user = resultData(await client.auth.getUser(), 'Could not verify who is filing the form').user
  if (!user) throw new Error('You must be signed in to attach a form.')
  const path = `${user.id}/${transferId}/${crypto.randomUUID()}-${safeFilename(file.name)}`
  resultData(await client.storage.from(TRANSFER_BUCKET).upload(path, file, { contentType: file.type, upsert: false }), 'Could not upload the signed form')
  const metadata = await client.from('asset_transfer_attachments').insert({
    transfer_id: transferId, storage_bucket: TRANSFER_BUCKET, storage_object_path: path,
    original_filename: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, note: optional(note),
  }).select('id').single()
  if (metadata.error) {
    /* the row is what makes the file readable, so an orphan is worse than none */
    await client.storage.from(TRANSFER_BUCKET).remove([path])
    resultData(metadata, 'Could not file the signed form')
  }
  return metadata.data
}

export async function removeTransferAttachment(attachment) {
  const client = db()
  resultData(await client.from('asset_transfer_attachments').update({ removed_at: new Date().toISOString() }).eq('id', attachment.id).is('removed_at', null).select('id').single(), 'Could not detach the form')
  const removal = await client.storage.from(attachment.bucket || TRANSFER_BUCKET).remove([attachment.path])
  if (removal.error) throw new Error(`The form was detached but its stored file needs cleanup: ${removal.error.message}`)
}

export async function getTransferAttachmentUrl(attachment) {
  return resultData(await db().storage.from(attachment.bucket || TRANSFER_BUCKET).createSignedUrl(attachment.path, 120), 'Could not open the attached form').signedUrl
}

export async function getReceiptUrl(receipt) {
  return resultData(await db().storage.from(receipt.bucket || RECEIPT_BUCKET).createSignedUrl(receipt.path, 120), 'Could not open receipt').signedUrl
}

export const operationalMapping = Object.freeze({ assets: 'assets', transfers: 'asset_transfers', custody: 'asset_transfers + assets', repairs: 'repair_tickets', parts: 'repair_parts', purchasing: 'repair_parts + repair_part_receipts', maintenance: 'maintenance_schedules + maintenance_completions', companies: 'companies', assetGroups: 'asset_categories', projects: 'project_locations', activity: 'asset_activity', audit: 'asset_audit_log', receipts: 'storage:asset-receipts', companyLogos: 'storage:company-logos', assetPhotos: 'storage:asset-photos', transferForms: 'asset_transfer_attachments + storage:transfer-forms' })
