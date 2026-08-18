import {
  createAsset,
  createCategory,
  createCompany,
  createMaintenanceSchedule,
  createProject,
  createRepair,
  createRepairPart,
  completeMaintenance,
  loadOperationalData,
  retireAsset,
  saveReceipt,
  transferAsset,
  updateRepair,
} from './assetManagementService.js'

const DATABASE_NAME = 'asset-management-system'
const STORE_NAME = 'key-value'
const REGISTER_KEY = 'asset-register-v1'

const normalized = (value) => String(value || '').trim().toLowerCase()

function readIndexedDbKey(key) {
  if (!('indexedDB' in window)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => resolve(null)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) { database.close(); resolve(null); return }
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const getRequest = transaction.objectStore(STORE_NAME).get(key)
      getRequest.onerror = () => { database.close(); resolve(null) }
      getRequest.onsuccess = () => { const value = getRequest.result; database.close(); resolve(value ?? null) }
    }
  })
}

async function readLegacyKey(key) {
  const indexed = await readIndexedDbKey(key)
  if (indexed !== null) return { source: 'IndexedDB', value: indexed }
  const local = window.localStorage.getItem(key)
  return local === null ? null : { source: 'localStorage', value: local }
}

function normalizeSnapshot(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (Array.isArray(parsed)) return { assets: parsed, repairs: [], plans: [], companies: [], categories: [], projects: [], receipts: {} }
  if (!parsed || typeof parsed !== 'object') throw new Error('The legacy register is not a valid object or asset array.')
  return {
    assets: Array.isArray(parsed.assets) ? parsed.assets : [],
    repairs: Array.isArray(parsed.repairs) ? parsed.repairs : [],
    plans: Array.isArray(parsed.plans) ? parsed.plans : [],
    companies: Array.isArray(parsed.companies) ? parsed.companies : [],
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    receipts: parsed.receipts && typeof parsed.receipts === 'object' ? parsed.receipts : {},
  }
}

export async function discoverLegacyBrowserData() {
  const record = await readLegacyKey(REGISTER_KEY)
  if (!record?.value) return null
  try {
    const snapshot = normalizeSnapshot(record.value)
    const receiptIds = snapshot.repairs.flatMap((repair) => (repair.parts || []).map((part) => part.receipt?.id).filter(Boolean))
    const receipts = { ...snapshot.receipts }
    for (const id of receiptIds) {
      if (receipts[id]) continue
      const receipt = await readLegacyKey(`receipt:${id}`)
      if (receipt?.value) receipts[id] = receipt.value
    }
    return { source: record.source, snapshot: { ...snapshot, receipts }, counts: { assets: snapshot.assets.length, repairs: snapshot.repairs.length, parts: snapshot.repairs.reduce((total, repair) => total + (repair.parts || []).length, 0), maintenance: snapshot.plans.length, receipts: Object.keys(receipts).length } }
  } catch (error) {
    return { source: record.source, error: error.message }
  }
}

export function parseLegacyBackup(text) {
  return normalizeSnapshot(text)
}

function dataUrlToFile(dataUrl, meta) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;base64)?,(.*)$/)
  if (!match) throw new Error(`Receipt ${meta?.name || meta?.id || ''} is not a supported data URL.`)
  const mime = match[1] || meta?.type || 'application/octet-stream'
  const binary = dataUrl.includes(';base64,') ? atob(match[2]) : decodeURIComponent(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], meta?.name || 'legacy-receipt', { type: mime })
}

const emptyStats = () => ({
  companies: { imported: 0, skipped: 0 }, categories: { imported: 0, skipped: 0 }, projects: { imported: 0, skipped: 0 },
  assets: { imported: 0, skipped: 0 }, transfers: { imported: 0, skipped: 0 }, repairs: { imported: 0, skipped: 0 },
  parts: { imported: 0, skipped: 0 }, receipts: { imported: 0, skipped: 0 }, maintenance: { imported: 0, skipped: 0 }, completions: { imported: 0, skipped: 0 },
})

