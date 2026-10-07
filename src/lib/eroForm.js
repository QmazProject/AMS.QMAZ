/* =========================================================================
   The Equipment Repair Order, on screen, on paper and as a PDF.

   A paper copy of one historic maintenance record, laid out like the form it
   replaces (EMD.FL29.01): the company header, the ERO code and where the
   repair took place, the equipment line, the failure written up, the repair
   hours and parts table, the contracted repair and its totals, and the
   completion and sign-off row across the bottom. What the register knows is
   filled in - the equipment type, its plate or serial and body numbers come
   off the asset itself - and the rest is what was typed on the record.

   The sheet is described once, in millimetres on an A4 page, as a list of
   boxes and what is written in them. The preview and the printed page draw
   that description as absolutely positioned elements; the PDF draws the same
   description with lines and text of its own. Neither renderer decides
   anything about the layout, so the file that downloads is the page that
   prints, to the millimetre.

   It was rasterised once, through html2canvas, and that is why it no longer
   is: the capture put every line of text a little below where the browser had
   it, so words sat across the rules beneath them and long names fell out of
   their boxes. A drawn PDF has no such opinion, weighs a few kilobytes rather
   than a few hundred, and its text can still be selected and searched.
   ========================================================================= */

const escape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/* A4, the size this sheet is drawn at and printed on. The pixel pair is the
   same page at the 96dpi CSS reference, which is what the preview iframe is
   sized to so what is on screen is the page itself rather than a likeness. */
export const A4 = Object.freeze({ mm: { width: 210, height: 297 }, px: { width: 794, height: 1123 } })

/* The sheet always fills its A4 page: the parts table has as many ruled
   lines as there are parts, and the failure box takes whatever the page has
   left, so the bottom rule sits at the same place on every sheet. The bounds
   below are what keeps a crowded record inside its page. */
const CAUSE_MIN = 16
const PART_ROWS_MIN = 1
const ROW_H = 6.2
const ROW_H_MIN = 4.6

/* The page, in millimetres. Everything below is positioned against these.
   The column down the left comes in two widths: the head of the sheet - the
   logo, EQUIPMENT REPAIR ORDER and the equipment line - is as wide as its
   longest key, "EQUIPMENT REPAIR ORDER :", set on one line; from the failure
   box down, every key is the narrower column of the printed pad, so the
   tables beneath keep their full width. */
const PAGE = { left: 9, top: 8, right: 201, bottom: 289 }
const HEAD_W = 48
const HEAD_R = PAGE.left + HEAD_W
const KEY_W = 35
const KEY_R = PAGE.left + KEY_W
const RULE = 0.25
const PT = 0.3527777778
const TICK = 3.4
/* The labor amount and the remarks are written in red on the sheet when
   somebody has filled them in, so they stand out from the printed keys. One
   value, given as a CSS colour and as the same RGB for the PDF. */
const RED = { css: "#cc0000", rgb: [204, 0, 0] }

/* "August 29, 2026" from a yyyy-mm-dd date, or the text as typed when it is
   not one, so a hand-written date is never silently blanked */
export const longDate = (value) => {
  if (!value) return ""
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

/* How long a job ran, for the label beside its finish or completion date:
   whole months, or days while it is under a month. Empty when either date is
   missing or the end comes before the start. */
export const durationBetween = (from, to) => {
  if (!from || !to) return ""
  const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return ""
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) months -= 1
  if (months >= 1) return `${months} month${months === 1 ? "" : "s"}`
  const days = Math.round((b - a) / 864e5)
  return `${days} day${days === 1 ? "" : "s"}`
}

const withDuration = (start, date) => {
  if (!date) return ""
  const span = durationBetween(start, date)
  return `${longDate(date).toUpperCase()}${span ? ` (${span.toUpperCase()})` : ""}`
}

const money = (value) => {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value ?? "")
}
const count = (value) => {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(value ?? "")
}
const filled = (value) => value !== "" && value !== null && value !== undefined

/* What the paper calls the equipment: its type is the asset's name; SN/PN is
   the plate number when it has one, else the serial; I.D/BD is the body
   number. Read off the asset, never typed on the record. */
