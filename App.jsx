import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, rpc } from './supabase'
import { balance } from './balance'

const CAP = 15
const RATING_STEPS = Array.from({ length: 9 }, (_, i) => 1 + i / 2) // 1, 1.5, ... 5
const fmtSum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const fmtAvg = (sum, n) => (n ? (sum / n).toFixed(1) : '–')
const HOURS_48 = 48 * 3600e3

function useLive() {
  const [settings, setSettings] = useState(null)
  const [confirmed, setConfirmed] = useState([])
  const load = useCallback(async () => {
    await supabase.rpc('expire_unpaid') // expiry check on every load
    const [s, r] = await Promise.all([
      supabase.from('match_settings').select('*').eq('id', 1).single(),
      supabase.from('registrations').select('*').eq('status', 'confirmed').order('approved_at'),
    ])
    if (s.data) setSettings(s.data)
    if (r.data) setConfirmed(r.data)
  }, [])
  useEffect(() => {
    load()
    const ch = supabase.channel('live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_settings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, load)
      .subscribe()
    const poll = setInterval(load, 30000) // safety net for updates RLS hides from realtime
    return () => { supabase.removeChannel(ch); clearInterval(poll) }
  }, [load])
  return { settings, confirmed, reload: load }
}

function Countdown({ since }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const left = new Date(since).getTime() + HOURS_48 - now
  if (left <= 0) return <span className="text-red-700">פג תוקף</span>
  const h = Math.floor(left / 3.6e6), m = Math.floor((left % 3.6e6) / 6e4), s = Math.floor((left % 6e4) / 1e3)
  const pad = (n) => String(n).padStart(2, '0')
  return <span dir="ltr" className="tabular-nums">{h}:{pad(m)}:{pad(s)}</span>
}

const Shell = ({ title, children }) => (
  <div className="min-h-screen">
    <header className="bg-pitch text-chalk px-4 pt-8 pb-6">
      <div className="max-w-xl mx-auto"><h1 className="text-3xl font-extrabold text-center">{title}</h1></div>
    </header>
    <main className="max-w-xl mx-auto px-4 py-5 space-y-6">{children}</main>
  </div>
)

const Ico = ({ children }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const CalendarIcon = () => <Ico><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Ico>
const ClockIcon = () => <Ico><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ico>
const PinIcon = () => <Ico><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></Ico>

const btn = 'rounded-lg px-4 py-2 font-medium disabled:opacity-50'

const CSS_COLORS = { 'שחור': '#111', 'לבן': '#fff', 'אדום': '#d62828', 'כחול': '#1d4ed8', 'ירוק': '#15803d', 'צהוב': '#facc15', 'כתום': '#ea580c', 'סגול': '#7e22ce', 'ורוד': '#ec4899' }

function Teams({ colors, players }) {
  return (
    <section>
      <h2 className="text-xl font-bold mb-2">הקבוצות</h2>
      <div className="grid gap-3">
        {[0, 1, 2].map((t) => (
          <div key={t} className="bg-white rounded-lg border border-stone-200">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200">
              <span className="w-4 h-4 rounded-full border border-stone-400" style={{ background: CSS_COLORS[colors[t]] || '#57534e' }} />
              <h3 className="font-bold">{colors[t] ?? `קבוצה ${t + 1}`}</h3>
            </div>
            <ul className="px-3 py-2">
              {players.filter((p) => p.team_index === t).map((p) => <li key={p.id}>{p.player_name}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------- Public ---------- */
function Player() {
  const { settings, confirmed } = useLive()
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg('')
    const { error } = await supabase.from('registrations').insert({ player_name: name.trim(), status: 'pending' })
    setBusy(false)
    if (error) return setMsg('ההרשמה נכשלה. בדקו שהשם באורך 2–40 תווים ונסו שוב.')
    setName(''); setMsg('נרשמת! הארגון יאשר אותך בקרוב.')
  }

  if (!settings) return <Shell title="טוען…" />
  const parts = (settings.match_time || '').split(',').map((s) => s.trim()).filter(Boolean)
  const matchDay = parts[0] || ''
  const matchHour = parts.slice(1).join(', ')
  return (
    <Shell title={settings.title || 'כדורגל וייסגל'}>
      <section className="bg-white/90 rounded-2xl shadow-md px-4 py-5 text-center space-y-3">
        <div className="flex items-center justify-center gap-2 text-2xl font-extrabold text-pitch">
          <CalendarIcon />{matchDay}
        </div>
        {matchHour && (
          <div className="flex items-center justify-center gap-2 text-2xl font-extrabold text-pitch">
            <ClockIcon /><span dir="ltr">{matchHour}</span>
          </div>
        )}
        <div className="flex items-center justify-center gap-2 text-xl font-bold">
          <PinIcon />{settings.location}
        </div>
      </section>

      <section>
        <a href={settings.bit_link} target="_blank" rel="noreferrer"
          className="block text-center bg-bib text-white font-bold text-xl rounded-xl py-4 shadow-md">
          תשלום ב-Bit · {settings.price} ₪
        </a>
        <p className="mt-2 text-sm text-stone-600 text-center">אם משלמים ב-Bit מחשבון אחר, יש לציין בהערה את שם השחקן</p>
      </section>

      {settings.teams_published && <Teams colors={settings.team_colors} players={confirmed} />}

      <form onSubmit={submit} className="space-y-3">
        <label className="block font-medium text-center" htmlFor="n">שם מלא</label>
        <input id="n" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-3" />
        <button disabled={busy} className={`${btn} w-full bg-pitch text-chalk`}>הירשם למשחק</button>
        {msg && <p className="text-sm" role="status">{msg}</p>}
      </form>

      <section>
        <h2 className="text-xl font-bold mb-2">מגיעים ({confirmed.length}/{CAP})</h2>
        {confirmed.length === 0 && <p className="text-stone-500">עדיין אין מאושרים. הירשמו למעלה.</p>}
        <ul className="divide-y divide-stone-200 bg-white rounded-lg">
          {confirmed.map((p) => (
            <li key={p.id} className="flex justify-between px-3 py-2">
              <span>{p.player_name}</span>
              <span className={p.is_paid ? 'text-green-700' : 'text-stone-500'}>
                {p.is_paid ? 'שולם' : <>לא שולם · <Countdown since={p.approved_at} /></>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  )
}

/* ---------- Admin ---------- */
function Admin() {
  const [pin, setPin] = useState(sessionStorage.getItem('pin') || '')
  const [authed, setAuthed] = useState(false)
  const [err, setErr] = useState('')
  const { settings, reload } = useLive()
  const [rows, setRows] = useState([])
  const [draft, setDraft] = useState(null)
  const [ratings, setRatings] = useState({})
  const [next, setNext] = useState(null)
  const tried = useRef(false)

  const refresh = useCallback(async (p = pin) => {
    const [r, rt] = await Promise.all([rpc('admin_list_registrations', { p_pin: p }), rpc('admin_get_ratings', { p_pin: p })])
    setRows(r)
    setRatings(Object.fromEntries(rt.map((x) => [x.player_name, x.rating])))
  }, [pin])

  const login = async (e) => {
    e?.preventDefault()
    try {
      if (!(await rpc('check_pin', { p_pin: pin }))) throw new Error()
      sessionStorage.setItem('pin', pin); setAuthed(true); setErr(''); refresh(pin)
    } catch { setErr('קוד שגוי'); sessionStorage.removeItem('pin') }
  }
  useEffect(() => { if (pin) login() }, []) // eslint-disable-line
  useEffect(() => { if (authed) { const t = setInterval(refresh, 10000); return () => clearInterval(t) } }, [authed, refresh])
  useEffect(() => {
    if (settings && !draft) setDraft({ ...settings, team_colors: settings.team_colors.join(', ') })
  }, [settings, draft])
  useEffect(() => {
    if (settings && !next) setNext({ match_time: settings.match_time, price: settings.price, bit_link: settings.bit_link })
  }, [settings, next])

  // Teams: drafts are admin-only until published
  const confirmedRows = rows.filter((r) => r.status === 'confirmed')
  const colors = settings?.team_colors || []
  const rOf = (r) => ratings[r.player_name] ?? 3 // unrated players count as 3
  const teamRows = (t) => confirmedRows.filter((r) => r.draft_team === t)
  const readyToPublish = confirmedRows.length === CAP && [0, 1, 2].every((t) => teamRows(t).length === 5)

  const runBalance = async () => {
    const teams = balance(confirmedRows.map(rOf))
    const assignments = teams.flatMap((idxs, t) => idxs.map((i) => ({ id: confirmedRows[i].id, team_index: t })))
    await act('admin_apply_teams', { p_assignments: assignments })()
  }
  useEffect(() => { // auto-balance once, when the 15th player is confirmed and nobody is assigned yet
    if (confirmedRows.length < CAP) tried.current = false
    else if (!tried.current && confirmedRows.every((r) => r.draft_team == null)) { tried.current = true; runBalance() }
  }, [rows, ratings]) // eslint-disable-line

  const setRating = async (name, v) => {
    setRatings((m) => ({ ...m, [name]: v }))
    try { await rpc('admin_set_rating', { p_pin: pin, p_name: name, p_rating: v }) }
    catch { alert('שמירת הדירוג נכשלה'); refresh() }
  }
  const rate = (r) => (
    <select aria-label={`דירוג ${r.player_name}`} value={ratings[r.player_name] ?? ''}
      onChange={(e) => setRating(r.player_name, Number(e.target.value))}
      className="rounded border border-stone-300 bg-white px-1 py-1">
      <option value="" disabled>דירוג</option>
      {RATING_STEPS.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  )
  const teamSelect = (r) => (
    <select aria-label={`קבוצה של ${r.player_name}`} value={r.draft_team ?? ''}
      onChange={(e) => act('admin_set_team', { p_id: r.id, p_team: e.target.value === '' ? null : Number(e.target.value) })()}
      className="rounded border border-stone-300 bg-white px-1 py-1">
      <option value="">ללא קבוצה</option>
      {[0, 1, 2].map((t) => <option key={t} value={t}>{colors[t] ?? `קבוצה ${t + 1}`}</option>)}
    </select>
  )
  const doReset = async (e) => {
    e.preventDefault()
    if (!confirm('לאפס את המשחק? כל ההרשמות יימחקו והקבוצות יוסרו. הדירוגים יישמרו.')) return
    await act('admin_reset_match', { p_match_time: next.match_time, p_price: Number(next.price), p_bit_link: next.bit_link })()
    setDraft(null)
  }

  const act = (fn, args) => async () => {
    try { await rpc(fn, { p_pin: pin, ...args }); await Promise.all([refresh(), reload()]) }
    catch (e) { alert(e.message === 'confirmed list is full' ? 'רשימת המגיעים מלאה' : 'הפעולה נכשלה') }
  }

  const saveSettings = async (e) => {
    e.preventDefault()
    await act('admin_update_settings', {
      p_location: draft.location, p_match_time: draft.match_time, p_price: Number(draft.price),
      p_bit_link: draft.bit_link,
      p_team_colors: draft.team_colors.split(',').map((s) => s.trim()).filter(Boolean),
    })()
  }

  if (!authed) return (
    <Shell title="ניהול">
      <form onSubmit={login} className="space-y-3">
        <label htmlFor="p" className="block font-medium">קוד מנהל</label>
        <input id="p" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-3" />
        <button className={`${btn} w-full bg-pitch text-chalk`}>כניסה</button>
        {err && <p className="text-red-700" role="alert">{err}</p>}
      </form>
    </Shell>
  )

  const by = (s) => rows.filter((r) => r.status === s)
  const List = ({ title, items, children }) => (
    <section>
      <h2 className="text-xl font-bold mb-2">{title} ({items.length})</h2>
      {items.length === 0 && <p className="text-stone-500">אין שחקנים ברשימה.</p>}
      <ul className="divide-y divide-stone-200 bg-white rounded-lg">
        {items.map((r) => (
          <li key={r.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span>{r.player_name}</span><div className="flex gap-2 items-center">{children(r)}</div>
          </li>
        ))}
      </ul>
    </section>
  )
  const remove = (r) => <button className={`${btn} text-red-700`} onClick={() => confirm(`להסיר את ${r.player_name}?`) && act('admin_remove', { p_id: r.id })()}>הסר</button>
  const field = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2'

  return (
    <Shell title="ניהול משחק">
      <List title="ממתינים לאישור" items={by('pending')}>
        {(r) => <>
          {rate(r)}<button className={`${btn} bg-pitch text-chalk`} onClick={act('admin_approve', { p_id: r.id })}>אשר</button>{remove(r)}
        </>}
      </List>
      <List title="מגיעים" items={by('confirmed')}>
        {(r) => <>
          {rate(r)}
          <select aria-label={`סטטוס תשלום ${r.player_name}`} value={r.is_paid ? 'true' : 'false'}
            onChange={(e) => act('admin_set_paid', { p_id: r.id, p_paid: e.target.value === 'true' })()}
            className={`rounded border px-1 py-1 ${r.is_paid ? 'bg-green-50 text-green-800 border-green-300' : 'bg-red-50 text-red-800 border-red-300'}`}>
            <option value="false">לא שולם</option>
            <option value="true">שולם</option>
          </select>
          {!r.is_paid && <span className="text-sm text-stone-600"><Countdown since={r.approved_at} /></span>}
          {remove(r)}
        </>}
      </List>
      <List title="רשימת מזמינים" items={by('waitlist')}>
        {(r) => <>
          <button className={`${btn} bg-bib text-white`} disabled={by('confirmed').length >= CAP}
            onClick={act('admin_promote', { p_id: r.id })}>העבר למגיעים</button>{remove(r)}
        </>}
      </List>

      {settings && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">קבוצות</h2>
          <div className="flex gap-2 flex-wrap">
            <button className={`${btn} bg-pitch text-chalk`} disabled={confirmedRows.length !== CAP} onClick={runBalance}>חלק כוחות אוטומטית</button>
            <button className={`${btn} ${settings.teams_published ? 'bg-stone-300' : 'bg-bib text-white'}`}
              disabled={!settings.teams_published && !readyToPublish}
              onClick={act('admin_publish_teams', { p_published: !settings.teams_published })}>
              {settings.teams_published ? 'בטל פרסום' : 'פרסם קבוצות'}
            </button>
          </div>
          {confirmedRows.length !== CAP && <p className="text-sm text-stone-600">חלוקה אוטומטית זמינה כשיש 15 מגיעים ({confirmedRows.length}/{CAP}).</p>}
          {confirmedRows.length === CAP && !readyToPublish && <p className="text-sm text-stone-600">לפרסום נדרשות 3 קבוצות של 5 שחקנים.</p>}
          {settings.teams_published && <p className="text-sm text-green-700">הקבוצות מפורסמות. שינויים נראים לשחקנים מיד.</p>}
          {[0, 1, 2].map((t) => (
            <div key={t} className="bg-white rounded-lg p-3">
              <div className="flex justify-between font-bold mb-1">
                <span>{colors[t] ?? `קבוצה ${t + 1}`}</span>
                <span className="font-normal text-sm">{teamRows(t).length} שחקנים · סכום {fmtSum(teamRows(t).reduce((s, r) => s + rOf(r), 0))} · ממוצע {fmtAvg(teamRows(t).reduce((s, r) => s + rOf(r), 0), teamRows(t).length)}</span>
              </div>
              {teamRows(t).map((r) => (
                <div key={r.id} className="flex justify-between items-center py-1"><span>{r.player_name} ({rOf(r)})</span>{teamSelect(r)}</div>
              ))}
            </div>
          ))}
          {confirmedRows.some((r) => r.draft_team == null) && (
            <div className="bg-white rounded-lg p-3">
              <div className="font-bold mb-1">ללא קבוצה</div>
              {confirmedRows.filter((r) => r.draft_team == null).map((r) => (
                <div key={r.id} className="flex justify-between items-center py-1"><span>{r.player_name} ({rOf(r)})</span>{teamSelect(r)}</div>
              ))}
            </div>
          )}
        </section>
      )}

      {draft && (
        <form onSubmit={saveSettings} className="space-y-3">
          <h2 className="text-xl font-bold">הגדרות משחק</h2>
          {[['location', 'מיקום'], ['match_time', 'זמן'], ['price', 'מחיר (₪)'], ['bit_link', 'קישור Bit'], ['team_colors', 'צבעי קבוצות (מופרדים בפסיק)']].map(([k, label]) => (
            <label key={k} className="block"><span className="text-sm">{label}</span>
              <input className={field} value={draft[k]} type={k === 'price' ? 'number' : 'text'}
                dir={k === 'bit_link' ? 'ltr' : undefined} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            </label>
          ))}
          <button className={`${btn} w-full bg-pitch text-chalk`}>שמור הגדרות</button>
        </form>
      )}
      {next && (
        <form onSubmit={doReset} className="space-y-3 border-t border-stone-300 pt-5">
          <h2 className="text-xl font-bold">איפוס משחק לשבוע הבא</h2>
          <p className="text-sm text-stone-600">מוחק את כל ההרשמות ומבטל פרסום קבוצות. הדירוגים נשמרים.</p>
          {[['match_time', 'תאריך וזמן המשחק הבא'], ['price', 'מחיר (₪)'], ['bit_link', 'קישור Bit']].map(([k, label]) => (
            <label key={k} className="block"><span className="text-sm">{label}</span>
              <input className={field} value={next[k]} type={k === 'price' ? 'number' : 'text'}
                dir={k === 'bit_link' ? 'ltr' : undefined} onChange={(e) => setNext({ ...next, [k]: e.target.value })} />
            </label>
          ))}
          <button className={`${btn} w-full bg-red-700 text-white`}>איפוס משחק לשבוע הבא</button>
        </form>
      )}
    </Shell>
  )
}

export default function App() {
  return location.pathname.startsWith('/admin') ? <Admin /> : <Player />
}
