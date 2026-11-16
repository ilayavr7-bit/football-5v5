import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, rpc } from './supabase'
import { balance } from './balance'

const CAP = 15
const RATING_STEPS = Array.from({ length: 9 }, (_, i) => 1 + i / 2) // 1, 1.5, ... 5
const fmtAvg = (sum, n) => (n ? (sum / n).toFixed(1) : '–')
const HOURS_48 = 48 * 3600e3

const ROLES = ['מאוזן', 'הגנה / שוער', 'קישור / פליימייקר', 'התקפה / סקורר', 'כושר / רץ']
const ROLE_POS = {
  'מאוזן': 'CM',
  'הגנה / שוער': 'CB',
  'קישור / פליימייקר': 'CAM',
  'התקפה / סקורר': 'ST',
  'כושר / רץ': 'RM',
}
const STATS = [['pac', 'PAC'], ['sho', 'SHO'], ['pas', 'PAS'], ['dri', 'DRI'], ['def', 'DEF'], ['phy', 'PHY']]
const PLAYSTYLES = [
  ['Power Shot', '⚽', 'בעיטה חזקה (Power Shot+)'],
  ['Finesse Shot', '🎯', 'בעיטה מסובבת (Finesse Shot+)'],
  ['Quick Step', '🚀', 'צעד ראשון מהיר (Quick Step+)'],
  ['Rapid', '💨', 'ספרינטר (Rapid+)'],
  ['Incisive Pass', '📐', 'מסירת עומק (Incisive Pass+)'],
  ['Tiki Taka', '🔄', 'טיקי טאקה (Tiki Taka+)'],
  ['Technical', '🪄', 'טכניקה ודריבל (Technical+)'],
  ['First Touch', '🧲', 'עצירה ראשונה (First Touch+)'],
  ['Anticipate', '🛡️', 'חטיפה וקריאת משחק (Anticipate+)'],
  ['Bruiser', '💪', 'פיזיות וכתף (Bruiser+)'],
  ['Relentless', '🔋', 'כושר בלתי נגמר (Relentless+)'],
  ['GK Reflexes', '🧤', 'רפלקסים בשער (GK Reflexes+)'],
]
const psIcon = (key) => PLAYSTYLES.find(([k]) => k === key)?.[1] || '⚽'
const psLabel = (key) => PLAYSTYLES.find(([k]) => k === key)?.[2] || key

const DEFAULT_CARD = {
  rating: 3, role: 'מאוזן', height_cm: 175,
  pac: 70, sho: 70, pas: 70, dri: 70, def: 70, phy: 70,
  photo_url: '', playstyle_plus: '', playstyles: [],
  skill_moves: 3, weak_foot: 3,
}

const TIERS = {
  bronze: {
    bg: 'linear-gradient(145deg,#edd1b0 0%,#b87d52 45%,#784825 100%)',
    fg: '#2c1708', border: '#8a542d', line: 'rgba(44,23,8,0.25)',
    psBg: 'linear-gradient(135deg,#f5dec3,#b87d52)', psBorder: '#2c1708',
  },
  silver: {
    bg: 'linear-gradient(145deg,#ffffff 0%,#cfd6df 45%,#8893a0 100%)',
    fg: '#1a222b', border: '#8c97a4', line: 'rgba(26,34,43,0.22)',
    psBg: 'linear-gradient(135deg,#ffffff,#b8c2ce)', psBorder: '#1a222b',
  },
  gold: {
    bg: 'linear-gradient(140deg,#fff6b3 0%,#f0cf65 38%,#c99826 78%,#9c7011 100%)',
    fg: '#2d2106', border: '#c4982b', line: 'rgba(45,33,6,0.22)',
    psBg: 'linear-gradient(135deg,#fff3a6,#d8a832)', psBorder: '#2d2106',
  },
  totw: {
    bg: 'linear-gradient(145deg,#2e2a22 0%,#141310 55%,#4a3a14 100%)',
    fg: '#f7db7c', border: '#d4af37', line: 'rgba(247,219,124,0.28)',
    psBg: 'linear-gradient(135deg,#2b2518,#12100b)', psBorder: '#f7db7c', badge: 'TOTW',
  },
  potm: {
    bg: 'linear-gradient(145deg,#3e0d75 0%,#15082b 55%,#0b556e 100%)',
    fg: '#fae8a0', border: '#38bdf8', line: 'rgba(56,189,248,0.32)',
    psBg: 'linear-gradient(135deg,#29094d,#0b3b52)', psBorder: '#fae8a0', badge: 'POTM',
  },
}

const AWARDS = [
  ['top_scorer', '⚽', 'מלך שערים'],
  ['mvp_star', '⭐', 'כוכב המחזור'],
  ['best_duo', '🥅', 'שער המחזור'],
]

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)))
const statAvg = (c) => STATS.reduce((s, [k]) => s + (Number(c[k]) || 40), 0) / 6
const ovrOf = (c) => clamp(statAvg(c), 40, 99)
const tierOf = (ovr) => (ovr >= 75 ? 'gold' : ovr >= 65 ? 'silver' : 'bronze')
const ratingFromStats = (c) => Math.min(5, Math.max(1, Math.round((1 + 4 * ((statAvg(c) - 40) / 59)) * 2) / 2))

