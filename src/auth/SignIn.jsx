import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'

const input = {
  width: '100%',
  border: '1px solid #CCD4DE',
  borderRadius: 3,
  padding: '10px 11px',
  fontSize: 14,
  outline: 'none',
}

export default function SignIn({ onSubmit, error, configured = true }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await onSubmit(email.trim(), password)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#E7EAF0', color: '#141C26' }}>
      <form onSubmit={submit} className="w-full p-6" style={{ maxWidth: 390, background: '#fff', border: '1px solid #CCD4DE', borderRadius: 3 }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2" style={{ background: '#EAF1F7', color: '#1F5E8C', borderRadius: 3 }}><LockKeyhole size={21} /></div>
          <div>
            <h1 className="uppercase" style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.16em', fontSize: 15, fontWeight: 700 }}>Asset register</h1>
            <p style={{ color: '#69747F', fontSize: 13 }}>Sign in with your administrator-provided account.</p>
          </div>
        </div>

        {!configured && (
          <div className="mb-4 p-3" style={{ background: '#FAEEEC', color: '#A6392B', fontSize: 13 }}>
            Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.
          </div>
        )}
        {error && <div className="mb-4 p-3" style={{ background: '#FAEEEC', color: '#A6392B', fontSize: 13 }}>{error}</div>}

        <label className="block mb-3" style={{ fontSize: 12, color: '#69747F' }}>
          EMAIL
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} style={{ ...input, marginTop: 5 }} />
        </label>
        <label className="block mb-5" style={{ fontSize: 12, color: '#69747F' }}>
          PASSWORD
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} style={{ ...input, marginTop: 5 }} />
        </label>
        <button type="submit" disabled={!configured || busy} className="w-full py-2.5"
          style={{ background: '#141C26', color: '#fff', borderRadius: 3, opacity: !configured || busy ? 0.55 : 1, fontSize: 14, fontWeight: 600 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

