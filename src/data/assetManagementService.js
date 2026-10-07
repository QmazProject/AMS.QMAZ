import { supabase } from '../lib/supabase.js'

const RECEIPT_BUCKET = 'asset-receipts'
const TRANSFER_BUCKET = 'transfer-forms'
const PHOTO_BUCKET = 'asset-photos'
const DOC_BUCKET = 'asset-documents'
const MAINT_BUCKET = 'maintenance-attachments'
const LOGO_BUCKET = 'company-logos'

/* How the register writes the numbers it issues. The width of the start the
   admin typed is the padding: 000001 means six digits, 1 means none. The
   defaults are what the register does when the preference has never been
   saved, so a database without the migration still loads and reads the same. */
export const SEQUENCE_DEFAULT = Object.freeze({ start: 1, end: 999999999999999, width: 1 })
/* The shape of a number the register issued itself, as asset_number_value on
   the server reads it: AST- and up to fifteen digits, any case, any width.
   Only numbers in this shape can be rewritten when the sequence changes. */
export const SYSTEM_ASSET_NUMBER = /^AST-[0-9]{1,15}$/i
export const isSystemAssetNumber = (tag) => SYSTEM_ASSET_NUMBER.test(String(tag ?? '').trim())
/* The tags on a loaded register that the sequence change would have to leave
   behind: how many, and up to five of them by name. The server runs the same
   scan before it writes anything; this only tells the admin sooner. */
export function unsupportedAssetNumbers(assets, sample = 5) {
  const tags = (assets || []).map((asset) => String(asset?.tag ?? '').trim()).filter((tag) => tag && !isSystemAssetNumber(tag))
  return { count: tags.length, examples: [...new Set(tags)].sort((a, b) => a.localeCompare(b)).slice(0, sample) }
}
export const formatSequenceNumber = (value, sequence) => {
  if (value === null || value === undefined || value === '') return ''
  const text = String(value)
  return text.padStart(Math.max(1, Number(sequence?.width) || 1), '0')
}
/* Why a typed start and end cannot be saved, or an empty string when they can.
   The server checks the same things; this only spares a round trip. */
export function sequenceProblem(start, end) {
  const startText = String(start ?? '').trim()
  const endText = String(end ?? '').trim()
  if (!/^[0-9]{1,15}$/.test(startText)) return 'The start must be digits only, up to 15 of them, e.g. 000001.'
  if (!/^[0-9]{1,15}$/.test(endText)) return 'The end must be digits only, up to 15 of them, e.g. 999999.'
  if (Number.parseInt(startText, 10) < 1) return 'The start of the sequence must be 1 or higher.'
  if (Number.parseInt(endText, 10) < Number.parseInt(startText, 10)) return 'The end of the sequence must not be lower than its start.'
  return ''
}
const numberingFromRows = (rows) => {
  const numbering = { asset: { ...SEQUENCE_DEFAULT }, transfer: { ...SEQUENCE_DEFAULT } }
  ;(rows || []).forEach((row) => {
    if (row.kind in numbering) numbering[row.kind] = { start: Number(row.start_value), end: Number(row.end_value), width: Number(row.pad_width) || 1 }
  })
  return numbering
}
const NO_PROJECT = 'X'

