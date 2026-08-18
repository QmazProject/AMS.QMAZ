import AssetRegister from '../asset-register.jsx'
import AuthGate from './auth/AuthGate.jsx'

export default function App() {
  return (
    <AuthGate>
      {({ user, access, onSignOut }) => (
        <AssetRegister currentUser={user} access={access} onSignOut={onSignOut} />
      )}
    </AuthGate>
  )
}