export async function importLegacySnapshot(input) {
  const snapshot = normalizeSnapshot(input)
  const stats = emptyStats()
  const rejected = []
  let current = await loadOperationalData()

  const ensureMaster = async (items, existing, nameOf, create, statKey) => {
    for (const item of items) {
      const name = nameOf(item)
      if (!name) { rejected.push({ workflow: statKey, legacyId: item?.id, reason: 'Missing required name/code.' }); continue }
      if (existing.some((row) => normalized(nameOf(row)) === normalized(name))) { stats[statKey].skipped += 1; continue }
      try { const created = await create(item); existing.push({ ...item, id: created.id }); stats[statKey].imported += 1 }
      catch (error) { rejected.push({ workflow: statKey, legacyId: item?.id, reason: error.message }) }
    }
  }

  const companyInputs = [...snapshot.companies]
  snapshot.assets.forEach((asset) => { if (asset.company && !companyInputs.some((item) => normalized(item.name) === normalized(asset.company))) companyInputs.push({ name: asset.company }) })
  const categoryInputs = [...snapshot.categories]
  snapshot.assets.forEach((asset) => { if (asset.category && !categoryInputs.some((item) => normalized(item.name) === normalized(asset.category))) categoryInputs.push({ name: asset.category }) })
  await ensureMaster(companyInputs, current.companies, (item) => item.name, createCompany, 'companies')
  await ensureMaster(categoryInputs, current.categories, (item) => item.name, createCategory, 'categories')
  await ensureMaster(snapshot.projects, current.projects, (item) => item.pid, createProject, 'projects')
  current = await loadOperationalData()

  const assetIdMap = new Map()
  for (const legacy of snapshot.assets) {
    const existing = current.assets.find((asset) => normalized(asset.tag) === normalized(legacy.tag))
    if (existing) { assetIdMap.set(legacy.id, existing.id); stats.assets.skipped += 1; continue }
    const company = current.companies.find((item) => normalized(item.name) === normalized(legacy.company))
    const category = current.categories.find((item) => normalized(item.name) === normalized(legacy.category))
    const project = current.projects.find((item) => normalized(item.pid) === normalized(legacy.project))
    try {
      const created = await createAsset({ ...legacy, companyId: company?.id || null, categoryId: category?.id || null, projectId: project?.id || null, location: legacy.location || 'Unassigned', custodian: legacy.custodian || 'Unassigned', name: legacy.name || legacy.tag || 'Legacy asset', tag: legacy.tag || `LEGACY-${legacy.id}` })
      assetIdMap.set(legacy.id, created.id)
      stats.assets.imported += 1
      let moving = { ...legacy, id: created.id, projectId: project?.id || null }
      const transfers = (legacy.history || []).filter((entry) => entry.kind === 'transfer' && entry.move)
      for (const entry of transfers) {
        const toProject = current.projects.find((item) => normalized(item.pid) === normalized(entry.move.project))
        try {
          await transferAsset(moving, { projectId: toProject?.id || null, location: entry.move.toLoc || moving.location, custodian: entry.move.toPer || moving.custodian, date: entry.date, reason: entry.move.why || entry.sub })
          moving = { ...moving, projectId: toProject?.id || null, location: entry.move.toLoc || moving.location, custodian: entry.move.toPer || moving.custodian }
          stats.transfers.imported += 1
        } catch (error) { rejected.push({ workflow: 'transfers', legacyId: entry.id || legacy.id, reason: error.message }) }
      }
    } catch (error) { rejected.push({ workflow: 'assets', legacyId: legacy.id, reason: error.message }) }
  }

  current = await loadOperationalData()
  const partIdMap = new Map()
  for (const legacy of snapshot.repairs) {
    const assetId = assetIdMap.get(legacy.assetId) || current.assets.find((asset) => normalized(asset.tag) === normalized(snapshot.assets.find((item) => item.id === legacy.assetId)?.tag))?.id
    if (!assetId) { rejected.push({ workflow: 'repairs', legacyId: legacy.id, reason: 'Parent asset was not imported.' }); continue }
    if (current.repairs.some((repair) => normalized(repair.ticket) === normalized(legacy.ticket))) { stats.repairs.skipped += 1; continue }
    try {
      const created = await createRepair(assetId, { ...legacy, location: legacy.holdAddress || current.assets.find((asset) => asset.id === assetId)?.location, ticket: legacy.ticket })
      stats.repairs.imported += 1
      for (const part of legacy.parts || []) {
        try { const createdPart = await createRepairPart(created.id, part); partIdMap.set(part.id, createdPart.id); stats.parts.imported += 1 }
        catch (error) { rejected.push({ workflow: 'parts', legacyId: part.id, reason: error.message }) }
      }
      const target = legacy.closed ? 'closed' : legacy.stage
      const basePatch = { technician_name: optionalValue(legacy.technician), service_provider: optionalValue(legacy.provider), work_done: optionalValue(legacy.work), labor_cost: Number(legacy.labor) || 0, other_cost: Number(legacy.other) || 0 }
      if (['ongoing', 'testing', 'closed'].includes(target)) await updateRepair(created.id, { ...basePatch, stage: 'ongoing', started_on: legacy.startedOn || legacy.date })
      if (target === 'parts') await updateRepair(created.id, { stage: 'parts' })
      if (target === 'testing') await updateRepair(created.id, { ...basePatch, stage: 'testing', repair_completed_on: legacy.repairCompletedOn || legacy.closedOn || legacy.date })
      if (target === 'closed') {
        const asset = snapshot.assets.find((item) => item.id === legacy.assetId) || {}
        const retired = legacy.outcome === 'retired' || (asset.status === 'retired' && legacy === snapshot.repairs.filter((item) => item.assetId === legacy.assetId).at(-1))
        await updateRepair(created.id, retired
          ? { ...basePatch, stage: 'closed', outcome: 'retired', closed_on: legacy.closedOn || legacy.date, closure_reason: legacy.closureReason || 'Imported legacy retirement' }
          : { ...basePatch, stage: 'closed', outcome: 'returned_to_service', closed_on: legacy.closedOn || legacy.date, return_address: asset.location || 'Unassigned', returned_to_name: asset.custodian || 'Unassigned', test_result: optionalValue(legacy.testResult) })
      }
    } catch (error) { rejected.push({ workflow: 'repairs', legacyId: legacy.id, reason: error.message }) }
  }

  for (const legacy of snapshot.plans) {
    const assetId = assetIdMap.get(legacy.assetId)
    if (!assetId) { rejected.push({ workflow: 'maintenance', legacyId: legacy.id, reason: 'Parent asset was not imported.' }); continue }
    try {
      const created = await createMaintenanceSchedule(assetId, legacy)
      stats.maintenance.imported += 1
      for (const done of legacy.done || []) {
        try { await completeMaintenance(created.id, { ...done, nextDue: done.nextDue || legacy.nextDue }); stats.completions.imported += 1 }
        catch (error) { rejected.push({ workflow: 'completions', legacyId: done.id, reason: error.message }) }
      }
    } catch (error) { rejected.push({ workflow: 'maintenance', legacyId: legacy.id, reason: error.message }) }
  }

  for (const repair of snapshot.repairs) {
    for (const part of repair.parts || []) {
      const receipt = part.receipt
      const dataUrl = receipt && snapshot.receipts[receipt.id]
      const partId = partIdMap.get(part.id)
      if (!receipt || !dataUrl || !partId) continue
      try { await saveReceipt(partId, dataUrlToFile(dataUrl, receipt), { ref: part.ref, date: part.date }); stats.receipts.imported += 1 }
      catch (error) { rejected.push({ workflow: 'receipts', legacyId: receipt.id, reason: error.message }) }
    }
  }

  for (const legacy of snapshot.assets.filter((asset) => asset.status === 'retired')) {
    const id = assetIdMap.get(legacy.id)
    if (!id) continue
    try { await retireAsset(id, { date: legacy.retiredOn || new Date().toISOString().slice(0, 10), reason: legacy.retirementReason || 'Imported legacy retirement', detail: legacy.retirementDetails || '' }) }
    catch (error) { rejected.push({ workflow: 'assets', legacyId: legacy.id, reason: `Retirement state: ${error.message}` }) }
  }
  return { stats, rejected }
}

function optionalValue(value) {
  return String(value ?? '').trim() || null
}