const COLUMNS = {
  companies: 'id,name,short_code,contact_person,address,notes,logo_path,is_header_brand,theme_color',
  people: 'id,first_name,middle_name,last_name,is_active,notes',
  categories: 'id,name,notes',
  projects: 'id,project_code,address,latitude,longitude,notes',
  assets: 'id,asset_number,asset_code,company_id,category_id,project_location_id,name,brand,model,photo_path,serial_number,engine_number,plate_number,mv_file_number,conduction_sticker,body_number,status,current_address,current_custodian,acquired_on,acquisition_cost,notes,retired_on,retirement_reason,retirement_details,revision,created_at',
  brands: 'id,name,notes',
  models: 'id,brand_id,name,notes',
  transferAttachments: 'id,transfer_id,storage_bucket,storage_object_path,original_filename,mime_type,size_bytes,note,uploaded_by_name,created_at',
  assetAttachments: 'id,asset_id,storage_bucket,storage_object_path,original_filename,doc_type,mime_type,size_bytes,note,created_at',
  maintenanceAttachments: 'id,record_id,storage_bucket,storage_object_path,original_filename,mime_type,size_bytes,note,uploaded_by_name,created_at',
  assetImages: 'id,asset_id,storage_bucket,storage_object_path,position,created_at',
  transfers: 'id,asset_id,transfer_number,recorded_by_name,from_project_location_id,to_project_location_id,from_address,to_address,from_custodian,to_custodian,effective_on,reason,reference,created_at',
  repairs: 'id,ticket_number,asset_id,stage,outcome,fault,reported_by_name,service_provider,hold_address,reported_on,target_completion_on,technician_name,started_on,work_done,repair_completed_on,test_result,labor_cost,other_cost,return_address,returned_to_name,closed_on,closure_reason',
  parts: 'id,repair_ticket_id,name,state,quantity,estimated_amount,unit_price,supplier,needed_on,ordered_on,purchased_on,order_reference,created_at',
  receipts: 'id,repair_part_id,storage_bucket,storage_object_path,original_filename,mime_type,size_bytes,receipt_number,receipt_date,removed_at,created_at',
  schedules: 'id,asset_id,name,repeat_every,interval_unit,next_due_on,last_completed_on,service_provider,estimated_cost,notes',
  completions: 'id,maintenance_schedule_id,completed_on,cost,service_provider,reference,notes,next_due_on,created_at',
  maintenanceRecords: 'id,asset_id,maintenance_type,ero_code,repair_place,started_on,assigned_to,location,failure_cause,mileage_hours,repaired_by,repair_hours,pm_hours,parts,contractor_vendor,contractor_address,finished_on,parts_total,labor_total,completed_on,downtime,mechanic_operator,assistant_supervisor,supervisor,department_head,remarks,created_at,updated_at',
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

function mapTransfer(row, projectById, transferSequence) {
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
    number: row.transfer_number === null || row.transfer_number === undefined ? null : formatSequenceNumber(row.transfer_number, transferSequence),
    /* the account that processed it, stamped on the row when it was written */
    recordedBy: row.recorded_by_name || '',
    text: registration ? `Registered at ${row.to_address}, under ${row.to_custodian}` : pieces.join(' · ') || 'Transfer recorded',
    sub: [row.reason, row.reference, `Project/Location ${toProject}`].filter(Boolean).join(' · '),
    move: { fromLoc: row.from_address, toLoc: row.to_address, fromPer: row.from_custodian, toPer: row.to_custodian, fromProject, project: toProject, why: row.reason || row.reference || 'Transfer' },
  }
}

/* One filed form, as the panel reads it. Shared so a form that has just been
   uploaded takes exactly the shape of one that came back from a full load, and
   can be dropped straight into state without refetching the register. */
const attachmentFromRow = (row) => ({
  id: row.id, transferId: row.transfer_id, bucket: row.storage_bucket, path: row.storage_object_path,
  name: row.original_filename, type: row.mime_type, size: Number(row.size_bytes), note: row.note || '',
  at: String(row.created_at).slice(0, 10),
  /* the audit trail on the paperwork: when it was filed, and by whom */
  by: row.uploaded_by_name || '',
})

/* A document filed against the asset itself rather than against a movement of
   it. `label` is what the register calls the paper and `docType` is what kind
   of paper it is; both are the user's words, not the scanner's. */
/* A photograph of the asset. The bucket is public, so the url resolves
   without signing and the register can draw a list of thumbnails without a
   round trip per row. */
const assetImageFromRow = (row) => ({
  id: row.id, assetId: row.asset_id, bucket: row.storage_bucket, path: row.storage_object_path,
  position: row.position, url: assetPhotoUrl(row.storage_object_path),
  at: String(row.created_at).slice(0, 10),
})

const assetAttachmentFromRow = (row) => ({
  id: row.id, assetId: row.asset_id, bucket: row.storage_bucket, path: row.storage_object_path,
  label: row.original_filename, docType: row.doc_type, type: row.mime_type,
  size: Number(row.size_bytes), note: row.note || '',
  at: String(row.created_at).slice(0, 10),
})

/* A file kept with a historic maintenance record: a quotation, an invoice, a
   photo of the failed part. For the record only - the ERO sheet never reads
   these. Same shape whether it came from a full load or was just filed. */
