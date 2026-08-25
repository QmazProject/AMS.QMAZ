import { useEffect, useState } from 'react'

/* =========================================================================
   Routing — two screens, two addresses.

   The gate decides which screen you are on from the session; this only keeps
   the address bar honest about it, so /home is the sign-in page and a signed-in
   session sits at /dashboard. That is the whole routing table, which is why it
   is thirty lines of history API rather than a router dependency.
   ========================================================================= */
export const ROUTES = { home: '/home', dashboard: '/dashboard' }

const NAVIGATION = 'ams:navigation'

/* Trailing slashes and casing are not meaningful here — /Home/ is /home. */
const normalize = (pathname) => pathname.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1').toLowerCase()

export const readPath = () => (typeof window === 'undefined' ? '/' : normalize(window.location.pathname))

/* The query string comes along, so ?intro=0 keeps skipping the intro across a
   redirect. Moving to where you already are is a no-op, which is what stops the
   gate's effect below from looping. */
export function navigate(to, { replace = false } = {}) {
  if (typeof window === 'undefined' || readPath() === normalize(to)) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to + window.location.search)
  window.dispatchEvent(new Event(NAVIGATION))
}

export function usePath() {
  const [path, setPath] = useState(readPath)
  useEffect(() => {
    /* popstate covers back and forward; pushState fires nothing on its own,
       hence the companion event. */
    const sync = () => setPath(readPath())
    window.addEventListener('popstate', sync)
    window.addEventListener(NAVIGATION, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(NAVIGATION, sync)
    }
  }, [])
  return path
}
