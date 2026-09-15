/* =========================================================================
   Reading a QR code, from a camera or from a picture of one.

   Decoding happens here rather than in a component so the camera loop and the
   file picker share one implementation, and so the parsing of what a code
   turns out to mean is written down in one place.
   ========================================================================= */
import jsQR from "jsqr"

/* jsQR wants raw pixels; both sources arrive as something drawable. */
const decodeImageData = (image) => jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })

export function decodeFromCanvas(canvas, context) {
  const { width, height } = canvas
  if (!width || !height) return null
  return decodeImageData(context.getImageData(0, 0, width, height))?.data || null
}

/* A photograph of a sticker is usually far larger than the code inside it, so
   the picture is drawn at its own size rather than scaled down, and only
   scaled when it is big enough to cost real time. */
const MAX_SIDE = 1600

export async function decodeFromFile(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext("2d", { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return decodeFromCanvas(canvas, context)
}

/* What a scanned code turns out to be. The codes this register prints carry a
   dashboard link; anything else is treated as an asset's own code, because a
   sticker printed elsewhere usually holds nothing but that. */
export function readScan(text) {
  const raw = String(text || "").trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    const transfer = url.searchParams.get("transfer")
    if (transfer) return { kind: "transfer", value: transfer }
    const asset = url.searchParams.get("asset")
    if (asset) return { kind: "asset", value: asset }
  } catch {
    /* not a URL: fall through and read it as a plain code */
  }
  /* a bare link with no code in it says nothing about an asset */
  if (/^https?:\/\//i.test(raw)) return null
  return { kind: "asset", value: raw }
}
