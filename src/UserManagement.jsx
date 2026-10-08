import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react'
import { supabase } from './lib/supabase.js'
import { useDialogFocus, useEscapeKey } from './lib/modal.js'

const COLORS = {
  ink: 'var(--ams-text)', mute: 'var(--ams-mute)', rule: 'var(--ams-line)', softRule: 'var(--ams-line-soft)',
  surface: 'var(--ams-surface)', soft: 'var(--ams-surface-2)', active: 'var(--ams-ok)',
  ok: 'var(--ams-ok)', danger: 'var(--ams-alarm)', head: 'var(--ams-head)',
  brand: 'var(--ams-sand)', brandInk: 'var(--ams-on-sand)', brandEdge: 'var(--ams-sand-deep)',
}
const input = { width: '100%', border: `1px solid ${COLORS.rule}`, borderRadius: 3, padding: '8px 9px', fontSize: 13.5, background: 'var(--ams-well)', color: 'var(--ams-text)' }
const emptyForm = {
  id: '', fullName: '', username: '', email: '', password: '', role: 'custodian', isActive: true,
  allCompanies: false, allAssetGroups: false, companyIds: [], assetGroupIds: [],
}

const fmt = (value) => value
  ? new Date(value).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'Never'

const roleLabels = {
  super_admin: 'Super Admin', fa_admin: 'FA Admin', custodian: 'Custodian', purchaser: 'Purchaser', technician: 'Technician',
}

const permissionMatrix = [
  ['View assets', 'Full', 'Full', 'Full', 'View', 'View'],
  ['Add asset', 'Yes', 'Yes', 'Yes', 'No', 'No'],
  ['Edit asset', 'Full', 'Yes', 'Limited / Yes', 'No', 'No'],
  ['Transfer asset', 'Yes', 'Yes', 'Yes', 'No', 'No'],
  ['Repairs', 'Full', 'Full', 'Full', 'View', 'Full'],
  ['Parts', 'Full', 'Full', 'Full', 'Full', 'View'],
  ['Purchasing', 'Full', 'Full', 'Full', 'Full', 'No'],
  ['Maintenance', 'Full', 'Full', 'Full', 'View', 'View'],
  ['Asset map', 'Full', 'Full', 'Full', 'View', 'View'],
  ['Reports', 'Full', 'Full', 'Full', 'Limited', 'No'],
  ['User Management', 'Full', 'No', 'No', 'No', 'No'],
]

/* the register's own button look (.ams-btn, in its chrome stylesheet), so
   this page's actions match every other page's */
function Button({ children, onClick, icon: Icon, primary, danger, disabled, type = 'button' }) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} className="ams-btn justify-center"
      data-kind={primary ? 'solid' : danger ? 'danger' : 'ghost'}>
      {Icon && <Icon size={14} />}{children}
    </button>
  )
}

function ScopePicker({ title, allLabel, all, onAll, items, selected, onToggle, disabled }) {
  return (
    <fieldset disabled={disabled} className="p-3" style={{ border: `1px solid ${COLORS.softRule}`, background: COLORS.soft }}>
      <legend className="px-1" style={{ fontSize: 12, fontWeight: 700, color: COLORS.mute, letterSpacing: '.06em' }}>{title.toUpperCase()}</legend>
      <label className="flex items-center gap-2 mb-2" style={{ fontSize: 13.5, fontWeight: 600 }}>
        <input type="checkbox" checked={all} onChange={(event) => onAll(event.target.checked)} /> {allLabel}
      </label>
      <div className="grid sm:grid-cols-2 gap-1.5" style={{ opacity: all ? .45 : 1 }}>
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2" style={{ fontSize: 13 }}>
            <input type="checkbox" disabled={all} checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} /> {item.name}
          </label>
        ))}
        {!items.length && <div style={{ fontSize: 12.5, color: COLORS.mute }}>No records configured yet.</div>}
      </div>
    </fieldset>
  )
}

