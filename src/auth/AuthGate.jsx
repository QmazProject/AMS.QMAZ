import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, LogOut } from 'lucide-react'
import { supabase, supabaseConfigured } from '../lib/supabase.js'
import SignIn from './SignIn.jsx'

const CenterMessage = ({ title, children, action }) => (
  <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#E7EAF0', color: '#141C26' }}>
    <div className="w-full p-6 text-center" style={{ maxWidth: 480, background: '#fff', border: '1px solid #CCD4DE' }}>
      <AlertTriangle size={25} style={{ color: '#A6392B', margin: '0 auto 10px' }} />
      <h1 style={{ fontSize: 17, fontWeight: 650 }}>{title}</h1>
      <div style={{ color: '#69747F', fontSize: 13.5, marginTop: 7, lineHeight: 1.5 }}>{children}</div>
      {action && <button onClick={action} className="mt-5 inline-flex items-center gap-2 px-4 py-2" style={{ border: '1px solid #CCD4DE', fontSize: 13 }}><LogOut size={14} />Sign out</button>}
    </div>
  </main>
)

function PasswordRecovery({ onComplete }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError('The passwords do not match.')
    setBusy(true); setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) setError(updateError.message)
    else onComplete()
  }
  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#E7EAF0', color: '#141C26' }}>
      <form onSubmit={submit} className="w-full p-6" style={{ maxWidth: 390, background: '#fff', border: '1px solid #CCD4DE' }}>
        <h1 style={{ fontSize: 18, fontWeight: 650 }}>Choose a new password</h1>
        <p className="mb-4" style={{ color: '#69747F', fontSize: 13 }}>This recovery session is temporary. Set the password before continuing.</p>
        {error && <div className="mb-3 p-3" style={{ background: '#FAEEEC', color: '#A6392B', fontSize: 13 }}>{error}</div>}
        <input type="password" required minLength={8} autoComplete="new-password" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full mb-3 px-3 py-2" style={{ border: '1px solid #CCD4DE' }} />
        <input type="password" required minLength={8} autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="w-full mb-4 px-3 py-2" style={{ border: '1px solid #CCD4DE' }} />
        <button type="submit" disabled={busy} className="w-full py-2.5" style={{ background: '#141C26', color: '#fff', opacity: busy ? .55 : 1 }}>{busy ? 'Updating…' : 'Update password'}</button>
      </form>
    </main>
  )
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [access, setAccess] = useState(null)
  const [loading, setLoading] = useState(supabaseConfigured)
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState(false)

  const loadAccess = useCallback(async (nextSession) => {
    setSession(nextSession)
    setAccess(null)
    setError('')
    if (!nextSession || !supabase) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: accessError } = await supabase.rpc('current_asset_user_access')
    if (accessError) setError(accessError.message)
    else setAccess(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!supabase) {
      return undefined
    }
    let live = true
    supabase.auth.getSession().then(({ data }) => {
      if (live) loadAccess(data.session)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (live) window.setTimeout(() => loadAccess(nextSession), 0)
    })
    return () => {
      live = false
      listener.subscription.unsubscribe()
    }
  }, [loadAccess])

  const signIn = async (email, password) => {
    if (!supabase) return
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) setError(signInError.message)
  }
  const signOut = async () => {
    if (supabase) await supabase.auth.signOut()
  }

  if (!supabaseConfigured) return <SignIn configured={false} onSubmit={signIn} />
  if (recovering) return <PasswordRecovery onComplete={() => setRecovering(false)} />
  if (loading) return <CenterMessage title="Opening your workspace">Checking account status and permissions…</CenterMessage>
  if (!session) return <SignIn onSubmit={signIn} error={error} />
  if (error) return <CenterMessage title="Access could not be verified" action={signOut}>{error}</CenterMessage>
  if (!access) return <CenterMessage title="Account access is not assigned" action={signOut}>A Super Admin must assign your role, companies, and asset groups before you can use the register.</CenterMessage>
  if (!access.is_active) return <CenterMessage title="Account disabled" action={signOut}>This account no longer has access to protected Asset Management data. Contact a Super Admin if this is unexpected.</CenterMessage>

  return children({ session, user: session.user, access, onSignOut: signOut })
}
