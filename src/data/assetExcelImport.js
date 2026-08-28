import * as XLSX from 'xlsx'

/* =========================================================================
   Asset Excel import — reading, matching and planning.

   This module never decides what an asset is. The Register Asset form owns
   that: the caller passes its field definitions in, and everything here —
   which headers are recognised, which fields are required, what counts as
   valid — is read back out of them. A second definition of an asset is
   exactly what this import must not become.

   Nothing here writes. It produces a plan the administrator can look at, and
   the caller inserts only what the plan marks ready.
   ========================================================================= */

export const ASSET_SHEET_NAME = 'Asset'

/* Headers are matched on meaning, not position: case, spacing and punctuation
   are stripped before comparing. A field's own label always matches; the lists
   below are the other things people reasonably write in that column. */
const ALIASES = {
  tag: ['assetid', 'assetno', 'assetnumber', 'assettag', 'tag', 'assetidcode', 'assetcodeid'],
  code: ['assetcode', 'qrcode', 'qrsticker', 'stickercode', 'assetcodeqrsticker'],
  company: ['company', 'companyname', 'owningcompany', 'owner'],
  name: ['assetname', 'name', 'item', 'description', 'whatisit', 'particulars'],
  category: ['category', 'assetcategory', 'assetgroup', 'group', 'type', 'assettype'],
  brand: ['brand', 'make', 'manufacturer', 'manufacturing', 'brandmanufacturer', 'brandmake'],
  model: ['model', 'modelno', 'modelnumber', 'modelname', 'modelvariant'],
  serial: ['serial', 'serialno', 'serialnumber', 'chassis', 'chassisno', 'chassisnumber', 'serialchassisnumber', 'serialorchassis', 'serialchassis'],
  engine: ['engine', 'engineno', 'enginenumber'],
  plate: ['plate', 'plateno', 'platenumber', 'platenumberno'],
  mvFile: ['mvfile', 'mvfileno', 'mvfilenumber'],
  conduction: ['conduction', 'conductionsticker', 'conductionstickerno'],
  body: ['body', 'bodyno', 'bodynumber'],
  project: ['project', 'projectid', 'projectlocation', 'projectsite', 'site'],
  location: ['address', 'location', 'currentaddress', 'assetlocation', 'where'],
  custodian: ['custodian', 'responsibleperson', 'assignedto', 'personincharge', 'holder'],
  acquired: ['acquired', 'dateacquired', 'acquireddate', 'acquisitiondate', 'datepurchased', 'purchasedate'],
  cost: ['cost', 'acquisitioncost', 'purchasecost', 'value', 'amount', 'price'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments'],
}

export const normalizeHeader = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const normalizeKey = (value) => String(value ?? '').trim().toLowerCase()

/* Excel hands dates back as numbers when a cell is date-formatted; anything
   the sheet already stores as text comes through untouched. */
const cellText = (value) => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

export class AssetImportError extends Error {}

/* Reads the Asset worksheet out of a workbook. The file may be called
   anything; only the sheet name matters, and only case-insensitively. */
export function readAssetSheet(buffer) {
  let book
  try {
    book = XLSX.read(buffer, { type: 'array', cellDates: true })
  } catch {
    throw new AssetImportError('That file could not be read. Save it as .xlsx, .xls or .csv and try again.')
  }
  const name = book.SheetNames.find((sheet) => normalizeHeader(sheet) === normalizeHeader(ASSET_SHEET_NAME))
  if (!name) {
    const found = book.SheetNames.length ? ` This workbook has: ${book.SheetNames.join(', ')}.` : ''
    throw new AssetImportError(`Asset sheet not found. Please add a worksheet named "Asset" and try again.${found}`)
  }
  const grid = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, blankrows: false, defval: '' })
  const headerRow = grid.findIndex((row) => row.some((cell) => cellText(cell) !== ''))
  if (headerRow === -1) throw new AssetImportError('The Asset sheet is empty. The first row should carry the column headings.')
  return {
    sheetName: name,
    headers: grid[headerRow].map(cellText),
    /* excelRow is what the spreadsheet calls this line, so a report can send
       someone straight back to it */
    rows: grid.slice(headerRow + 1)
      .map((cells, index) => ({ excelRow: headerRow + 2 + index, cells }))
      .filter((row) => row.cells.some((cell) => cellText(cell) !== '')),
  }
}

