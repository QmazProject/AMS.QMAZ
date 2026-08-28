import { useEffect, useRef } from 'react'

/* =========================================================================
   Modal keyboard and focus behaviour, shared by every dialog in the product.

   Escape closes a dialog; the backdrop deliberately does not, so a stray tap
   beside a half-filled form cannot throw it away. Escape is the intentional
   equivalent of pressing Cancel, which is why the dialogs route it through
   the same handler rather than closing directly.

   One document listener serves every open dialog. Each one pushes a handler
   while it is mounted and the key goes to the last one pushed — the dialog on
   top — so a discard prompt is dismissed before the form underneath it, and
   nothing below the top ever sees the key.
   ========================================================================= */
const stack = []
let listening = false

const handleKey = (event) => {
  if (event.key !== 'Escape' || !stack.length) return
  /* something nearer the keyboard already dealt with it — a native select
     popup, a datalist, any control that legitimately owns Escape first */
  if (event.defaultPrevented) return
  event.preventDefault()
  event.stopPropagation()
  stack[stack.length - 1]()
}

export function useEscapeKey(active, onEscape) {
  /* the handler is read through a ref, so the subscription depends only on
     whether the dialog is open - re-rendering while typing never detaches and
     re-attaches a listener, and a closed dialog leaves nothing behind */
  const latest = useRef(onEscape)
  useEffect(() => { latest.current = onEscape })

  useEffect(() => {
    if (!active) return undefined
    const entry = () => latest.current()
    stack.push(entry)
    if (!listening) {
      document.addEventListener('keydown', handleKey)
      listening = true
    }
    return () => {
      const at = stack.indexOf(entry)
      if (at !== -1) stack.splice(at, 1)
      if (!stack.length && listening) {
        document.removeEventListener('keydown', handleKey)
        listening = false
      }
    }
  }, [active])
}

/* Moves focus into the dialog when it opens and hands it back to whatever was
   focused before — usually the button that opened it — when it closes. */
export function useDialogFocus(panelRef) {
  useEffect(() => {
    const previous = document.activeElement
    const frame = requestAnimationFrame(() => panelRef.current?.focus?.())
    return () => {
      cancelAnimationFrame(frame)
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus()
    }
  }, [panelRef])
}

/* Only for tests and diagnostics: how many dialogs currently hold the key. */
export const openDialogCount = () => stack.length
