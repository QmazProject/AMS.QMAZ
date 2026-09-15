/* =========================================================================
   Getting a photographed sheet small enough to send.

   A signed transfer form is photographed on a phone, and a phone photograph of
   an A4 sheet is three to eight megabytes of detail nobody reads. What the
   register needs from it is legible handwriting and a signature, and that
   survives a long edge of 2200px at JPEG quality .82 — an order of magnitude
   less to push over a site connection.

   Anything that is not a decodable raster image is handed back untouched: a
   PDF is already the document, and a format the browser will not decode (HEIC
   from an iPhone, most often) has to reach the server as it came rather than
   not at all.
   ========================================================================= */

/* Wide enough that a filled ruled line stays readable when the sheet is opened
   full screen, small enough that the upload is a moment rather than a wait. */
const MAX_EDGE = 2200
const QUALITY = 0.82

/* Under this the re-encode costs more in quality than it returns in bytes. */
const FLOOR = 300 * 1024

/* The re-encode always produces a JPEG, so the name has to say so — otherwise
   the file is filed as picture.png and will not open as one. */
const jpegName = (name) => `${String(name || "form").replace(/\.[^.]+$/, "")}.jpg`

/* Returns the file to upload alongside what it came from, so the panel can
   show the saving rather than silently swapping the file out. `shrunk` is
   false whenever the original is being sent unchanged, for any reason. */
export async function prepareUpload(file) {
  const untouched = { file, original: file, shrunk: false }
  if (!file || !String(file.type || "").startsWith("image/")) return untouched
  if (file.size <= FLOOR) return untouched

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext("2d")
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY))
    /* an already-compressed photograph can come back bigger; keep the smaller */
    if (!blob || blob.size >= file.size) return untouched
    return {
      file: new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() }),
      original: file,
      shrunk: true,
    }
  } catch {
    /* HEIC, or anything else this browser cannot decode: send it as it came */
    return untouched
  }
}