const maintenanceAttachmentFromRow = (row) => ({
  id: row.id, recordId: row.record_id, bucket: row.storage_bucket, path: row.storage_object_path,
  name: row.original_filename, type: row.mime_type, size: Number(row.size_bytes), note: row.note || '',
  at: String(row.created_at).slice(0, 10),
  by: row.uploaded_by_name || '',
})

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
  /* Same reasoning, for the same reason: an asset's documents and its extra
     photographs arrived after this register was first deployed, so a database
     that has not run those migrations yet loads without them rather than not
     at all. A missing table is an empty list, not a broken workspace. */
  const optionalRows = (query) => query.then(
    (result) => (result.error ? [] : (result.data || [])),
    () => [],
  )
  const documentRequest = optionalRows(
    client.from('asset_attachments').select(COLUMNS.assetAttachments).is('removed_at', null).order('created_at'),
  )
  const imageRequest = optionalRows(
    client.from('asset_images').select(COLUMNS.assetImages).is('removed_at', null).order('position').order('created_at'),
  )
  /* the numbering preference and the transfer preview arrived later still;
     without them the register reads exactly as it did before they existed */
  const numberingRequest = optionalRows(client.from('numbering_sequences').select('kind,start_value,end_value,pad_width'))
  const nextTransferRequest = client.rpc('next_transfer_number').then(
    (result) => (result.error || result.data === null || result.data === undefined ? null : Number(result.data)),
    () => null,
  )
  /* historic maintenance: newest job first, the way the Historic tab lists it */
  /* every column rather than the list, so a register whose table predates a
     later column (repair_place arrived after the table did) still loads its
     history instead of a 400 that reads as "the records are gone" */
  const recordRequest = optionalRows(
    client.from('maintenance_records').select('*').order('started_on', { ascending: false }).order('created_at', { ascending: false }),
  )
  /* the files kept with those records, oldest first as they were filed; a
     register that has not run that migration yet simply has none */
  const historyFileRequest = optionalRows(
    client.from('maintenance_record_attachments').select(COLUMNS.maintenanceAttachments).is('removed_at', null).order('created_at'),
  )
  const [results, documentRows, imageRows, numberingRows, nextTransfer, recordRows, historyFileRows] = await Promise.all([Promise.all(requests), documentRequest, imageRequest, numberingRequest, nextTransferRequest, recordRequest, historyFileRequest])
  const filesByRecord = new Map()
  historyFileRows.forEach((row) => {
    filesByRecord.set(row.record_id, [...(filesByRecord.get(row.record_id) || []), maintenanceAttachmentFromRow(row)])
  })
  const maintenanceRecords = recordRows.map((row) => ({ ...maintenanceRecordFromRow(row), files: filesByRecord.get(row.id) || [] }))
  const numbering = numberingFromRows(numberingRows)
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
    filesByTransfer.set(row.transfer_id, [...(filesByTransfer.get(row.transfer_id) || []), attachmentFromRow(row)])
  })
  transferRows.forEach((row) => activityByAsset.set(row.asset_id, [
    ...(activityByAsset.get(row.asset_id) || []),
    { ...mapTransfer(row, projectById, numbering.transfer), files: filesByTransfer.get(row.id) || [] },
  ]))
  const picturesByAsset = new Map()
  imageRows.forEach((row) => {
    picturesByAsset.set(row.asset_id, [...(picturesByAsset.get(row.asset_id) || []), assetImageFromRow(row)])
  })
  const docsByAsset = new Map()
  documentRows.forEach((row) => {
    docsByAsset.set(row.asset_id, [...(docsByAsset.get(row.asset_id) || []), assetAttachmentFromRow(row)])
  })
  const receiptsByPart = new Map(receiptRows.map((row) => [row.repair_part_id, {
    id: row.id, name: row.original_filename, type: row.mime_type, size: Number(row.size_bytes),
    at: row.receipt_date || String(row.created_at).slice(0, 10), path: row.storage_object_path, bucket: row.storage_bucket,
  }]))
  const partsByRepair = new Map()
  partRows.forEach((row) => {
    const part = { id: row.id, name: row.name, state: stateToUi(row.state), qty: row.quantity, unit: row.unit_price ?? (row.estimated_amount === null || row.estimated_amount === undefined ? '' : Number(row.estimated_amount) / (Number(row.quantity) || 1)), estimated: row.estimated_amount ?? '', supplier: row.supplier || '', date: row.purchased_on || row.ordered_on || row.needed_on, ref: row.order_reference || '', receipt: receiptsByPart.get(row.id) || null }
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
    /* Every picture of this machine, in the order somebody chose. The first
       is the cover: photo_path is kept pointing at the same object for the
       trigger and for anything reading the column, but the list is what
       decides, so the two drifting apart can never show the wrong picture. */
    images: picturesByAsset.get(row.id) || [],
    photoPath: (picturesByAsset.get(row.id) || [])[0]?.path || row.photo_path || '',
    photoUrl: (picturesByAsset.get(row.id) || [])[0]?.url || (row.photo_path ? assetPhotoUrl(row.photo_path) : ''), serial: row.serial_number || '', engine: row.engine_number || '', plate: row.plate_number || '', mvFile: row.mv_file_number || '', conduction: row.conduction_sticker || '', body: row.body_number || '',
    status: row.status, location: row.current_address, custodian: row.current_custodian, acquired: row.acquired_on || '', cost: row.acquisition_cost ?? '', notes: row.notes || '',
    retiredOn: row.retired_on, retirementReason: row.retirement_reason, retirementDetails: row.retirement_details, revision: row.revision,
    /* when the record was written, which is not the same as when the machine
       was bought — the register lists by the former so the newest work is on
       top, and reports by the latter */
    created: row.created_at || '',
    history: [...(activityByAsset.get(row.id) || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.ts - b.ts),
    /* the invoice, the registration, the deed - whatever paperwork proves this
       machine is the company's */
    files: docsByAsset.get(row.id) || [],
  }))
  const repairs = repairRows.map((row) => ({
    id: row.id, assetId: row.asset_id, ticket: row.ticket_number, stage: row.stage, outcome: row.outcome, fault: row.fault, reportedBy: row.reported_by_name || '', provider: row.service_provider || '', holdAddress: row.hold_address || '', date: row.reported_on, due: row.target_completion_on || '',
    technician: row.technician_name || '', startedOn: row.started_on || '', work: row.work_done || '', repairCompletedOn: row.repair_completed_on || '', testResult: row.test_result || '', labor: row.labor_cost, other: row.other_cost,
    returnAddress: row.return_address || '', returnedTo: row.returned_to_name || '', closed: row.stage === 'closed', closedOn: row.closed_on || '', closureReason: row.closure_reason || '', parts: partsByRepair.get(row.id) || [], log: activityByRepair.get(row.id) || [],
  }))
  const plans = scheduleRows.map((row) => ({ id: row.id, assetId: row.asset_id, name: row.name, every: row.repeat_every, unit: row.interval_unit, nextDue: row.next_due_on, lastDone: row.last_completed_on || '', provider: row.service_provider || '', estCost: row.estimated_cost ?? '', notes: row.notes || '', done: completionBySchedule.get(row.id) || [] }))
  return { assets, repairs, plans, companies, categories, projects, people, brands, numbering, nextTransfer, maintenanceRecords, nextTag: await nextTagRequest }
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

