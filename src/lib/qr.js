/* =========================================================================
   QR codes, drawn rather than fetched.

   Both the places that print one — the transfer form and an asset's own code —
   render inside a document with no network of its own, so the symbol has to be
   part of the page. One path for the whole thing keeps the markup small and
   the edges sharp.
   ========================================================================= */
import QRCode from "qrcode"

/* Where a scanned code should land. A printed sheet or a sticker outlives the
   tab it came from, so the address is the deployed one when it is configured,
   and only falls back to wherever this page happens to be running. */
export function appLink(query) {
  const configured = String(import.meta.env?.VITE_APP_URL || "").replace(/\/+$/, "")
  const base = configured || (typeof window === "undefined" ? "" : window.location.origin)
  return `${base}/dashboard?${new URLSearchParams(query).toString()}`
}

/* Four modules of quiet zone, as the specification asks: a reader needs the
   white border to find the symbol at all. */
const MARGIN = 4

export function qrSvg(text, pixels) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" })
  const { size, data } = modules
  const span = size + MARGIN * 2
  let path = ""
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x]) path += `M${x + MARGIN},${y + MARGIN}h1v1h-1z`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${span}" height="${span}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}

/* For an <img>: the same symbol, without handing raw markup to a renderer. */
export const qrDataUri = (text, pixels) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text, pixels))}`