export const eroEquipment = (asset = {}) => ({
  type: asset.name || asset.tag || "",
  snPn: asset.plate || asset.serial || "",
  idBd: asset.body || "",
})

/* ------------------------------------------------------------------ *
   How wide a word is.

   Helvetica's own character widths, per 1000 of an em, which Arial shares
   and which is what both the browser and the PDF set this sheet in. Having
   them here means the fitting below - what wraps, what is set smaller so it
   stays inside its rule - is decided once, in the description, rather than
   twice and differently by each renderer.
 * ------------------------------------------------------------------ */
const W_REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]
const charWidth = (code, bold) => {
  const table = bold ? W_BOLD : W_REGULAR
  return code >= 32 && code <= 126 ? table[code - 32] : (bold ? 611 : 556)
}
/* a string's width in millimetres at a point size */
const widthOf = (text, size, bold) => {
  let units = 0
  const value = String(text ?? "")
  for (let index = 0; index < value.length; index += 1) units += charWidth(value.charCodeAt(index), bold)
  return (units / 1000) * size * PT
}
/* greedy wrap, on spaces, to a width in millimetres */
const wrapTo = (text, room, size, bold) => {
  const words = String(text).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out = []
  let line = words[0]
  for (let index = 1; index < words.length; index += 1) {
    const next = `${line} ${words[index]}`
    if (widthOf(next, size, bold) <= room) line = next
    else { out.push(line); line = words[index] }
  }
  out.push(line)
  return out
}

/* ------------------------------------------------------------------ *
   What each box actually says, and where.

   Every line comes out with its own size and its own offset down the box, so
   the two renderers place them identically rather than each making its own
   arrangement. A line too long for its box is set smaller, down to a floor;
   a box that may wrap is broken on spaces first.
 * ------------------------------------------------------------------ */
const fitCell = (box) => {
  const pad = box.pad ?? 1.2
  const room = box.w - pad * 2
  const size = box.size || 9
  const leading = box.leading || 1.2
  const lines = []

  const fit = (text, wanted, bold) => {
    let at = wanted
    while (at > 4.5 && widthOf(text, at, bold) > room) at -= 0.25
    return at
  }

  if (box.label) lines.push({ text: box.label, size: fit(box.label, box.labelSize || 8, box.labelBold), bold: !!box.labelBold, align: box.labelAlign || "left" })
  ;(box.lines || []).filter((line) => String(line ?? "") !== "").forEach((line) => {
    const text = String(line)
    if (box.wrap && widthOf(text, size, box.bold) > room) {
      const parts = wrapTo(text, room, size, box.bold)
      /* still too wide once broken - a single long word - so it shrinks */
      parts.forEach((part) => lines.push({ text: part, size: box.shrink ? fit(part, size, box.bold) : size, bold: box.bold }))
    } else {
      lines.push({ text, size: box.shrink ? fit(text, size, box.bold) : size, bold: box.bold })
    }
  })

  if (box.labelTab && box.label && lines.length > 1) {
    /* "Date :" and what was entered share one open cell, as on the paper:
       the value sits at a tab stop, or just clear of the label when that
       runs past it, and nothing is ruled between them */
    const [label, ...rest] = lines
    const value = rest.map((line) => line.text).join(" ").trim()
    const dx = Math.max(box.labelTab, pad + widthOf(label.text, label.size, label.bold) + 2)
    let valueSize = size
    while (valueSize > 4.5 && dx + widthOf(value, valueSize, box.bold) > box.w - pad) valueSize -= 0.25
    lines.length = 0
    lines.push({ ...label, dx: pad })
    lines.push({ text: value, size: valueSize, bold: box.bold, dx, sameRow: true })
  } else if (box.inlineLabel && lines.length > 1) {
    /* "Vendor : NAME" reads as one line on the paper */
    const joined = lines.map((line) => line.text).join(" ").trim()
    lines.length = 0
    lines.push({ text: joined, size: fit(joined, size, box.bold), bold: box.bold })
  }

  if (box.footer) {
    const footerSize = fit(box.footer, box.footerSize || 8, true)
    lines.push({ text: box.footer, size: footerSize, bold: true, align: "center", gap: 1.6 })
  }

  const height = lines.reduce((sum, line) => (line.sameRow ? sum : sum + (line.gap || 0) + line.size * PT * leading), 0)
  const edge = Math.min(pad, 1.6)
  let cursor = box.valign === "top" ? edge
    : box.valign === "bottom" ? box.h - edge - height
    : (box.h - height) / 2
  const placed = []
  lines.forEach((line) => {
    const previous = placed[placed.length - 1]
    if (line.sameRow && previous) {
      placed.push({ ...line, align: "left", y: previous.y, step: previous.step })
      return
    }
    cursor += line.gap || 0
    const step = line.size * PT * leading
    placed.push({ ...line, align: line.align || box.align || "left", y: cursor + step / 2, step })
    cursor += step
  })
  return placed
}