function useLive() {
  const [settings, setSettings] = useState(null)
  const [confirmed, setConfirmed] = useState([])
  const [awards, setAwards] = useState(null)
  const [featuredCards, setFeaturedCards] = useState({})

  const load = useCallback(async () => {
    await supabase.rpc('expire_unpaid')
    const [s, r, a, fc] = await Promise.all([
      supabase.from('match_settings').select('*').eq('id', 1).single(),
      supabase.from('registrations').select('*').eq('status', 'confirmed').order('approved_at'),
      supabase.from('matchweek_awards').select('*').eq('id', 1).maybeSingle(),
      supabase.rpc('get_featured_cards').then((res) => res.data || [], () => []),
    ])
    if (s.data) setSettings(s.data)
    if (r.data) setConfirmed(r.data)
    setAwards(a.data || null)
    if (fc) setFeaturedCards(Object.fromEntries(fc.map((x) => [x.player_name, x])))
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_settings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchweek_awards' }, load)
      .subscribe()
    const poll = setInterval(load, 30000)
    return () => { supabase.removeChannel(ch); clearInterval(poll) }
  }, [load])
  return { settings, confirmed, awards, featuredCards, reload: load }
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

/* ---------- Authentic EA FC 25/26/27 Card Component ---------- */
function FutCard({ name, card, variant = 'auto', boost = 0, compact = false, interactivePhoto = null }) {
  const c = { ...DEFAULT_CARD, ...card }
  const baseOvr = ovrOf(c)
  const ovr = clamp(baseOvr + boost, 40, 99)
  const t = TIERS[variant === 'auto' ? tierOf(ovr) : variant] || TIERS.gold
  const posCode = ROLE_POS[c.role] || 'CM'
  const sm = clamp(c.skill_moves ?? 3, 1, 5)
  const wf = clamp(c.weak_foot ?? 3, 1, 5)

  // Interactive PlayStyle+ banner state (shows on tap/click, auto-hides after 3 seconds)
  const [showPsBanner, setShowPsBanner] = useState(false)
  const psTimerRef = useRef(null)

  const togglePsBanner = (e) => {
    e.stopPropagation()
    if (psTimerRef.current) clearTimeout(psTimerRef.current)
    setShowPsBanner((prev) => {
      const nextState = !prev
      if (nextState) {
        psTimerRef.current = setTimeout(() => setShowPsBanner(false), 3000)
      }
      return nextState
    })
  }

  useEffect(() => {
    setShowPsBanner(false)
    return () => { if (psTimerRef.current) clearTimeout(psTimerRef.current) }
  }, [c.playstyle_plus])

  return (
    <div className={`relative mx-auto select-none ${compact ? 'w-full max-w-[184px] py-2' : 'w-64 py-3'}`}>
      {/* Main Shield Card Container */}
      <div
        dir="ltr"
        className={`relative rounded-t-[28px] rounded-b-[22px] border-2 shadow-xl ${compact ? 'px-2.5 pt-2.5 pb-3' : 'px-4 pt-3.5 pb-4'}`}
        style={{
          background: t.bg,
          color: t.fg,
          borderColor: t.border,
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.35), inset 0 1px 2px rgba(255,255,255,0.45)',
        }}
      >
        {/* Subtle diagonal metallic sheen lines like authentic FUT cards */}
        <div
          className="absolute inset-0 pointer-events-none rounded-t-[26px] rounded-b-[20px] opacity-25"
          style={{
            backgroundImage: 'repeating-linear-gradient(135deg, transparent 0px, transparent 14px, rgba(255,255,255,0.22) 14px, rgba(255,255,255,0.22) 16px)',
          }}
        />

        {/* Top TOTW / POTM Header Pill */}
        {t.badge && (
          <div
            className="relative z-10 text-[9px] font-black tracking-widest uppercase text-center rounded-full px-2.5 py-0.5 mb-1 mx-auto w-fit"
            style={{ background: 'rgba(0,0,0,0.28)', border: `1px solid ${t.border}` }}
          >
            ★ {t.badge} ★
          </div>
        )}

        {/* Authentic EA FC PlayStyle+ Badge protruding from the left border (Clickable) */}
        {c.playstyle_plus && (
          <>
            <button
              type="button"
              onClick={togglePsBanner}
              title="לחץ להצגת שם ה-PlayStyle+"
              className={`
                absolute z-30 flex items-center justify-center rotate-45 rounded-[6px] shadow-lg cursor-pointer
                transition-transform active:scale-95
                ${compact ? '-left-2.5 top-[44%] w-7 h-7' : '-left-3.5 top-[45%] w-10 h-10'}
              `}
              style={{
                background: t.psBg,
                border: `2px solid ${t.psBorder}`,
                boxShadow: '0 4px 10px rgba(0,0,0,0.38)',
                color: t.fg,
              }}
            >
              <div
                className="w-[82%] h-[82%] rounded-[3px] flex items-center justify-center"
                style={{ border: `1px solid ${t.psBorder}` }}
              >
                <span className={`-rotate-45 leading-none ${compact ? 'text-xs' : 'text-base'}`}>
                  {psIcon(c.playstyle_plus)}
                </span>
              </div>
              {/* Plus sign on the right corner of the diamond */}
              <span
                className="-rotate-45 absolute -top-1 -right-1 text-[9px] font-black leading-none px-0.5 rounded-sm"
                style={{ background: t.psBorder, color: variant === 'totw' || variant === 'potm' ? '#111' : '#fff7cc' }}
              >
                +
              </span>
            </button>

            {/* Semi-transparent floating banner showing full PlayStyle+ name when tapped */}
            {showPsBanner && (
              <div
                dir="rtl"
                onClick={togglePsBanner}
                className={`
                  absolute z-40 left-3 right-3 top-[38%] mx-auto w-fit max-w-[92%]
                  rounded-xl px-3 py-1.5 text-center shadow-2xl cursor-pointer
                  backdrop-blur-md border border-amber-300/70
                  ${compact ? 'text-[11px]' : 'text-xs'} font-extrabold text-amber-100
                `}
                style={{ background: 'rgba(15, 15, 15, 0.84)' }}
              >
                <span className="ml-1">{psIcon(c.playstyle_plus)}</span>
                <span>{psLabel(c.playstyle_plus)}</span>
              </div>
            )}
          </>
        )}

        {/* Upper Area: Left OVR + Position + ++ | Center/Right Player Portrait */}
        <div className={`relative z-10 flex items-start justify-between ${compact ? 'h-24' : 'h-36'}`}>
          {/* Top-Left OVR & Position stack */}
          <div className="flex flex-col items-center text-center leading-none pt-0.5 pl-0.5 z-20">
            <div className={`${compact ? 'text-2xl' : 'text-4xl'} font-black tracking-tight`}>{ovr}</div>
            <div className={`${compact ? 'text-xs' : 'text-sm'} font-extrabold tracking-wide mt-0.5`}>{posCode}</div>
            <div className="text-[10px] font-black tracking-tighter opacity-85">++</div>
          </div>

          {/* Center-Right Portrait */}
          <div className="absolute inset-0 flex items-center justify-center pl-6 pointer-events-none">
            {interactivePhoto ? (
              <div className="pointer-events-auto">{interactivePhoto}</div>
            ) : c.photo_url ? (
              <div
                className={`${compact ? 'w-20 h-20' : 'w-32 h-32'} rounded-full overflow-hidden border-2 shadow-md`}
                style={{ borderColor: t.border }}
              >
                <img src={c.photo_url} alt={name} className="w-full h-full object-cover" draggable={false} />
              </div>
            ) : (
              <div
                className={`${compact ? 'w-16 h-16' : 'w-24 h-24'} rounded-full flex items-center justify-center opacity-30`}
                style={{ background: t.line }}
              >
                <svg viewBox="0 0 24 24" className="w-3/4 h-3/4" fill="currentColor">
                  <circle cx="12" cy="8" r="4.5" />
                  <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Player Name Bar */}
        <div
          className="relative z-10 text-center border-t pt-1.5 mt-1"
          style={{ borderColor: t.line }}
          dir="auto"
        >
          <div className={`${compact ? 'text-sm' : 'text-xl'} font-black tracking-tight truncate`}>
            {name || '—'}
          </div>
        </div>

        {/* 6 Stats in a Single Horizontal Row (PAC SHO PAS DRI DEF PHY) */}
        <div
          className="relative z-10 grid grid-cols-6 gap-0.5 border-t pt-1.5 mt-1 text-center"
          style={{ borderColor: t.line }}
        >
          {STATS.map(([k, label]) => (
            <div key={k} className="flex flex-col items-center leading-tight">
              <span className={`${compact ? 'text-[8px]' : 'text-[10px]'} font-bold opacity-80 tracking-tighter`}>
                {label}
              </span>
              <span className={`${compact ? 'text-xs' : 'text-base'} font-black`}>
                {clamp((Number(c[k]) || 70) + boost, 40, 99)}
              </span>
            </div>
          ))}
        </div>

        {/* Subtle Role Subtitle inside card footer */}
        <div className="relative z-10 text-center mt-1">
          <span className="text-[10px] font-bold opacity-75">{c.role}</span>
        </div>
      </div>

      {/* Bottom EA FC Metadata Pill: Skill Moves (★) | Weak Foot (🦶) | Height */}
      <div
        dir="ltr"
        className={`
          relative z-20 mx-auto -mt-2.5 w-fit flex items-center divide-x rounded-md border shadow-md font-extrabold
          ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-0.5'}
        `}
        style={{
          background: t.bg,
          color: t.fg,
          borderColor: t.psBorder,
        }}
      >
        <span className="px-1.5 flex items-center gap-0.5" title="Skill Moves (סקילס)">
          {sm}<span>★</span>
        </span>
        <span className="px-1.5 flex items-center gap-0.5" title="Weak Foot (רגל חלשה)">
          {wf}<span className="text-[11px] leading-none">🦶</span>
        </span>
        <span className="px-1.5" title="גובה">
          {clamp(c.height_cm, 150, 210)}cm
        </span>
      </div>
    </div>
  )
}

/* ---------- Public Page ---------- */
function Player() {
  const { settings, confirmed, awards, featuredCards } = useLive()
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

      {/* Matchweek Honors with TOTW In-Form Cards */}
      {awards?.awards_published && AWARDS.some(([k]) => awards[k]) && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold text-center">נתוני מחזור 🔥</h2>
          <p className="text-xs text-stone-500 text-center">לחצו על יהלום ה-PlayStyle+ שעל הקלף כדי לראות את היכולת המיוחדת</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {AWARDS.map(([k, icon, label]) => {
              const pName = awards[k]
              if (!pName) return null
              return (
                <div key={k} className="bg-white/95 rounded-2xl shadow-sm border border-stone-200 p-3 text-center space-y-1">
                  <div className="text-sm font-extrabold text-stone-700">{icon} {label}</div>
                  <FutCard name={pName} card={featuredCards[pName]} variant="totw" boost={2} compact />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Player of the Month (POTM) Showcase */}
      {awards?.potm_published && awards?.potm_player && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold text-center">שחקן החודש 🏆</h2>
          <div className="bg-gradient-to-b from-purple-950/90 to-slate-900 rounded-2xl shadow-lg p-4 text-center">
            <FutCard name={awards.potm_player} card={featuredCards[awards.potm_player]} variant="potm" boost={3} />
          </div>
        </section>
      )}
    </Shell>
  )
}

/* ---------- Admin: FC Card Builder with Live Photo Cropper, PlayStyle+ & Skill/Weak Foot ---------- */
function FcCardModal({ name, initial, onSave, onClose }) {
  const [c, setC] = useState({
    ...DEFAULT_CARD,
    ...initial,
    skill_moves: initial?.skill_moves ?? 3,
    weak_foot: initial?.weak_foot ?? 3,
  })
  const [busy, setBusy] = useState(false)

  // Live interactive image crop/pan/zoom state
  const [rawImg, setRawImg] = useState(null)
  const [zoom, setZoom] = useState(1.2)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const fileInputRef = useRef(null)

  const set = (k, v) => setC((x) => ({ ...x, [k]: v }))

  const onSelectFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        setRawImg(img)
        setZoom(1.2)
        setOffset({ x: 0, y: 0 })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  const startDrag = (clientX, clientY) => {
    if (!rawImg) return
    dragRef.current = { startX: clientX - offset.x, startY: clientY - offset.y }
  }
  const moveDrag = (clientX, clientY) => {
    if (!dragRef.current) return
    setOffset({
      x: clamp(clientX - dragRef.current.startX, -120, 120),
      y: clamp(clientY - dragRef.current.startY, -120, 120),
    })
  }
  const endDrag = () => { dragRef.current = null }

  const renderCroppedDataUrl = () => {
    if (!rawImg) return c.photo_url || ''
    const SIZE = 240
    const PREVIEW_SIZE = 128
    const ratio = SIZE / PREVIEW_SIZE
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')

    const baseScale = Math.max(SIZE / rawImg.width, SIZE / rawImg.height)
    const drawW = rawImg.width * baseScale * zoom
    const drawH = rawImg.height * baseScale * zoom
    const dx = (SIZE - drawW) / 2 + offset.x * ratio
    const dy = (SIZE - drawH) / 2 + offset.y * ratio

    ctx.drawImage(rawImg, dx, dy, drawW, drawH)
    return canvas.toDataURL('image/jpeg', 0.82)
  }

  const input = 'w-16 rounded border border-stone-300 bg-white px-1 py-1 text-center'

  const save = async () => {
    setBusy(true)
    const finalPhoto = renderCroppedDataUrl()
    const out = {
      ...c,
      height_cm: clamp(c.height_cm, 150, 210),
      photo_url: finalPhoto,
      playstyle_plus: c.playstyle_plus || '',
      playstyles: [],
      skill_moves: clamp(c.skill_moves ?? 3, 1, 5),
      weak_foot: clamp(c.weak_foot ?? 3, 1, 5),
    }
    STATS.forEach(([k]) => { out[k] = clamp(c[k], 40, 99) })
    await onSave(out)
    setBusy(false)
  }

  const interactivePhotoNode = rawImg ? (
    <div
      onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
      onMouseMove={(e) => moveDrag(e.clientX, e.clientY)}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onTouchStart={(e) => {
        const t = e.touches[0]
        if (t) startDrag(t.clientX, t.clientY)
      }}
      onTouchMove={(e) => {
        const t = e.touches[0]
        if (t) moveDrag(t.clientX, t.clientY)
      }}
      onTouchEnd={endDrag}
      className="w-32 h-32 rounded-full overflow-hidden border-2 border-amber-400 cursor-move relative touch-none shadow-inner bg-black/20"
      title="גרור להזזת התמונה"
    >
      <img
        src={rawImg.src}
        alt="תצוגה מקדימה"
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      />
    </div>
  ) : null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-chalk w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <FutCard name={name} card={c} interactivePhoto={interactivePhotoNode} />

        {/* Photo Upload & Live Zoom/Drag Controls */}
        <div className="bg-white rounded-xl p-3 border border-stone-200 space-y-2">
          <div className="flex gap-2 justify-center flex-wrap">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onSelectFile} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg px-3 py-1.5 text-sm font-medium bg-stone-800 text-white">
              📷 העלה / החלף תמונה
            </button>
            {(rawImg || c.photo_url) && (
              <button type="button" onClick={() => { setRawImg(null); set('photo_url', '') }} className="rounded-lg px-3 py-1.5 text-sm font-medium bg-red-50 text-red-700 border border-red-200">
                הסר תמונה
              </button>
            )}
          </div>
          {rawImg && (
            <div className="space-y-1 pt-1">
              <p className="text-xs text-stone-600 text-center">גרור את התמונה בתוך העיגול למעלה וכוונן את הזום:</p>
              <label className="flex items-center gap-2 text-xs font-bold">
                <span>זום</span>
                <input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" />
                <span dir="ltr">{zoom.toFixed(1)}x</span>
              </label>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-stone-600">דירוג מחושב מהקלף: <b>{ratingFromStats(c)}</b> (נשמר בעת שמירת הקלף)</p>

        {/* 6 Stats Sliders */}
        {STATS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <span className="w-10 text-sm font-bold" dir="ltr">{label}</span>
            <input type="range" min="40" max="99" value={clamp(c[k], 40, 99)} onChange={(e) => set(k, Number(e.target.value))} className="flex-1" />
            <input type="number" min="40" max="99" value={c[k]} className={input}
              onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} onBlur={() => set(k, clamp(c[k], 40, 99))} />
          </label>
        ))}

        {/* Height & Tactical Role */}
        <label className="flex items-center gap-2">
          <span className="w-10 text-sm font-bold">גובה</span>
          <input type="range" min="150" max="210" value={clamp(c.height_cm, 150, 210)} onChange={(e) => set('height_cm', Number(e.target.value))} className="flex-1" />
          <input type="number" min="150" max="210" value={c.height_cm} className={input}
            onChange={(e) => set('height_cm', e.target.value === '' ? '' : Number(e.target.value))} onBlur={() => set('height_cm', clamp(c.height_cm, 150, 210))} />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-10 text-sm font-bold">תפקיד</span>
          <select value={c.role} onChange={(e) => set('role', e.target.value)} className="flex-1 rounded border border-stone-300 bg-white px-2 py-2">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>

        {/* Skill Moves (1-5★) & Weak Foot (1-5★) + PlayStyle+ */}
        <div className="bg-white rounded-xl p-3 border border-stone-200 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-xs font-bold text-stone-700 mb-1">★ סקילס (Skill Moves)</span>
              <div className="flex gap-1" dir="ltr">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set('skill_moves', n)}
                    className={`flex-1 py-1 rounded text-xs font-extrabold border transition ${
                      (c.skill_moves ?? 3) === n
                        ? 'bg-amber-500 text-stone-950 border-amber-600'
                        : 'bg-stone-50 text-stone-600 border-stone-300'
                    }`}
                  >
                    {n}★
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-xs font-bold text-stone-700 mb-1">🦶 רגל חלשה (Weak Foot)</span>
              <div className="flex gap-1" dir="ltr">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set('weak_foot', n)}
                    className={`flex-1 py-1 rounded text-xs font-extrabold border transition ${
                      (c.weak_foot ?? 3) === n
                        ? 'bg-amber-500 text-stone-950 border-amber-600'
                        : 'bg-stone-50 text-stone-600 border-stone-300'
                    }`}
                  >
                    {n}★
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="block pt-1 border-t border-stone-100">
            <span className="text-sm font-bold text-amber-800">◆ PlayStyle+ (לחיצה על היהלום בקלף מציגה את השם)</span>
            <select
              value={c.playstyle_plus || ''}
              onChange={(e) => set('playstyle_plus', e.target.value)}
              className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-2 text-sm font-medium"
            >
              <option value="">ללא PlayStyle+</option>
              {PLAYSTYLES.map(([k, ico, label]) => (
                <option key={k} value={k}>{ico} {label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-2">
          <button disabled={busy} onClick={save} className={`${btn} flex-1 bg-pitch text-chalk`}>שמור קלף</button>
          <button onClick={onClose} className={`${btn} bg-stone-200`}>סגור</button>
        </div>
      </div>
    </div>
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
  const [cardFor, setCardFor] = useState(null)
  const [awardsDraft, setAwardsDraft] = useState(null)
  const [awardsSaved, setAwardsSaved] = useState(null)
  const [next, setNext] = useState(null)
  const tried = useRef(false)

  const refresh = useCallback(async (p = pin) => {
    const [r, rt, aw] = await Promise.all([
      rpc('admin_list_registrations', { p_pin: p }),
      rpc('admin_get_ratings', { p_pin: p }),
      rpc('admin_get_awards', { p_pin: p }).catch(() => null),
    ])
    setRows(r)
    setRatings(Object.fromEntries(rt.map((x) => [x.player_name, x])))
    if (aw?.[0]) {
      setAwardsSaved(aw[0])
      setAwardsDraft((d) => d ?? {
        top_scorer: aw[0].top_scorer || '',
        mvp_star: aw[0].mvp_star || '',
        best_duo: aw[0].best_duo || '',
        potm_player: aw[0].potm_player || '',
      })
    }
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

  const confirmedRows = rows.filter((r) => r.status === 'confirmed')
  const allKnownNames = Array.from(new Set([...rows.map((r) => r.player_name), ...Object.keys(ratings)])).sort()
  const colors = settings?.team_colors || []
  const cardOf = (r) => ({ ...DEFAULT_CARD, ...ratings[r.player_name] })
  const rOf = (r) => Number(ratings[r.player_name]?.rating ?? 3)
  const teamInfo = (t) => {
    const rs = teamRows(t), n = rs.length, sum = (f) => rs.reduce((a, r) => a + f(r), 0)
    return `${n} שחקנים · דירוג ${fmtAvg(sum(rOf), n)} · OVR ${fmtAvg(sum((r) => ovrOf(cardOf(r))), n)} · גובה ${fmtAvg(sum((r) => Number(cardOf(r).height_cm)), n)} ס"מ`
  }
  const teamRows = (t) => confirmedRows.filter((r) => r.draft_team === t)
  const readyToPublish = confirmedRows.length === CAP && [0, 1, 2].every((t) => teamRows(t).length === 5)

  const runBalance = async () => {
    const teams = balance(confirmedRows.map((r) => ({ ...cardOf(r), rating: rOf(r) })))
    const assignments = teams.flatMap((idxs, t) => idxs.map((i) => ({ id: confirmedRows[i].id, team_index: t })))
    await act('admin_apply_teams', { p_assignments: assignments })()
  }
  useEffect(() => {
    if (confirmedRows.length < CAP) tried.current = false
    else if (!tried.current && confirmedRows.every((r) => r.draft_team == null)) { tried.current = true; runBalance() }
  }, [rows, ratings]) // eslint-disable-line

  const setRating = async (name, v) => {
    setRatings((m) => ({ ...m, [name]: { ...DEFAULT_CARD, ...m[name], player_name: name, rating: v } }))
    try { await rpc('admin_set_rating', { p_pin: pin, p_name: name, p_rating: v }) }
    catch { alert('שמירת הדירוג נכשלה'); refresh() }
  }
  const rate = (r) => (
    <select aria-label={`דירוג ${r.player_name}`} value={ratings[r.player_name]?.rating ?? ''}
      onChange={(e) => setRating(r.player_name, Number(e.target.value))}
      className="rounded border border-stone-300 bg-white px-1 py-1">
      <option value="" disabled>דירוג</option>
      {RATING_STEPS.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  )
  const smBtn = 'rounded-lg px-2 py-1 text-sm'
  const setRole = async (name, role) => {
    setRatings((m) => ({ ...m, [name]: { ...DEFAULT_CARD, ...m[name], player_name: name, role } }))
    try { await rpc('admin_set_role', { p_pin: pin, p_name: name, p_role: role }) }
    catch { alert('שמירת התפקיד נכשלה'); refresh() }
  }
  const roleSel = (r) => (
    <select aria-label={`תפקיד ${r.player_name}`} value={cardOf(r).role} onChange={(e) => setRole(r.player_name, e.target.value)}
      className="rounded border border-stone-300 bg-white px-1 py-1 max-w-32">
      {ROLES.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  )
  const saveCard = async (name, c) => {
    try {
      await rpc('admin_set_player_card', {
        p_pin: pin, p_name: name, p_role: c.role, p_height_cm: c.height_cm,
        p_pac: c.pac, p_sho: c.sho, p_pas: c.pas, p_dri: c.dri, p_def: c.def, p_phy: c.phy,
        p_photo_url: c.photo_url || '', p_playstyle_plus: c.playstyle_plus || '', p_playstyles: [],
        p_skill_moves: c.skill_moves ?? 3, p_weak_foot: c.weak_foot ?? 3,
      })
      await refresh()
      setCardFor(null)
    } catch { alert('שמירת הקלף נכשלה') }
  }
  const bulk = (message, fn, args) => () => confirm(message) && act(fn, args)()

  const saveAwards = (publish) => async () => {
    if (publish && !AWARDS.some(([k]) => awardsDraft[k]?.trim())) return alert('יש למלא לפחות קטגוריה אחת בנתוני המחזור')
    if (!publish && !confirm('לבטל פרסום ולהסתיר את נתוני המחזור?')) return
    await act('admin_save_awards', {
      p_top_scorer: awardsDraft.top_scorer || '',
      p_mvp_star: awardsDraft.mvp_star || '',
      p_best_duo: awardsDraft.best_duo || '',
      p_published: publish,
      p_potm_player: awardsDraft.potm_player ?? awardsSaved?.potm_player ?? '',
      p_potm_published: awardsSaved?.potm_published ?? false,
    })()
  }

  const savePotm = (publish) => async () => {
    if (publish && !awardsDraft.potm_player?.trim()) return alert('יש לבחור שחקן החודש')
    if (!publish && !confirm('לבטל פרסום ולהסתיר את שחקן החודש?')) return
    await act('admin_save_awards', {
      p_top_scorer: awardsSaved?.top_scorer ?? awardsDraft.top_scorer ?? '',
      p_mvp_star: awardsSaved?.mvp_star ?? awardsDraft.mvp_star ?? '',
      p_best_duo: awardsSaved?.best_duo ?? awardsDraft.best_duo ?? '',
      p_published: awardsSaved?.awards_published ?? false,
      p_potm_player: awardsDraft.potm_player || '',
      p_potm_published: publish,
    })()
  }

  const teamSelect = (r) => (
    <select aria-label={`קבוצה של ${r.player_name}`} value={r.draft_team ?? ''}
      onChange={(e) => act('admin_set_team', { p_id: r.id, p_team: e.target.value === '' ? null : Number(e.target.value) })()}
      className="rounded border border-stone-300 bg-white px-1 py-1">
      <option value="">ללא קבוצה</option>
      {[0, 1, 2].map((t) => <option key={t} value={t}>{colors[t] ?? `קבוצה ${t + 1}`}</option>)}
    </select>
  )
  const playerLine = (r) => (
    <div key={r.id} className="flex justify-between items-center py-1 gap-2">
      <span className="flex items-center gap-1 flex-wrap">
        {r.player_name} <span className="text-stone-500">({rOf(r)})</span>
        <span className="text-xs rounded bg-stone-100 text-stone-600 px-1.5 py-0.5">{cardOf(r).role}</span>
      </span>
      {teamSelect(r)}
    </div>
  )
  const doReset = async (e) => {
    e.preventDefault()
    if (!confirm('לאפס את המשחק? ההרשמות, הקבוצות ונתוני המחזור יימחקו. הדירוגים, התפקידים, הקלפים ושחקן החודש יישמרו.')) return
    await act('admin_reset_match', { p_match_time: next.match_time, p_price: Number(next.price), p_bit_link: next.bit_link })()
    setDraft(null); setAwardsDraft(null); await refresh()
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
  const List = ({ title, items, children, actions }) => (
    <section>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h2 className="text-xl font-bold">{title} ({items.length})</h2>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      {items.length === 0 && <p className="text-stone-500">אין שחקנים ברשימה.</p>}
      <ul className="divide-y divide-stone-200 bg-white rounded-lg">
        {items.map((r) => (
          <li key={r.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span>{r.player_name}</span><div className="flex gap-2 items-center flex-wrap">{children(r)}</div>
          </li>
        ))}
      </ul>
    </section>
  )
  const remove = (r) => <button className={`${btn} text-red-700`} onClick={() => confirm(`להסיר את ${r.player_name}?`) && act('admin_remove', { p_id: r.id })()}>הסר</button>
  const field = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2'

  return (
    <Shell title="ניהול משחק">
      <List title="ממתינים לאישור" items={by('pending')}
        actions={by('pending').length > 0 && (
          <button className={`${btn} bg-pitch text-chalk`}
            onClick={bulk('לאשר את כל הממתינים? מעבר ל-15 מגיעים יועברו לרשימת מזמינים.', 'admin_approve_all', {})}>אשר הכל</button>
        )}>
        {(r) => <>
          {rate(r)}<button className={`${btn} bg-pitch text-chalk`} onClick={act('admin_approve', { p_id: r.id })}>אשר</button>{remove(r)}
        </>}
      </List>
      <List title="מגיעים" items={by('confirmed')}
        actions={by('confirmed').length > 0 && <>
          <button className={`${smBtn} bg-green-50 text-green-800 border border-green-300`}
            onClick={bulk('לסמן את כל המגיעים כשילמו?', 'admin_set_all_paid', { p_is_paid: true })}>סמן לכולם שולם</button>
          <button className={`${smBtn} bg-red-50 text-red-800 border border-red-300`}
            onClick={bulk('לסמן את כל המגיעים כלא שילמו?', 'admin_set_all_paid', { p_is_paid: false })}>סמן לכולם לא שולם</button>
        </>}>
        {(r) => <>
          {rate(r)}
          {roleSel(r)}
          <button className={`${smBtn} bg-stone-800 text-white`} onClick={() => setCardFor(r.player_name)}>קלף FC</button>
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
                <span className="font-normal text-xs text-stone-600">{teamInfo(t)}</span>
              </div>
              {teamRows(t).map((r) => (
                playerLine(r)
              ))}
            </div>
          ))}
          {confirmedRows.some((r) => r.draft_team == null) && (
            <div className="bg-white rounded-lg p-3">
              <div className="font-bold mb-1">ללא קבוצה</div>
              {confirmedRows.filter((r) => r.draft_team == null).map((r) => (
                playerLine(r)
              ))}
            </div>
          )}
        </section>
      )}

      {awardsDraft && (
        <section className="space-y-4 bg-white rounded-xl p-4 border border-stone-200">
          <h2 className="text-xl font-bold">נתוני מחזור (קלפי TOTW 🔥)</h2>
          <p className="text-xs text-stone-600">כל שחקן שתבחר כאן יוצג בעמוד הראשי עם קלף ה-TOTW השחור-זהב שלו (כולל התמונה, ה-PlayStyle+ והכוכבים שהגדרת לו ב-"קלף FC").</p>
          {AWARDS.map(([k, icon, label]) => (
            <div key={k} className="space-y-1">
              <span className="text-sm font-bold">{icon} {label}</span>
              <div className="flex gap-2">
                <input className={field} list="players-dl" placeholder="בחר או הקלד שם שחקן..." value={awardsDraft[k]} onChange={(e) => setAwardsDraft({ ...awardsDraft, [k]: e.target.value })} />
                {awardsDraft[k]?.trim() && (
                  <button type="button" onClick={() => setCardFor(awardsDraft[k].trim())} className="rounded-lg px-3 py-2 text-xs font-bold bg-stone-800 text-white shrink-0">
                    ערוך קלף
                  </button>
                )}
              </div>
            </div>
          ))}
          <datalist id="players-dl">{allKnownNames.map((n) => <option key={n} value={n} />)}</datalist>
          <div className="flex gap-2 flex-wrap pt-1">
            <button className={`${btn} bg-pitch text-chalk`} onClick={saveAwards(true)}>פרסם נתוני מחזור</button>
            <button className={`${btn} bg-stone-200`} onClick={saveAwards(false)}>בטל פרסום / הסתר</button>
          </div>
          {awardsSaved?.awards_published && <p className="text-sm text-green-700 font-medium">✓ נתוני המחזור מפורסמים כעת בעמוד הראשי.</p>}

          <hr className="border-stone-200 my-3" />

          <h2 className="text-xl font-bold">שחקן החודש (קלף POTM 🏆)</h2>
          <div className="space-y-1">
            <span className="text-sm font-bold">🏆 בחר שחקן החודש</span>
            <div className="flex gap-2">
              <input className={field} list="players-dl" placeholder="בחר או הקלד שם שחקן..." value={awardsDraft.potm_player || ''} onChange={(e) => setAwardsDraft({ ...awardsDraft, potm_player: e.target.value })} />
              {awardsDraft.potm_player?.trim() && (
                <button type="button" onClick={() => setCardFor(awardsDraft.potm_player.trim())} className="rounded-lg px-3 py-2 text-xs font-bold bg-purple-900 text-white shrink-0">
                  ערוך קלף
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap pt-1">
            <button className={`${btn} bg-purple-900 text-white`} onClick={savePotm(true)}>פרסם שחקן החודש</button>
            <button className={`${btn} bg-stone-200`} onClick={savePotm(false)}>בטל פרסום שחקן החודש</button>
          </div>
          {awardsSaved?.potm_published && <p className="text-sm text-purple-800 font-medium">✓ קלף שחקן החודש מפורסם כעת בעמוד הראשי.</p>}
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
          <p className="text-sm text-stone-600">מוחק את כל ההרשמות ונתוני המחזור ומבטל פרסום קבוצות. הדירוגים, התפקידים, הקלפים ושחקן החודש יישמרו.</p>
          {[['match_time', 'תאריך וזמן המשחק הבא'], ['price', 'מחיר (₪)'], ['bit_link', 'קישור Bit']].map(([k, label]) => (
            <label key={k} className="block"><span className="text-sm">{label}</span>
              <input className={field} value={next[k]} type={k === 'price' ? 'number' : 'text'}
                dir={k === 'bit_link' ? 'ltr' : undefined} onChange={(e) => setNext({ ...next, [k]: e.target.value })} />
            </label>
          ))}
          <button className={`${btn} w-full bg-red-700 text-white`}>איפוס משחק לשבוע הבא</button>
        </form>
      )}
      {cardFor && (
        <FcCardModal key={cardFor} name={cardFor} initial={ratings[cardFor]}
          onSave={(c) => saveCard(cardFor, c)} onClose={() => setCardFor(null)} />
      )}
    </Shell>
  )
}

export default function App() {
  return location.pathname.startsWith('/admin') ? <Admin /> : <Player />
}
