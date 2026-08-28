/* =========================================================================
   The printed transfer form.

   A paper copy of the movement, laid out like the pad it replaces:
   "Materials, Tools and Equipment Transfer Form" — a header block carrying the
   company, a type row, the item table, and four signature boxes across the
   bottom. What the register knows is filled in; what has to be signed for on
   delivery is left as ruled space, because that is the point of the paper.

   It prints from a hidden iframe rather than a new window, so a popup blocker
   cannot quietly swallow it.
   ========================================================================= */

import { appLink, qrSvg } from "./qr.js"

const escape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/* The movement a scanned form should open. */
export const transferDeepLink = (transferId) => appLink({ transfer: transferId })

/* The pad this replaces has eleven ruled lines; the register only ever prints
   one item per transfer, so the rest is there to look like the pad. Seven is
   what leaves the signature boxes, the code and the control number together on
   a single sheet, which matters more than matching the line count. */
const BLANK_ROWS = 7

const tick = (on) => `<span class="box">${on ? "&#10007;" : ""}</span>`

export function transferFormHtml({ company = {}, asset = {}, movement = {} }) {
  /* the paper says what moved, then every number the register holds for it,
     slash separated in register order, so the yard can match the line by
     whichever one is stencilled on the machine. The asset number is dropped
     when the name itself fell back to it, so it is never printed twice.
     Brand and model are register detail rather than identification, and are
     deliberately not printed here. */
  const name = asset.name || asset.tag || ""
  const ident = [
    ["Asset no.", asset.name ? asset.tag : ""],
    ["Asset code", asset.code],
    ["Serial no.", asset.serial],
    ["Body no.", asset.body],
  ].filter(([, value]) => value)
    .map(([label, value]) => `${escape(label)} ${escape(value)}`)
    .join(" / ")
  const rows = [`
    <tr>
      <td class="c">1</td>
      <td class="c">${escape(movement.date || "")}</td>
      <td>
        <div class="strong">${escape(name)}</div>
        ${ident ? `<div class="small">${ident}</div>` : ""}
      </td>
      <td class="c">1</td>
      <td>${escape(movement.fromLoc || "")}${movement.fromProject ? `<div class="small">${escape(movement.fromProject)}</div>` : ""}</td>
      <td>${escape(movement.toLoc || "")}${movement.toProject ? `<div class="small">${escape(movement.toProject)}</div>` : ""}</td>
      <td></td>
      <td>${escape(movement.fromPer || "")}</td>
    </tr>`]
  for (let i = 0; i < BLANK_ROWS; i += 1) {
    rows.push("<tr>" + "<td></td>".repeat(8) + "</tr>")
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Transfer form ${escape(asset.tag || "")}</title>
<style>
  @page { size: A4 landscape; margin: 0 }
  * { box-sizing: border-box }
  body { margin: 0; padding: 8mm; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 10.5pt }
  table { width: 100%; border-collapse: collapse; table-layout: fixed }
  td, th { border: 1px solid #000; padding: 3px 5px; vertical-align: top }
  .head td { padding: 4px 8px }
  .logo { width: 118px; text-align: center; vertical-align: middle }
  .logo img { max-width: 96px; max-height: 62px; object-fit: contain }
  .company { text-align: center; font-weight: 700; font-size: 15pt; letter-spacing: .04em; padding: 6px 0 }
  .value { text-align: center; font-weight: 700 }
  /* the pre-printed pad runs the classification labels across one open band,
     so the cell is single and the labels are spaced inside it, not ruled apart */
  .types td { padding: 6px 4px }
  .band { display: flex; align-items: center }
  .band > span { text-align: center; font-size: 11pt }
  .band > span:not(:last-child) { flex: 1 }
  .band > .band__remarks { flex: 0 0 230px }
  .remark { font-size: 9pt; font-weight: 700; margin-top: 2px }
  .box { display: inline-block; width: 15px; height: 15px; border: 1px solid #000; margin-left: 6px; vertical-align: -2px; line-height: 15px; font-size: 11px }
  thead th { font-size: 9pt; font-weight: 700; text-align: center; vertical-align: middle; line-height: 1.2 }
  tbody td { height: 30px; font-size: 10pt }
  .c { text-align: center }
  .strong { font-weight: 700 }
  .small { font-size: 8.5pt; color: #333 }
  .sign td { height: 92px; font-size: 9.5pt; position: relative; vertical-align: top }
  .rule { border-bottom: 1px solid #000; margin: 34px 0 2px }
  /* the one box the register can fill: who released it, and when */
  .filled { margin-top: 18px; font-weight: 700; text-align: center }
  .rule--tight { margin-top: 2px }
  .role { font-size: 9pt }
  /* The code sits in the header, directly above the number it opens, so the
     two things that identify this transfer are read in one place. */
  .scan { width: 118px; text-align: center; vertical-align: middle; padding: 4px 3px }
  .scan__code { line-height: 0 }
  .scan__say { font-size: 6.5pt; line-height: 1.2; margin-top: 2px }
  .serialcell { text-align: center; white-space: nowrap; color: #c00; font-weight: 700; letter-spacing: .02em }
  .foot { margin-top: 4px; text-align: right; font-size: 8.5pt }
  .note { font-style: italic; font-size: 8.5pt }
</style></head>
<body>
  <table class="head">
    <tr>
      <td class="logo" rowspan="3">${company.logoUrl ? `<img src="${escape(company.logoUrl)}" alt="" />` : ""}</td>
      <td class="company">${escape((company.name || "").toUpperCase())}</td>
      <td class="scan" rowspan="2">${movement.id ? `
        <div class="scan__code">${qrSvg(transferDeepLink(movement.id), 96)}</div>
        <div class="scan__say">Scan to file the signed copy</div>` : ""}
      </td>
    </tr>
    <tr>
      <td class="value">${escape(company.department || "Project Management")}</td>
    </tr>
    <tr>
      <td class="value">Materials, Tools and Equipment Transfer Form</td>
      <td class="serialcell">NO. ${escape(movement.number || "________")}</td>
    </tr>
  </table>

  <table class="types">
    <tr>
      <td class="band">
        <span>Material ${tick(false)}</span>
        <span>Tools/Equipment ${tick(true)}</span>
        <span>Others ${tick(false)}</span>
        <span class="band__remarks">Remarks</span>
      </td>
    </tr>
  </table>

  <table id="items">
    <colgroup>
      <col style="width:34px" /><col style="width:88px" /><col /><col style="width:44px" />
      <col style="width:132px" /><col style="width:132px" /><col style="width:96px" /><col style="width:150px" />
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2">No.</th>
        <th rowspan="2">Date &amp; Time <br />issued</th>
        <th rowspan="2">Materials/Equipment <br />Name &amp; Code</th>
        <th rowspan="2">Qty.</th>
        <th colspan="2">Transfer</th>
        <th rowspan="2">Date &amp; Time <br />Received</th>
        <th rowspan="2">Person who transferred <br />the items <br />
          <span class="note">(Tawo nga nagdala sa mga gamit/butang)</span></th>
      </tr>
      <tr><th>From</th><th>To</th></tr>
    </thead>
    <tbody>${rows.join("")}</tbody>
  </table>

  <table class="sign">
    <tr>
      <td>The above listed items were requested by:<div class="rule"></div><div class="role">Date &amp; Time:</div></td>
      <td>Items Released by:
        <div class="filled">${escape(movement.releasedBy || "")}</div>
        <div class="rule rule--tight"></div>
        <div class="role">Custodian<br />Date: ${escape(movement.date || "")}</div>
      </td>
      <td>Release Approved by:<div class="rule"></div><div class="role">Project Supervisor<br />Date:</div></td>
      <td>I hereby acknowledge that I received the above listed items.<div class="rule"></div><div class="role">Project Supervisor/Foreman<br />Date:</div></td>
    </tr>
  </table>
  <div class="foot">PMT.FL11.00(06/12)</div>
</body></html>`
}

/* A filename somebody can find again on a desktop: the number if the movement
   has one, the asset otherwise. */
export const transferFormFilename = ({ asset = {}, movement = {} }) =>
  `transfer-form-${movement.number ? `TR-${movement.number}` : (asset.tag || "asset")}.html`

/* Saved rather than printed: the same sheet as a file, which opens and prints
   from any browser. Chrome's own print dialog is where a PDF comes from, so
   this deliberately hands over the document rather than a half-rendered PDF. */
export function downloadTransferForm(data) {
  const blob = new Blob([transferFormHtml(data)], { type: "text/html;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = transferFormFilename(data)
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/* Prints without leaving the workspace. The frame is removed once the print
   dialog has been dismissed, and after a fallback delay in case it never
   reports back. */
export function printTransferForm(data) {
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden"
  document.body.appendChild(frame)

  const remove = () => { if (frame.parentNode) frame.parentNode.removeChild(frame) }
  frame.onload = () => {
    const view = frame.contentWindow
    if (!view) return remove()
    view.onafterprint = remove
    view.focus()
    view.print()
    setTimeout(remove, 60000)
  }
  frame.srcdoc = transferFormHtml(data)
}