/* where the check box sits inside a cell that carries one */
const tickBox = (box) => ({ x: box.x + box.w / 2 + (box.tickGap || 5), y: box.y + (box.h - TICK) / 2 })

/* ------------------------------------------------------------------ *
   The sheet, described once.

   Every box states where it is and what is written in it. The rules come
   from the boxes themselves: each edge is collected and the duplicates
   dropped, so a border two boxes share is one line, drawn once, in both
   renderers.
 * ------------------------------------------------------------------ */
function eroSheetSpec({ company = {}, asset = {}, record = {} }) {
  const equipment = eroEquipment(asset)
  const cells = []
  const cell = (x, y, w, h, options = {}) => { cells.push({ x, y, w, h, ...options }) }

  /* --- the header: the mark down the left, the company across the top --- */
  let y = PAGE.top
  const headH = 21, headRow = headH / 3
  cell(PAGE.left, y, HEAD_W, headH, { logo: company.logoUrl || "" })
  cell(HEAD_R, y, PAGE.right - HEAD_R, headRow, { lines: [(company.name || "").toUpperCase()], size: 13, bold: true, align: "center" })
  cell(HEAD_R, y + headRow, PAGE.right - HEAD_R, headRow, { label: "Department:", lines: [(company.department || "Maintenance").toUpperCase()], size: 10.5, bold: true, align: "center" })
  cell(HEAD_R, y + headRow * 2, PAGE.right - HEAD_R, headRow, { label: "Document Title:", lines: ["Equipment Repair Order"], size: 10.5, bold: true, align: "center" })
  y += headH

  /* --- the order: its code, where it was repaired, when, and by whom --- */
  const eroH = 28, eroRow = eroH / 4
  const labelW = 24, valueX = HEAD_R + labelW
  cell(PAGE.left, y, HEAD_W, eroH, { lines: ["EQUIPMENT REPAIR ORDER :"], size: 8.5, bold: true, pad: 2, shrink: true })
  cell(HEAD_R, y, labelW, eroRow, { lines: ["ERO CODE"], size: 6.5, bold: true, pad: 1.6 })
  cell(valueX, y, 66, eroRow, { lines: [String(record.eroCode || "")], size: 13, bold: true, align: "center" })
  cell(valueX + 66, y, PAGE.right - valueX - 66, eroRow, {})

  const placeText = String(record.repairPlace || "").trim()
  const placeNorm = placeText.toLowerCase()
  const isField = /field/.test(placeNorm), isYard = /yard/.test(placeNorm), isContracted = /contract|outside/.test(placeNorm)
  const placeOther = placeText && !isField && !isYard && !isContracted ? placeText : ""
  const tickRow = y + eroRow
  cell(HEAD_R, tickRow, labelW, eroRow, { lines: ["CODE"], size: 8.5, bold: true, align: "center" })
  cell(valueX, tickRow, 25, eroRow, { lines: ["Field"], size: 8.5, align: "center", tick: isField, tickGap: 4 })
  cell(valueX + 25, tickRow, 25, eroRow, { lines: ["Yard"], size: 8.5, align: "center", tick: isYard, tickGap: 4 })
  /* the words sit against the left rule so the box after them stays clear
     of the right one */
  cell(valueX + 50, tickRow, 38, eroRow, { lines: ["CONTRACTED OUTSIDE"], size: 7, pad: 1.6, tick: isContracted, tickGap: 13 })
  cell(valueX + 88, tickRow, PAGE.right - valueX - 88, eroRow, {
    lines: [...(placeOther ? [placeOther.toUpperCase()] : []), "Put a check mark where", "the repair took place"],
    size: 7, bold: true, align: "center",
  })

  cell(HEAD_R, y + eroRow * 2, PAGE.right - HEAD_R, eroRow, {
    label: "Date :", labelSize: 9, labelBold: true, labelTab: labelW,
    lines: [longDate(record.startedOn)], size: 9.5, bold: true, pad: 2,
  })
  cell(HEAD_R, y + eroRow * 3, PAGE.right - HEAD_R, eroRow, {
    label: "Assigned to :", labelSize: 9, labelBold: true, labelTab: labelW,
    lines: [(record.assignedTo || "").toUpperCase()], size: 9.5, bold: true, pad: 2,
  })
  y += eroH

  /* --- the equipment, read off the asset --- */
  const equipHeadH = 6, equipValueH = 8
  const equipCols = [HEAD_W, 28, 28, 46, 42]
  const equipHead = ["EQUIPMENT TYPE :", "SN / PN", "I.D / BD", "MILEAGE / HOURS", "LOCATION"]
  const equipValue = [equipment.type, equipment.snPn, equipment.idBd, record.mileageHours || "", (record.location || asset.location || "").toUpperCase()]
  let x = PAGE.left
  equipCols.forEach((w, index) => {
    cell(x, y, w, equipHeadH, { lines: [equipHead[index]], size: 8, bold: true, align: "center", shrink: true })
    cell(x, y + equipHeadH, w, equipValueH, { lines: [equipValue[index]], size: 9, bold: true, align: "center", wrap: true })
    x += w
  })
  y += equipHeadH + equipValueH

  /* --- what went wrong, in the writer's own words --- */
  const causeText = String(record.failureCause || "").toUpperCase().split("\n")
  const causeW = PAGE.right - KEY_R, causePad = 2, causeLead = 1.5
  const causeRoom = causeW - causePad * 2
  /* every line the failure runs to at a given size */
  const causeAt = (size) => causeText.flatMap((line) => {
    const parts = wrapTo(line, causeRoom, size, true)
    return parts.length ? parts : [""]
  })
  const lines = (record.parts || []).filter((line) => Object.values(line || {}).some((v) => String(v ?? "").trim()))
  const rows = Math.max(lines.length, PART_ROWS_MIN)

  /* What is left of the page once the bands that cannot give are placed. The
     failure box is the one band that stretches: it takes every millimetre
     the fixed bands and the parts rows leave, so the table always runs to
     the bottom rule of the A4 sheet rather than stopping wherever the record
     happens to end. When the record is too crowded for that, the ruled lines
     tighten first, since they are mostly white, and the failure's words are
     set smaller if even that is not enough for them. */
  const headA = 5, headB = 5, totalH = 6
  const contractH = 16, doneH = 22
  const room = PAGE.bottom - y - (headA + headB + totalH + contractH + doneH)
  let causeSize = 9
  const causeNeeded = Math.max(CAUSE_MIN, causeAt(causeSize).length * causeSize * PT * causeLead + causePad * 2)
  let rowH = ROW_H
  let causeH = room - rows * rowH
  if (causeH < causeNeeded) {
    rowH = Math.max(ROW_H_MIN, (room - causeNeeded) / rows)
    causeH = Math.max(CAUSE_MIN, Math.min(causeNeeded, room - rows * rowH))
  }
  let causeLines = causeAt(causeSize)
  while (causeSize > 5.5 && causeLines.length * causeSize * PT * causeLead > causeH - causePad * 2) {
    causeSize -= 0.25
    causeLines = causeAt(causeSize)
  }
  /* a description longer than any page could hold stops at the rule rather
     than running over the table below it */
  const causeFits = Math.max(1, Math.floor((causeH - causePad * 2) / (causeSize * PT * causeLead)))
  if (causeLines.length > causeFits) causeLines = [...causeLines.slice(0, causeFits - 1), `${causeLines[causeFits - 1]} …`]

  cell(PAGE.left, y, KEY_W, causeH, { lines: ["Describe failure ,", "cause :"], size: 9, bold: true, valign: "top", pad: 2 })
  cell(KEY_R, y, causeW, causeH, {
    lines: causeLines, size: causeSize, bold: true, valign: "top", pad: causePad, leading: causeLead,
  })
  y += causeH

  /* --- who repaired it, for how long, and what it took --- */
  const partCols = [KEY_W, 16, 16, 14, 26, 44, 20, 21]
  const partX = []
  partCols.reduce((at, w) => { partX.push(at); return at + w }, PAGE.left)
  const at = (index) => partX[index]
  cell(at(0), y, partCols[0], headA, { lines: ["REPAIRED BY"], size: 8.5, bold: true, align: "center" })
  cell(at(1), y, partCols[1], headA, { lines: ["REPAIR"], size: 8.5, bold: true, align: "center" })
  cell(at(2), y, partCols[2], headA, { lines: ["P.M."], size: 8.5, bold: true, align: "center" })
  cell(at(3), y, partCols.slice(3).reduce((a, b) => a + b, 0), headA, { lines: ["PARTS & SUPPLIES"], size: 8.5, bold: true, align: "center" })
  const headBy = y + headA
  const subHead = ["NAME :", "HOURS", "HOURS", "QTY.", "PARTS #", "DESCRIPTION", "UNIT COST", "AMOUNT"]
  subHead.forEach((text, index) => {
    cell(at(index), headBy, partCols[index], headB, { lines: [text], size: 8, bold: true, align: index === 0 ? "left" : "center", pad: 1.6 })
  })

  const bodyY = headBy + headB
  const bodyH = rows * rowH
  for (let index = 0; index < rows; index += 1) {
    const line = lines[index] || {}
    const rowY = bodyY + index * rowH
    /* who repaired it and the hours are written on the first line, but every
       line is ruled across all three columns: they are part of the same
       table as the parts beside them */
    cell(at(0), rowY, partCols[0], rowH, { lines: [index === 0 ? record.repairedBy || "" : ""], size: 8.5, bold: true, pad: 2, shrink: true })
    cell(at(1), rowY, partCols[1], rowH, { lines: [index === 0 ? record.repairHours || "" : ""], size: 8.5, bold: true, align: "center" })
    cell(at(2), rowY, partCols[2], rowH, { lines: [index === 0 ? record.pmHours || "" : ""], size: 8.5, bold: true, align: "center" })
    cell(at(3), rowY, partCols[3], rowH, { lines: [line.qty ? count(line.qty) : ""], size: 8, align: "center" })
    cell(at(4), rowY, partCols[4], rowH, { lines: [line.partNo || ""], size: 8, align: "center", shrink: true })
    cell(at(5), rowY, partCols[5], rowH, { lines: [line.description || ""], size: 8, align: "center", shrink: true })
    cell(at(6), rowY, partCols[6], rowH, { lines: [line.unitCost ? money(line.unitCost) : ""], size: 8, align: "right", pad: 1.6 })
    cell(at(7), rowY, partCols[7], rowH, { lines: [line.amount ? money(line.amount) : ""], size: 8, align: "right", pad: 1.6 })
  }
  const totalY = bodyY + bodyH
  const totalQty = lines.reduce((sum, line) => sum + (Number.parseFloat(line.qty) || 0), 0)
  cell(at(0), totalY, partCols[0], totalH, { lines: ["TOTAL HOURS :"], size: 8.5, bold: true, pad: 2 })
  /* the totals sit centred under HOURS, HOURS and QTY., as those headings do */
  cell(at(1), totalY, partCols[1], totalH, { lines: [record.repairHours || "0"], size: 8.5, bold: true, align: "center" })
  cell(at(2), totalY, partCols[2], totalH, { lines: [record.pmHours || "0"], size: 8.5, bold: true, align: "center" })
  cell(at(3), totalY, partCols[3], totalH, { lines: [lines.length ? count(totalQty) : ""], size: 8.5, bold: true, align: "center" })
  cell(at(4), totalY, partCols.slice(4).reduce((a, b) => a + b, 0), totalH, {})
  y = totalY + totalH

  /* the sign-off columns across the bottom; the contracted repair's PARTS and
     LABOR columns share their rules with DEPARTMENT HEAD and REMARKS beneath,
     so the two bands read as one grid */
  const doneCols = [26, 30, 28, 26, 26, 21]
  const doneX = []
  doneCols.reduce((at, w) => { doneX.push(at); return at + w }, KEY_R)

  /* --- the contracted repair, and what it came to --- */
  const contractRow = 8
  const cx = [KEY_R, KEY_R + 52, doneX[4], doneX[5]]
  const cw = [cx[1] - cx[0], cx[2] - cx[1], cx[3] - cx[2], PAGE.right - cx[3]]
  cell(PAGE.left, y, KEY_W, contractRow * 2, { lines: ["Contracted Repairs :"], size: 8.5, bold: true, pad: 2, shrink: true })
  cell(cx[0], y, cw[0], contractRow, { label: "Vendor :", lines: [(record.vendor || "").toUpperCase()], size: 8.5, bold: true, pad: 2, inlineLabel: true, shrink: true })
  cell(cx[1], y, cw[1], contractRow, { lines: ["DATE"], size: 8.5, bold: true, align: "center" })
  cell(cx[2], y, cw[2], contractRow, { lines: ["PARTS"], size: 8.5, bold: true, align: "center" })
  cell(cx[3], y, cw[3], contractRow, { lines: ["LABOR"], size: 8.5, bold: true, align: "center" })
  cell(cx[0], y + contractRow, cw[0], contractRow, { label: "Address :", lines: [(record.vendorAddress || "").toUpperCase()], size: 8.5, bold: true, pad: 2, inlineLabel: true, shrink: true })
  cell(cx[1], y + contractRow, cw[1], contractRow, { lines: [withDuration(record.startedOn, record.finishedOn)], size: 8.5, bold: true, align: "center", shrink: true })
  cell(cx[2], y + contractRow, cw[2], contractRow, { lines: [filled(record.partsTotal) ? `PHP ${money(record.partsTotal)}` : ""], size: 8.5, bold: true, align: "center", shrink: true })
  cell(cx[3], y + contractRow, cw[3], contractRow, { lines: [filled(record.laborTotal) ? money(record.laborTotal) : ""], size: 8.5, bold: true, align: "center", shrink: true, color: RED })
  y += contractRow * 2

  /* --- when it was finished, and who signed it off --- */
  const doneHead = 12, doneValue = 10
  const doneHeads = [["IDLE TIME/", "DOWNTIME"], ["MECHANIC OPER.", "SIGNATURE"], ["ASSISTANT", "SUPERVISOR"], ["SUPERVISOR"], ["DEPARTMENT HEAD/", "GENERAL MANAGER"], ["REMARKS"]]
  const doneValues = [record.downtime || "", (record.mechanicOperator || "").toUpperCase(), (record.assistantSupervisor || "").toUpperCase(),
    (record.supervisor || "").toUpperCase(), (record.departmentHead || "").toUpperCase(), record.remarks || ""]
  /* the label and the date it completed read as one cell, with no rule
     drawn between them */
  cell(PAGE.left, y, KEY_W, doneHead + doneValue, {
    lines: ["Date Completed :"], size: 9, bold: true, valign: "top", pad: 2,
    footer: withDuration(record.startedOn, record.completedOn), footerSize: 7.5, shrinkFooter: true,
  })
  x = KEY_R
  doneCols.forEach((w, index) => {
    cell(x, y, w, doneHead, { lines: doneHeads[index], size: 7.5, bold: true, align: "center", shrink: true })
    cell(x, y + doneHead, w, doneValue, { lines: [doneValues[index]], size: 8, bold: true, align: "center", wrap: true, shrink: true, color: index === doneCols.length - 1 ? RED : undefined })
    x += w
  })
  y += doneHead + doneValue

  /* the rules: every edge of every box, each drawn once */
  const seen = new Set()
  const segments = []
  const add = (x1, y1, x2, y2) => {
    const id = [x1, y1, x2, y2].map((n) => n.toFixed(2)).join(":")
    if (seen.has(id)) return
    seen.add(id)
    segments.push({ x1, y1, x2, y2 })
  }
  cells.forEach((box) => { box.render = box.logo !== undefined ? [] : fitCell(box) })
  cells.forEach((box) => {
    add(box.x, box.y, box.x + box.w, box.y)
    add(box.x, box.y + box.h, box.x + box.w, box.y + box.h)
    add(box.x, box.y, box.x, box.y + box.h)
    add(box.x + box.w, box.y, box.x + box.w, box.y + box.h)
  })

  return { cells, segments, footer: "EMD.FL29.01 (05/26)", footerY: y + 1.6, bottom: y }
}