/* Where the asset is now, and where the form says it is going. The origin is
   read off the asset rather than the form, so two assets moved together each
   keep their own. */
const transferRow = (asset, value) => ({
  asset_id: asset.id,
  from_project_location_id: asset.projectId || null, to_project_location_id: value.projectId || null,
  from_address: asset.location, to_address: value.location.trim(),
  from_custodian: asset.custodian, to_custodian: value.custodian.trim(),
  effective_on: value.date, reason: optional(value.reason),
})

export async function transferAsset(asset, value) {
  return resultData(await db().from('asset_transfers').insert(transferRow(asset, value)).select('id').single(), 'Could not transfer asset')
}

/* A cartful going to one place. One insert, so the movements are recorded
   together or not at all — a half-moved cart is worse than none, because the
   register would then disagree with the single sheet signed for all of them. */
export async function transferAssets(assets, value) {
  if (!assets.length) throw new Error('The transfer cart is empty.')
  return resultData(
    await db().from('asset_transfers').insert(assets.map((asset) => transferRow(asset, value))).select('id,transfer_number'),
    'Could not transfer the assets',
  )
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

/* Historic maintenance: one repair or P.M. job written up against an asset.
   The row is read into the shape the Historic form edits, and written back
   from it; parts lines travel as a JSON list, blank lines dropped. */
export const MAINTENANCE_RECORD_TYPES = Object.freeze([
  { value: 'repair', label: 'Repair' },
  { value: 'pms', label: 'Preventive Maintenance Schedule (PMS)' },
])
/* the three cells of the paper's CODE row, offered as suggestions; the field
   itself is free text */
export const REPAIR_PLACES = Object.freeze(['Field', 'Yard', 'Contracted outside'])
export const maintenanceRecordTypeLabel = (value) => MAINTENANCE_RECORD_TYPES.find((type) => type.value === value)?.label || value || ''
const blankPartLine = () => ({ qty: '', partNo: '', description: '', unitCost: '', amount: '' })
const partLinesFromJson = (value) => (Array.isArray(value) ? value : []).map((line) => ({
  qty: String(line?.qty ?? ''), partNo: String(line?.partNo ?? ''), description: String(line?.description ?? ''),
  unitCost: String(line?.unitCost ?? ''), amount: String(line?.amount ?? ''),
}))
const partLinesToJson = (lines) => (Array.isArray(lines) ? lines : [])
  .map((line) => ({ qty: String(line?.qty ?? '').trim(), partNo: String(line?.partNo ?? '').trim(), description: String(line?.description ?? '').trim(), unitCost: String(line?.unitCost ?? '').trim(), amount: String(line?.amount ?? '').trim() }))
  .filter((line) => Object.values(line).some(Boolean))
export const emptyMaintenanceRecord = () => ({
  type: 'repair', eroCode: '', repairPlace: '', startedOn: '', assignedTo: '', location: '', failureCause: '', mileageHours: '',
  repairedBy: '', repairHours: '', pmHours: '', parts: [blankPartLine()],
  vendor: '', vendorAddress: '', finishedOn: '', partsTotal: '', laborTotal: '',
  completedOn: '', downtime: '', mechanicOperator: '', assistantSupervisor: '', supervisor: '', departmentHead: '', remarks: '',
  /* files kept with the record; never part of the row itself */
  files: [],
})
export { blankPartLine as blankMaintenancePartLine }
export function maintenanceRecordFromRow(row) {
  const parts = partLinesFromJson(row.parts)
  return {
    id: row.id, assetId: row.asset_id, type: row.maintenance_type, eroCode: row.ero_code || '', repairPlace: row.repair_place || '',
    startedOn: row.started_on || '', assignedTo: row.assigned_to || '', location: row.location || '',
    failureCause: row.failure_cause || '', mileageHours: row.mileage_hours || '',
    repairedBy: row.repaired_by || '', repairHours: row.repair_hours || '', pmHours: row.pm_hours || '',
    parts: parts.length ? parts : [blankPartLine()],
    vendor: row.contractor_vendor || '', vendorAddress: row.contractor_address || '', finishedOn: row.finished_on || '',
    partsTotal: row.parts_total ?? '', laborTotal: row.labor_total ?? '',
    completedOn: row.completed_on || '', downtime: row.downtime || '', mechanicOperator: row.mechanic_operator || '',
    assistantSupervisor: row.assistant_supervisor || '', supervisor: row.supervisor || '', departmentHead: row.department_head || '',
    remarks: row.remarks || '', createdAt: row.created_at || '', updatedAt: row.updated_at || '',
  }
}
const maintenanceRecordPayload = (value) => ({
  maintenance_type: value.type === 'pms' ? 'pms' : 'repair', ero_code: optional(value.eroCode), started_on: value.startedOn,
  /* only sent when something was written, so a save without a code still
     lands on a table that has not gained the column yet */
  ...(optional(value.repairPlace) ? { repair_place: optional(value.repairPlace) } : {}),
  assigned_to: optional(value.assignedTo), location: optional(value.location), failure_cause: optional(value.failureCause), mileage_hours: optional(value.mileageHours),
  repaired_by: optional(value.repairedBy), repair_hours: optional(value.repairHours), pm_hours: optional(value.pmHours), parts: partLinesToJson(value.parts),
  contractor_vendor: optional(value.vendor), contractor_address: optional(value.vendorAddress), finished_on: optional(value.finishedOn),
  parts_total: numberOrNull(value.partsTotal), labor_total: numberOrNull(value.laborTotal),
  completed_on: optional(value.completedOn), downtime: optional(value.downtime), mechanic_operator: optional(value.mechanicOperator),
  assistant_supervisor: optional(value.assistantSupervisor), supervisor: optional(value.supervisor), department_head: optional(value.departmentHead), remarks: optional(value.remarks),
})
export const createMaintenanceRecord = async (assetId, value) => resultData(
  await db().from('maintenance_records').insert({ asset_id: assetId, ...maintenanceRecordPayload(value) }).select('id').single(),
  'Could not save the maintenance record',
)
export const updateMaintenanceRecord = async (id, value) => resultData(
  await db().from('maintenance_records').update(maintenanceRecordPayload(value)).eq('id', id).select('id').single(),
  'Could not update the maintenance record',
)
export const deleteMaintenanceRecord = async (id) => resultData(
  await db().from('maintenance_records').delete().eq('id', id).select('id').single(),
  'Could not delete the maintenance record',
)

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

/* Where a numbering series starts and ends, as typed: the zeros on the start
   are the padding. Saved by set_numbering_sequence, which checks the caller,
   moves the counter up to the start, and for assets rewrites the numbers the
   register issued itself in the new width. */
export async function saveNumberingSequence(kind, { start, end }) {
  const problem = sequenceProblem(start, end)
  if (problem) throw new Error(problem)
  const startText = String(start).trim()
  const result = await db().rpc('set_numbering_sequence', { p_kind: kind, p_start: Number.parseInt(startText, 10), p_end: Number.parseInt(String(end).trim(), 10), p_width: startText.length })
  if (result.error) {
    /* The server's refusals are written for the admin to read - which tags
       are in the way, which pair would collide - so they are passed through
       as they are instead of behind a generic prefix. */
    const error = new Error(result.error.message || 'Could not save the numbering sequence.')
    error.cause = result.error
    throw error
  }
  return result.data
}

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
/* The rows that say which photographs an asset has, and in what order. The
   objects themselves go up through uploadAssetPhoto, exactly as the single
   photo always did - this only records them against the asset. */
export const saveAssetImage = async (assetId, path, position) => assetImageFromRow(resultData(
  await db().from('asset_images').insert({ asset_id: assetId, storage_bucket: PHOTO_BUCKET, storage_object_path: path, position })
    .select(COLUMNS.assetImages).single(),
  'Could not file the asset image',
))

/* Reordering is the whole point of the list, so it is one call: the caller
   hands over the ids in the order it wants them and each is stamped with where
   it landed. */
export async function setAssetImagePositions(ordered) {
  const client = db()
  for (const [index, id] of ordered.entries()) {
    resultData(
      await client.from('asset_images').update({ position: index }).eq('id', id).is('removed_at', null).select('id').single(),
      'Could not reorder the asset images',
    )
  }
}

export async function removeAssetImage(image) {
  const client = db()
  resultData(await client.from('asset_images').update({ removed_at: new Date().toISOString() }).eq('id', image.id).is('removed_at', null).select('id').single(), 'Could not remove the asset image')
  const removal = await client.storage.from(image.bucket || PHOTO_BUCKET).remove([image.path])
  if (removal.error) throw new Error(`The image was removed but its stored file needs cleanup: ${removal.error.message}`)
}

export async function deleteAssetPhoto(path) {
  if (!path) return
  const removal = await db().storage.from(PHOTO_BUCKET).remove([path])
  if (removal.error) throw new Error(`The asset was saved but its old photo needs cleanup: ${removal.error.message}`)
}

/* ---------------------- the asset's own paperwork ------------------------
   The invoice, the certificate of registration, the deed of sale. Same shape
   as a filed transfer form: the object goes up under the caller's own folder,
   then the metadata row is what decides who may read it back.
   ------------------------------------------------------------------------ */

export async function saveAssetAttachment(assetId, file, { label = '', docType = '' } = {}) {
  const client = db()
  const kind = String(docType || '').trim()
  if (!kind) throw new Error('A filed document needs a type.')
  const user = resultData(await client.auth.getUser(), 'Could not verify who is filing the document').user
  if (!user) throw new Error('You must be signed in to attach a document.')
  const path = `${user.id}/${assetId}/${crypto.randomUUID()}-${safeFilename(file.name)}`
  resultData(await client.storage.from(DOC_BUCKET).upload(path, file, { contentType: file.type, upsert: false }), `Could not upload ${file.name}`)
  const metadata = await client.from('asset_attachments').insert({
    asset_id: assetId, storage_bucket: DOC_BUCKET, storage_object_path: path,
    original_filename: String(label || '').trim() || file.name,
    doc_type: kind,
    mime_type: file.type || 'application/octet-stream', size_bytes: file.size,
  }).select(COLUMNS.assetAttachments).single()
  if (metadata.error) {
    /* the row is what makes the object readable, so an orphan is worse than none */
    await client.storage.from(DOC_BUCKET).remove([path])
    resultData(metadata, `Could not file ${file.name}`)
  }
  return assetAttachmentFromRow(metadata.data)
}

/* Correcting the label or the type changes only what the register calls the
   document. The stored object keeps its path, so nothing has to be moved. */
export async function updateAssetAttachment(id, { label, docType }) {
  const clean = String(label || '').trim()
  const kind = String(docType || '').trim()
  if (!clean) throw new Error('A filed document needs a name.')
  if (!kind) throw new Error('A filed document needs a type.')
  return assetAttachmentFromRow(resultData(
    await db().from('asset_attachments').update({ original_filename: clean, doc_type: kind }).eq('id', id).is('removed_at', null).select(COLUMNS.assetAttachments).single(),
    'Could not update the filed document',
  ))
}

export async function removeAssetAttachment(attachment) {
  const client = db()
  resultData(await client.from('asset_attachments').update({ removed_at: new Date().toISOString() }).eq('id', attachment.id).is('removed_at', null).select('id').single(), 'Could not remove the document')
  const removal = await client.storage.from(attachment.bucket || DOC_BUCKET).remove([attachment.path])
  if (removal.error) throw new Error(`The document was removed but its stored file needs cleanup: ${removal.error.message}`)
}

export async function getAssetAttachmentUrl(attachment) {
  return resultData(await db().storage.from(attachment.bucket || DOC_BUCKET).createSignedUrl(attachment.path, 120), 'Could not open the document').signedUrl
}

/* Thumbnails for a whole panel in one round trip rather than one per picture.
   The bucket is private, so every scan shown has to be signed for; an hour is
   long enough that a panel left open does not go blank, and short enough that
   a URL copied out of the page stops working. Returns what it could sign,
   keyed by attachment id - a document that will not sign simply has no
   thumbnail, which is a gap in a grid rather than a broken panel. */
export async function getAssetAttachmentUrls(attachments) {
  const wanted = (attachments || []).filter((one) => one && one.path)
  if (!wanted.length) return {}
  const signed = await db().storage.from(DOC_BUCKET).createSignedUrls(wanted.map((one) => one.path), 3600)
  if (signed.error) return {}
  const byPath = new Map((signed.data || []).filter((row) => row.signedUrl).map((row) => [row.path, row.signedUrl]))
  return Object.fromEntries(
    wanted.map((one) => [one.id, byPath.get(one.path) || '']).filter(([, url]) => url),
  )
}

/* `name` is what the register calls this piece of paperwork, which is not
   what the phone called the picture — a camera roll hands over things like
   cf727768-1337-4703-b3dc-44f767a6e3fb.jpg, which tells a later reader
   nothing. The name the file arrived under is not lost: safeFilename puts it
   in the storage path. */
export async function saveTransferAttachment(transferId, file, { name = '', note = '' } = {}) {
  const client = db()
  const user = resultData(await client.auth.getUser(), 'Could not verify who is filing the form').user
  if (!user) throw new Error('You must be signed in to attach a form.')
  const path = `${user.id}/${transferId}/${crypto.randomUUID()}-${safeFilename(file.name)}`
  resultData(await client.storage.from(TRANSFER_BUCKET).upload(path, file, { contentType: file.type, upsert: false }), 'Could not upload the signed form')
  const metadata = await client.from('asset_transfer_attachments').insert({
    transfer_id: transferId, storage_bucket: TRANSFER_BUCKET, storage_object_path: path,
    original_filename: String(name || '').trim() || file.name,
    mime_type: file.type || 'application/octet-stream', size_bytes: file.size, note: optional(note),
  }).select(COLUMNS.transferAttachments).single()
  if (metadata.error) {
    /* the row is what makes the file readable, so an orphan is worse than none */
    await client.storage.from(TRANSFER_BUCKET).remove([path])
    resultData(metadata, 'Could not file the signed form')
  }
  /* the uploader's name is filled in by a trigger, so the returned row is the
     complete record and the panel does not have to reload to show it */
  return attachmentFromRow(metadata.data)
}

/* Correcting the name later changes only the label. The stored object keeps
   its path, so nothing has to be moved and no link goes stale. */
export async function renameTransferAttachment(id, name) {
  const clean = String(name || '').trim()
  if (!clean) throw new Error('The filed form needs a name.')
  return attachmentFromRow(resultData(
    await db().from('asset_transfer_attachments').update({ original_filename: clean }).eq('id', id).is('removed_at', null).select(COLUMNS.transferAttachments).single(),
    'Could not rename the filed form',
  ))
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

/* ------------------- files kept with a maintenance record -------------------
   The contractor's quotation, the supplier's invoice, a photo of the failed
   part. Same shape as a filed transfer form: the object goes up under the
   caller's own folder, then the metadata row is what decides who may read it
   back. `name` is what the register calls the file, which is not what the
   phone called it.
   ------------------------------------------------------------------------ */

export async function saveMaintenanceAttachment(recordId, file, { name = '', note = '' } = {}) {
  const client = db()
  const user = resultData(await client.auth.getUser(), 'Could not verify who is filing the file').user
  if (!user) throw new Error('You must be signed in to attach a file.')
  const path = `${user.id}/${recordId}/${crypto.randomUUID()}-${safeFilename(file.name)}`
  resultData(await client.storage.from(MAINT_BUCKET).upload(path, file, { contentType: file.type, upsert: false }), `Could not upload ${file.name}`)
  const metadata = await client.from('maintenance_record_attachments').insert({
    record_id: recordId, storage_bucket: MAINT_BUCKET, storage_object_path: path,
    original_filename: String(name || '').trim() || file.name,
    mime_type: file.type || 'application/octet-stream', size_bytes: file.size, note: optional(note),
  }).select(COLUMNS.maintenanceAttachments).single()
  if (metadata.error) {
    /* the row is what makes the object readable, so an orphan is worse than none */
    await client.storage.from(MAINT_BUCKET).remove([path])
    resultData(metadata, `Could not file ${file.name}`)
  }
  return maintenanceAttachmentFromRow(metadata.data)
}

/* Correcting the name later changes only the label. The stored object keeps
   its path, so nothing has to be moved. */
export async function renameMaintenanceAttachment(id, name) {
  const clean = String(name || '').trim()
  if (!clean) throw new Error('The file needs a name.')
  return maintenanceAttachmentFromRow(resultData(
    await db().from('maintenance_record_attachments').update({ original_filename: clean }).eq('id', id).is('removed_at', null).select(COLUMNS.maintenanceAttachments).single(),
    'Could not rename the file',
  ))
}

export async function removeMaintenanceAttachment(attachment) {
  const client = db()
  resultData(await client.from('maintenance_record_attachments').update({ removed_at: new Date().toISOString() }).eq('id', attachment.id).is('removed_at', null).select('id').single(), 'Could not remove the file')
  const removal = await client.storage.from(attachment.bucket || MAINT_BUCKET).remove([attachment.path])
  if (removal.error) throw new Error(`The file was removed but its stored copy needs cleanup: ${removal.error.message}`)
}

export async function getMaintenanceAttachmentUrl(attachment) {
  return resultData(await db().storage.from(attachment.bucket || MAINT_BUCKET).createSignedUrl(attachment.path, 120), 'Could not open the file').signedUrl
}

export async function getReceiptUrl(receipt) {
  return resultData(await db().storage.from(receipt.bucket || RECEIPT_BUCKET).createSignedUrl(receipt.path, 120), 'Could not open receipt').signedUrl
}

export const operationalMapping = Object.freeze({ assets: 'assets', transfers: 'asset_transfers', custody: 'asset_transfers + assets', repairs: 'repair_tickets', parts: 'repair_parts', purchasing: 'repair_parts + repair_part_receipts', maintenance: 'maintenance_schedules + maintenance_completions', companies: 'companies', assetGroups: 'asset_categories', projects: 'project_locations', activity: 'asset_activity', audit: 'asset_audit_log', receipts: 'storage:asset-receipts', companyLogos: 'storage:company-logos', assetPhotos: 'asset_images + storage:asset-photos', transferForms: 'asset_transfer_attachments + storage:transfer-forms', assetDocuments: 'asset_attachments + storage:asset-documents', maintenanceHistory: 'maintenance_records', maintenanceAttachments: 'maintenance_record_attachments + storage:maintenance-attachments' })