function UserForm({ value, roles, companies, assetGroups, onClose, onSave, busy }) {
  const [form, setForm] = useState(value)
  const [error, setError] = useState('')
  const [askDiscard, setAskDiscard] = useState(false)
  /* what the form opened with, frozen for its lifetime, so leaving can tell
     an untouched form from one someone has filled in */
  const [opened] = useState(() => JSON.stringify(value))
  const panel = useRef(null)
  const titleId = useId()
  const editing = Boolean(form.id)
  const superAdmin = form.role === 'super_admin'
  const set = (key, next) => setForm((current) => ({ ...current, [key]: next }))
  const toggle = (key, id) => setForm((current) => ({
    ...current,
    [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id],
  }))

  /* Escape, the X and Cancel are the same intent, so they share one door:
     nothing typed leaves at once, anything typed asks first. */
  const requestClose = () => {
    if (busy) return
    if (JSON.stringify(form) !== opened) return setAskDiscard(true)
    onClose()
  }
  useEscapeKey(!busy, requestClose)
  useEscapeKey(askDiscard, () => setAskDiscard(false))
  useDialogFocus(panel)

  const submit = async (event) => {
    event.preventDefault()
    if (!form.fullName.trim() || !form.email.trim()) return setError('Name and email are required.')
    if (!editing && form.password.length < 8) return setError('The temporary password must contain at least 8 characters.')
    if (!superAdmin && !form.allCompanies && !form.companyIds.length) return setError('Assign at least one company, or select All Companies.')
    if (!superAdmin && !form.allAssetGroups && !form.assetGroupIds.length) return setError('Assign at least one asset group, or select All Asset Groups.')
    setError('')
    await onSave({
      ...form,
      allCompanies: superAdmin || form.allCompanies,
      allAssetGroups: superAdmin || form.allAssetGroups,
      isActive: superAdmin || form.isActive,
    })
  }

  return (
    <div className="ams-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="relative w-full" style={{ maxWidth: 780 }}>
      <form ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onSubmit={submit} className="w-full overflow-auto" style={{ maxHeight: '94vh', background: COLORS.surface, borderRadius: 3, outline: 'none' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.softRule}` }}>
          <div>
            <h2 id={titleId} style={{ fontSize: 17, fontWeight: 650 }}>{editing ? 'Edit user access' : 'Create user account'}</h2>
            <p style={{ color: COLORS.mute, fontSize: 12.5 }}>Role permissions and both data scopes are enforced together.</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="Close" className="p-1"><X size={18} /></button>
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-4">
          <label style={{ fontSize: 12, color: COLORS.mute }}>FULL NAME<input required value={form.fullName} onChange={(e) => set('fullName', e.target.value)} style={{ ...input, marginTop: 5 }} /></label>
          <label style={{ fontSize: 12, color: COLORS.mute }}>USERNAME<input value={form.username} onChange={(e) => set('username', e.target.value)} style={{ ...input, marginTop: 5 }} /></label>
          <label style={{ fontSize: 12, color: COLORS.mute }}>EMAIL<input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} style={{ ...input, marginTop: 5 }} /></label>
          {!editing && <label style={{ fontSize: 12, color: COLORS.mute }}>TEMPORARY PASSWORD<input required type="password" minLength={8} value={form.password} onChange={(e) => set('password', e.target.value)} style={{ ...input, marginTop: 5 }} /></label>}
          <label style={{ fontSize: 12, color: COLORS.mute }}>SYSTEM ROLE
            <select value={form.role} onChange={(e) => set('role', e.target.value)} style={{ ...input, marginTop: 5 }}>
              {roles.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end py-2" style={{ fontSize: 13.5 }}>
            <input type="checkbox" disabled={superAdmin} checked={superAdmin || form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Active account
          </label>
          <div className="sm:col-span-2 grid md:grid-cols-2 gap-3">
            <ScopePicker title="Company Access" allLabel="All Companies" all={superAdmin || form.allCompanies} disabled={superAdmin}
              onAll={(next) => set('allCompanies', next)} items={companies} selected={form.companyIds} onToggle={(id) => toggle('companyIds', id)} />
            <ScopePicker title="Asset Group Access" allLabel="All Asset Groups" all={superAdmin || form.allAssetGroups} disabled={superAdmin}
              onAll={(next) => set('allAssetGroups', next)} items={assetGroups} selected={form.assetGroupIds} onToggle={(id) => toggle('assetGroupIds', id)} />
          </div>
          {superAdmin && <div className="sm:col-span-2 p-3" style={{ background: 'var(--ams-ok-tint)', color: COLORS.active, fontSize: 13 }}>Super Admin accounts are always active and automatically receive all-company and all-asset-group access.</div>}
          {error && <div className="sm:col-span-2 p-3" style={{ background: 'var(--ams-alarm-tint)', color: COLORS.danger, fontSize: 13 }}>{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${COLORS.softRule}`, background: COLORS.soft }}>
          <Button onClick={requestClose}>Cancel</Button><Button type="submit" primary disabled={busy}>{busy ? 'Saving…' : editing ? 'Save access' : 'Create user'}</Button>
        </div>
      </form>

      {askDiscard && (
        <div className="ams-scrim absolute inset-0 z-10 flex items-center justify-center p-5">
          <div role="alertdialog" aria-modal="true" aria-label="You have unsaved changes"
            className="p-5" style={{ maxWidth: 380, background: COLORS.surface, border: `1px solid ${COLORS.rule}`, borderRadius: 3 }}>
            <div style={{ fontSize: 15.5, fontWeight: 650 }}>You have unsaved changes</div>
            <div style={{ fontSize: 13.5, color: COLORS.mute, marginTop: 6, lineHeight: 1.5 }}>
              Closing this form now discards what you have entered. Nothing has been saved yet.
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button onClick={() => setAskDiscard(false)}>Keep editing</Button>
              <Button primary onClick={onClose}>Discard changes</Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

export default function UserManagement() {
  const [data, setData] = useState({ users: [], roles: [], companies: [], assetGroups: [] })
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const invoke = useCallback(async (body) => {
    const { data: result, error: invokeError } = await supabase.functions.invoke('admin-users', { body })
    if (invokeError) throw invokeError
    if (result?.error) throw new Error(result.error)
    return result
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await invoke({ action: 'list' })
      setData(result)
      setSelectedId((current) => current || result.users[0]?.id || '')
    } catch (nextError) {
      setError(nextError.message || 'User accounts could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [invoke])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])
  const selected = useMemo(() => data.users.find((user) => user.id === selectedId) ?? null, [data.users, selectedId])
  const names = (ids, items) => ids.map((id) => items.find((item) => item.id === id)?.name).filter(Boolean)

  const edit = (user) => setForm({
    ...emptyForm,
    id: user.id, fullName: user.fullName, username: user.username, email: user.email, role: user.role,
    isActive: user.isActive, allCompanies: user.allCompanies, allAssetGroups: user.allAssetGroups,
    companyIds: user.companyIds, assetGroupIds: user.assetGroupIds,
  })

  const save = async (value) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await invoke({ action: value.id ? 'update' : 'create', userId: value.id || undefined, ...value })
      setForm(null)
      setNotice(value.id ? 'User access updated.' : 'User account created.')
      await load()
    } catch (nextError) {
      setError(nextError.message || 'The user account could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const recovery = async (user) => {
    if (!window.confirm(`Send a password recovery email to ${user.email}?`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await invoke({ action: 'send_recovery', userId: user.id, email: user.email })
      setNotice(`Password recovery sent to ${user.email}.`)
    } catch (nextError) {
      setError(nextError.message || 'Recovery email could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="py-16 text-center" style={{ color: COLORS.mute, fontSize: 13 }}>LOADING USER ACCESS…</div>

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div><h2 style={{ fontSize: 19, fontWeight: 650 }}>User Management</h2><p style={{ color: COLORS.mute, fontSize: 13 }}>Create accounts and combine role permissions with company and asset-group scope.</p></div>
        <div className="flex gap-2"><Button icon={RefreshCw} onClick={load}>Refresh</Button><Button icon={Plus} primary onClick={() => setForm({ ...emptyForm })}>Create user</Button></div>
      </div>
      {error && <div className="mb-3 p-3" style={{ background: 'var(--ams-alarm-tint)', color: COLORS.danger, fontSize: 13 }}>{error}</div>}
      {notice && <div className="mb-3 p-3" style={{ background: 'var(--ams-ok-tint)', color: COLORS.ok, fontSize: 13 }}>{notice}</div>}

      <div className="grid lg:grid-cols-[minmax(300px,0.85fr)_minmax(360px,1.15fr)] gap-4 items-start">
        <section style={{ background: COLORS.surface, border: `1px solid ${COLORS.rule}` }}>
          <div className="px-4 py-3" style={{ borderBottom: `1px solid ${COLORS.softRule}`, color: COLORS.mute, fontSize: 12 }}>{data.users.length} MANAGED ACCOUNT{data.users.length === 1 ? '' : 'S'}</div>
          {!data.users.length ? <div className="p-8 text-center" style={{ color: COLORS.mute, fontSize: 13 }}>No managed accounts yet.</div> : data.users.map((user) => (
            <button key={user.id} onClick={() => setSelectedId(user.id)} className="w-full text-left px-4 py-3 flex items-start gap-3"
              style={{ borderBottom: `1px solid ${COLORS.softRule}`, borderLeft: `3px solid ${selectedId === user.id ? COLORS.active : 'transparent'}`, background: selectedId === user.id ? 'var(--ams-surface-2)' : 'transparent' }}>
              <UserRound size={17} style={{ color: user.isActive ? COLORS.active : COLORS.mute, marginTop: 2 }} />
              <div className="min-w-0 flex-1"><div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{user.fullName}</div><div className="truncate" style={{ color: COLORS.mute, fontSize: 12.5 }}>{user.email}</div><div style={{ color: COLORS.active, fontSize: 11.5, marginTop: 2 }}>{user.roleName}</div></div>
              <span style={{ color: user.isActive ? COLORS.ok : COLORS.danger, fontSize: 11.5 }}>{user.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
            </button>
          ))}
        </section>

        <section style={{ background: COLORS.surface, border: `1px solid ${COLORS.rule}` }}>
          {!selected ? <div className="p-10 text-center" style={{ color: COLORS.mute, fontSize: 13 }}>Select an account to view its current access.</div> : <>
            <div className="flex flex-wrap justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.softRule}` }}>
              <div><div className="flex items-center gap-2"><ShieldCheck size={17} style={{ color: COLORS.active }} /><h3 style={{ fontSize: 16, fontWeight: 650 }}>{selected.fullName}</h3></div><div style={{ color: COLORS.mute, fontSize: 12.5, marginTop: 2 }}>{selected.username || 'No username'} · {selected.email}</div></div>
              <div className="flex gap-2"><Button icon={KeyRound} disabled={busy || !selected.isActive} onClick={() => recovery(selected)}>Reset access</Button><Button icon={Pencil} primary onClick={() => edit(selected)}>Edit</Button></div>
            </div>
            <div className="grid sm:grid-cols-3 gap-4 px-5 py-4" style={{ background: COLORS.soft, borderBottom: `1px solid ${COLORS.softRule}` }}>
              <div><div style={{ color: COLORS.mute, fontSize: 11 }}>ROLE</div><div style={{ fontSize: 13.5 }}>{roleLabels[selected.role] || selected.roleName}</div></div>
              <div><div style={{ color: COLORS.mute, fontSize: 11 }}>STATUS</div><div style={{ fontSize: 13.5, color: selected.isActive ? COLORS.ok : COLORS.danger }}>{selected.isActive ? 'Active' : 'Inactive / Disabled'}</div></div>
              <div><div style={{ color: COLORS.mute, fontSize: 11 }}>CREATED</div><div style={{ fontSize: 13.5 }}>{fmt(selected.createdAt)}</div></div>
              <div className="sm:col-span-3"><div style={{ color: COLORS.mute, fontSize: 11 }}>LAST SIGN-IN</div><div style={{ fontSize: 13.5 }}>{fmt(selected.lastSignInAt)}</div></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 p-5">
              <div className="p-3" style={{ border: `1px solid ${COLORS.softRule}` }}><div style={{ color: COLORS.mute, fontSize: 11, marginBottom: 6 }}>COMPANY ACCESS</div>{selected.allCompanies ? <div className="flex items-center gap-2" style={{ color: COLORS.ok, fontSize: 13.5 }}><Check size={14} />All Companies</div> : <div style={{ fontSize: 13.5 }}>{names(selected.companyIds, data.companies).join(', ') || 'None assigned'}</div>}</div>
              <div className="p-3" style={{ border: `1px solid ${COLORS.softRule}` }}><div style={{ color: COLORS.mute, fontSize: 11, marginBottom: 6 }}>ASSET GROUP ACCESS</div>{selected.allAssetGroups ? <div className="flex items-center gap-2" style={{ color: COLORS.ok, fontSize: 13.5 }}><Check size={14} />All Asset Groups</div> : <div style={{ fontSize: 13.5 }}>{names(selected.assetGroupIds, data.assetGroups).join(', ') || 'None assigned'}</div>}</div>
            </div>
          </>}
        </section>
      </div>

      <section className="mt-5 overflow-x-auto" style={{ background: COLORS.surface, border: `1px solid ${COLORS.rule}` }}>
        <div className="px-4 py-3" style={{ borderBottom: `1px solid ${COLORS.softRule}` }}><h3 style={{ fontSize: 14, fontWeight: 650 }}>Default role-permission matrix</h3><p style={{ color: COLORS.mute, fontSize: 12 }}>Stored as granular permissions so later per-user overrides do not require redesigning the schema.</p></div>
        <table className="w-full" style={{ minWidth: 760, borderCollapse: 'collapse', fontSize: 12.5 }}><thead><tr>{['Feature', 'Super Admin', 'FA Admin', 'Custodian', 'Purchaser', 'Technician'].map((head) => <th key={head} className="text-left px-3 py-2" style={{ borderBottom: `1px solid ${COLORS.rule}`, color: COLORS.mute }}>{head}</th>)}</tr></thead><tbody>{permissionMatrix.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={`${row[0]}-${index}`} className="px-3 py-2" style={{ borderBottom: `1px solid ${COLORS.softRule}`, fontWeight: index === 0 ? 600 : 400, color: cell === 'No' ? COLORS.mute : COLORS.ink }}>{cell}</td>)}</tr>)}</tbody></table>
      </section>

      {form && <UserForm value={form} roles={data.roles} companies={data.companies} assetGroups={data.assetGroups} busy={busy} onClose={() => setForm(null)} onSave={save} />}
    </div>
  )
}