/* ------------------------------------------------------------------ *
   On screen and on paper.
 * ------------------------------------------------------------------ */
export function eroFormHtml(data) {
  const spec = eroSheetSpec(data)
  const mm = (n) => `${n.toFixed(2)}mm`
  const rules = spec.segments.map(({ x1, y1, x2, y2 }) => {
    const horizontal = Math.abs(y2 - y1) < 0.001
    const left = Math.min(x1, x2) - (horizontal ? 0 : RULE / 2)
    const top = Math.min(y1, y2) - (horizontal ? RULE / 2 : 0)
    const width = horizontal ? Math.abs(x2 - x1) : RULE
    const height = horizontal ? RULE : Math.abs(y2 - y1)
    return `<i style="left:${mm(left)};top:${mm(top)};width:${mm(width)};height:${mm(height)}"></i>`
  }).join("")

  const boxes = spec.cells.map((box) => {
    const pad = box.pad ?? 1.2
    const frame = `left:${mm(box.x)};top:${mm(box.y)};width:${mm(box.w)};height:${mm(box.h)}`
    if (box.logo !== undefined) {
      return box.logo ? `<div class="cell mark" style="${frame};padding:${mm(pad)}"><img src="${escape(box.logo)}" alt="" /></div>` : ""
    }
    const tick = box.tick !== undefined
      ? `<u style="left:${mm(tickBox(box).x - box.x)};top:${mm(tickBox(box).y - box.y)}">${box.tick ? "&#10003;" : ""}</u>`
      : ""
    const lines = box.render.map((line) => {
      const place = line.dx !== undefined ? `left:${mm(line.dx)};text-align:left`
        : line.align === "center" ? `left:0;width:100%;text-align:center`
        : line.align === "right" ? `right:${mm(pad)};text-align:right`
        : `left:${mm(pad)};text-align:left`
      return `<span style="${place};top:${mm(line.y - line.step / 2)};height:${mm(line.step)};line-height:${mm(line.step)};`
        + `font-size:${line.size}pt;font-weight:${line.bold ? 700 : 400}${box.color ? `;color:${box.color.css}` : ""}">${escape(line.text)}</span>`
    }).join("")
    if (!lines && !tick) return ""
    return `<div class="cell" style="${frame}">${lines}${tick}</div>`
  }).join("")

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Equipment Repair Order ${escape(data?.record?.eroCode || "")}</title>
<style>
  @page { size: A4 portrait; margin: 0 }
  * { box-sizing: border-box }
  html, body { margin: 0; padding: 0; background: #fff }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  /* the page itself: 210mm x 297mm, the same box on screen, in print and in
     the PDF, so none of the three can drift from the others */
  .sheet { position: relative; width: 210mm; height: 297mm; margin: 0 auto; background: #fff; overflow: hidden }
  .sheet i { position: absolute; background: #000 }
  .cell { position: absolute; overflow: hidden }
  .cell > span { position: absolute; display: block; white-space: nowrap }
  .cell.mark { display: flex; align-items: center; justify-content: center }
  .cell img { max-width: 100%; max-height: 100%; object-fit: contain }
  .cell u { position: absolute; width: 3.4mm; height: 3.4mm; border: 0.25mm solid #000; text-decoration: none;
    font-size: 8pt; line-height: 3.1mm; text-align: center }
  .pagefoot { position: absolute; right: 9mm; font-size: 6.5pt; font-weight: 700 }
</style></head>
<body>
  <div class="sheet">
    ${rules}
    ${boxes}
    <div class="pagefoot" style="top:${mm(spec.footerY)}">${escape(spec.footer)}</div>
  </div>
</body></html>`
}

/* ------------------------------------------------------------------ *
   As a PDF: the same description, drawn.
 * ------------------------------------------------------------------ */
function drawEroSheet(pdf, data) {
  const spec = eroSheetSpec(data)
  pdf.setLineWidth(RULE)
  pdf.setDrawColor(0)
  pdf.setTextColor(0)
  spec.segments.forEach(({ x1, y1, x2, y2 }) => pdf.line(x1, y1, x2, y2))

  spec.cells.forEach((box) => {
    const pad = box.pad ?? 1.2
    if (box.color) pdf.setTextColor(...box.color.rgb)
    else pdf.setTextColor(0)
    box.render.forEach((line) => {
      pdf.setFont("helvetica", line.bold ? "bold" : "normal")
      pdf.setFontSize(line.size)
      const x = line.dx !== undefined ? box.x + line.dx
        : line.align === "center" ? box.x + box.w / 2
        : line.align === "right" ? box.x + box.w - pad
        : box.x + pad
      pdf.text(line.text, x, box.y + line.y, { align: line.dx !== undefined ? "left" : line.align, baseline: "middle" })
    })

    if (box.tick !== undefined) {
      const mark = tickBox(box)
      pdf.setLineWidth(RULE)
      pdf.rect(mark.x, mark.y, TICK, TICK)
      if (box.tick) {
        pdf.setLineWidth(0.45)
        pdf.line(mark.x + 0.8, mark.y + 1.8, mark.x + 1.5, mark.y + 2.6)
        pdf.line(mark.x + 1.5, mark.y + 2.6, mark.x + 2.7, mark.y + 0.9)
        pdf.setLineWidth(RULE)
      }
    }
  })

  const logo = spec.cells.find((box) => box.logo)
  if (logo?.logo) {
    try { pdf.addImage(logo.logo, logo.x + 2, logo.y + 2, logo.w - 4, logo.h - 4, undefined, "FAST") }
    catch { /* a mark that will not load is simply not printed */ }
  }

  pdf.setTextColor(0)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(6.5)
  pdf.text(spec.footer, PAGE.right, spec.footerY + 1.8, { align: "right" })
  return pdf
}

/* A filename somebody can find again: the ERO code when there is one, the
   asset otherwise. */
export const eroFormFilename = ({ asset = {}, record = {} }, extension = "pdf") =>
  `equipment-repair-order-${record.eroCode ? String(record.eroCode).replace(/[^\w.-]+/g, "-") : (asset.tag || "asset")}.${extension}`

/* The drawn A4 sheet: the same rules and the same words in the same places as
   the printed page. jsPDF is fetched only when somebody asks for a copy, so
   it costs the workspace nothing until then. */
export async function eroFormPdf(data) {
  const { jsPDF } = await import("jspdf")
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  pdf.setProperties({ title: `Equipment Repair Order ${data?.record?.eroCode || ""}`.trim() })
  return drawEroSheet(pdf, data)
}

export async function downloadEroForm(data) {
  const pdf = await eroFormPdf(data)
  pdf.save(eroFormFilename(data))
}

/* Prints without leaving the workspace. The frame is removed once the print
   dialog has been dismissed, and after a fallback delay in case it never
   reports back. */
export function printEroForm(data) {
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden"
  const remove = () => { if (frame.parentNode) frame.parentNode.removeChild(frame) }
  /* the sheet has to be in the frame before the dialog opens, or the print is
     of the empty document the frame started on */
  let printed = false
  const go = (tries = 0) => {
    if (printed) return
    const view = frame.contentWindow
    if (!view || !frame.contentDocument?.querySelector(".sheet")) {
      if (tries > 60) { remove(); return }
      setTimeout(() => go(tries + 1), 50)
      return
    }
    printed = true
    view.onafterprint = remove
    view.focus()
    view.print()
    setTimeout(remove, 60000)
  }
  frame.onload = () => go()
  frame.srcdoc = eroFormHtml(data)
  document.body.appendChild(frame)
  go()
}