/* Which column feeds which Register Asset field. Anything left over is
   reported rather than treated as a failure. */
export function matchHeaders(headers, fields) {
  const wanted = new Map()
  fields.forEach((field) => {
    wanted.set(normalizeHeader(field.label), field.key)
    wanted.set(normalizeHeader(field.key), field.key)
    ;(ALIASES[field.key] || []).forEach((alias) => { if (!wanted.has(alias)) wanted.set(alias, field.key) })
  })

  const columns = {}
  const unrecognized = []
  headers.forEach((header, index) => {
    const text = cellText(header)
    if (!text) return
    const key = wanted.get(normalizeHeader(text))
    if (!key) return unrecognized.push(text)
    if (!(key in columns)) columns[key] = index
  })
  return { columns, unrecognized }
}

/* Builds the plan. Order matters: a row already on the register is reported as
   existing rather than as a validation failure, because "already there" is not
   a mistake anyone needs to fix. */
export function planAssetImport({ headers, rows, fieldsFor, ctx, validate, existing }) {
  const { columns, unrecognized } = matchHeaders(headers, fieldsFor({}, ctx, {}))

  const onRegister = new Map()
  existing.forEach((asset) => { if (asset.tag) onRegister.set(normalizeKey(asset.tag), asset) })

  /* how many times each asset number appears in the file itself */
  const seen = new Map()
  rows.forEach((row) => {
    const tag = normalizeKey(cellText(row.cells[columns.tag]))
    if (tag) seen.set(tag, (seen.get(tag) || 0) + 1)
  })

  const ready = []
  const skipped = []
  const invalid = []

  rows.forEach((row) => {
    const values = {}
    Object.entries(columns).forEach(([key, index]) => { values[key] = cellText(row.cells[index]) })
    const fields = fieldsFor({}, ctx, values)
    fields.forEach((field) => { if (!(field.key in values)) values[field.key] = '' })

    const tag = cellText(values.tag)
    const entry = { excelRow: row.excelRow, tag, name: cellText(values.name), values }

    if (!tag) {
      invalid.push({ ...entry, reason: 'No asset number. Every asset needs one to be registered.' })
      return
    }
    if (seen.get(normalizeKey(tag)) > 1) {
      invalid.push({ ...entry, reason: `Asset number "${tag}" appears more than once in this file. Give each row its own number.` })
      return
    }
    const already = onRegister.get(normalizeKey(tag))
    if (already) {
      skipped.push({ ...entry, reason: `Already on the register as "${already.name || already.tag}". Nothing was changed.` })
      return
    }
    const missing = fields.filter((field) => field.required && !cellText(values[field.key]))
    if (missing.length) {
      invalid.push({ ...entry, reason: `Missing ${missing.map((field) => field.label.toLowerCase()).join(', ')}.` })
      return
    }
    const clash = validate ? validate(values, ctx, {}) : null
    if (clash) {
      invalid.push({ ...entry, reason: String(clash).split('\n')[0] })
      return
    }
    ready.push(entry)
  })

  /* the unique fields the register enforces, checked within the file too, so a
     batch cannot fail halfway on a clash between two of its own rows */
  const uniqueKeys = Object.keys(ctx.unique || {}).filter((key) => key !== 'tag' && key in columns)
  const claimed = new Map()
  const conflicted = new Set()
  ready.forEach((entry) => {
    uniqueKeys.forEach((key) => {
      const value = normalizeKey(entry.values[key])
      if (!value) return
      const at = `${key}:${value}`
      if (claimed.has(at)) { conflicted.add(entry); conflicted.add(claimed.get(at)) }
      else claimed.set(at, entry)
    })
  })
  conflicted.forEach((entry) => {
    entry.reason = 'Another row in this file claims the same serial, plate, engine, body or asset code.'
    invalid.push(entry)
  })

  return {
    total: rows.length,
    columns,
    unrecognized,
    ready: ready.filter((entry) => !conflicted.has(entry)),
    skipped,
    invalid: invalid.sort((a, b) => a.excelRow - b.excelRow),
  }
}

/* A workbook whose only sheet is called Asset and whose header row is the
   Register Asset form itself, so the template can never drift from the form. */
export function buildTemplate(fields) {
  const sheet = XLSX.utils.aoa_to_sheet([fields.map((field) => field.label)])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, ASSET_SHEET_NAME)
  return new Blob([XLSX.write(book, { bookType: 'xlsx', type: 'array' })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
