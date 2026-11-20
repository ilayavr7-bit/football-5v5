import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, rpc } from './supabase'
import { balance } from './balance'

const CAP = 15
const RATING_STEPS = Array.from({ length: 9 }, (_, i) => 1 + i / 2)
const fmtAvg = (sum, n) => (n ? (sum / n).toFixed(1) : '–')
const MY_REGS_KEY = 'weisgal_my_reg_ids'
const PUBLIC_LIVE_GAMES_KEY = 'weisgal_public_live_games'

const cleanNtfyTopic = (raw) =>
  (raw || '').trim().replace(/^https?:\/\/ntfy\.sh\//i, '').replace(/^ntfy\.sh\//i, '').replace(/^\/+|\/+$/g, '')

const getMyRegIds = () => {
  try { return JSON.parse(localStorage.getItem(MY_REGS_KEY) || '[]') } catch { return [] }
}
const saveMyRegId = (id) => {
  try {
    const cur = getMyRegIds()
    if (id && !cur.includes(id)) localStorage.setItem(MY_REGS_KEY, JSON.stringify([...cur, id]))
  } catch { /* ignore */ }
}

const getPublicLiveGames = () => {
  try { return JSON.parse(localStorage.getItem(PUBLIC_LIVE_GAMES_KEY) || '[]') } catch { return [] }
}
const savePublicLiveGames = (games) => {
  try { localStorage.setItem(PUBLIC_LIVE_GAMES_KEY, JSON.stringify(games)) } catch { /* ignore */ }
}

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
  ['Power Shot', '⚽', 'בעיטה חזקה (Power Shot)'],
  ['Finesse Shot', '🎯', 'בעיטה מסובבת (Finesse Shot)'],
  ['Quick Step', '🚀', 'צעד ראשון מהיר (Quick Step)'],
  ['Rapid', '💨', 'ספרינטר (Rapid)'],
  ['Incisive Pass', '📐', 'מסירת עומק (Incisive Pass)'],
  ['Tiki Taka', '🔄', 'טיקי טאקה (Tiki Taka)'],
  ['Technical', '🪄', 'טכניקה ודריבל (Technical)'],
  ['First Touch', '🧲', 'עצירה ראשונה (First Touch)'],
  ['Anticipate', '🛡️', 'חטיפה וקריאת משחק (Anticipate)'],
  ['Bruiser', '💪', 'פיזיות וכתף (Bruiser)'],
  ['Relentless', '🔋', 'כושר בלתי נגמר (Relentless)'],
  ['GK Reflexes', '🧤', 'רפלקסים בשער (GK Reflexes)'],
]
const psIcon = (key) => PLAYSTYLES.find(([k]) => k === key)?.[1] || '⚽'
const psLabel = (key) => PLAYSTYLES.find(([k]) => k === key)?.[2] || key

const DEFAULT_CARD = {
  rating: 3, role: 'מאוזן', height_cm: 175, ovr: null,
  pac: 70, sho: 70, pas: 70, dri: 70, def: 70, phy: 70,
  photo_url: '', playstyle_plus: '', playstyle_plus_2: '', playstyles: [],
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
  ['top_scorer', 'top_scorer_2', '⚽', 'מלך שערים'],
  ['mvp_star', 'mvp_star_2', '⭐', 'כוכב המחזור'],
  ['best_duo', 'best_duo_2', '🥅', 'שער המחזור'],
]

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)))
const statAvg = (c) => STATS.reduce((s, [k]) => s + (Number(c[k]) || 40), 0) / 6
const ovrOf = (c) => (c?.ovr != null && c.ovr !== '' ? clamp(c.ovr, 40, 99) : clamp(statAvg(c), 40, 99))
const tierOf = (ovr) => (ovr >= 75 ? 'gold' : ovr >= 65 ? 'silver' : 'bronze')

function computeMatchdayAggregates(games, colors = []) {
  const playerMap = {}
  const ensureP = (name) => {
    if (!playerMap[name]) playerMap[name] = { name, goals: 0, assists: 0 }
    return playerMap[name]
  }
  const teamStats = [0, 1, 2].map((idx) => ({
    idx,
    name: colors[idx] || `קבוצה ${idx + 1}`,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    pts: 0,
  }))

  for (const g of games || []) {
    const a = teamStats[g.team_a]
    const b = teamStats[g.team_b]
    if (a && b) {
      a.played += 1; b.played += 1
      a.gf += Number(g.score_a) || 0; a.ga += Number(g.score_b) || 0
      b.gf += Number(g.score_b) || 0; b.ga += Number(g.score_a) || 0
      if (g.winner_team === g.team_a) {
        a.wins += 1; a.pts += 3; b.losses += 1
      } else if (g.winner_team === g.team_b) {
        b.wins += 1; b.pts += 3; a.losses += 1
      } else {
        a.draws += 1; a.pts += 1; b.draws += 1; b.pts += 1
      }
    }
    for (const ev of g.events || []) {
      const sc = (ev.scorer || '').trim()
      const as = (ev.assist || '').trim()
      if (ev.type === 'goal' && sc) ensureP(sc).goals += 1
      if (as) ensureP(as).assists += 1
    }
  }

  const players = Object.values(playerMap).sort(
    (x, y) => (y.goals + y.assists) - (x.goals + x.assists) || y.goals - x.goals || x.name.localeCompare(y.name, 'he')
  )
  const teams = [...teamStats].sort(
    (x, y) => y.wins - x.wins || y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf
  )
  return { players, teams }
}

function useLive() {
  const [settings, setSettings] = useState(null)
  const [confirmed, setConfirmed] = useState([])
  const [awards, setAwards] = useState(null)
  const [featuredCards, setFeaturedCards] = useState({})
  const [knownNames, setKnownNames] = useState([])
  const [liveGames, setLiveGames] = useState([])
  const [allTimeStats, setAllTimeStats] = useState([])

  const load = useCallback(async () => {
    await supabase.rpc('expire_unpaid')
    const [s, r, a, fc, kn, lg, at] = await Promise.all([
      supabase.from('match_settings').select('*').eq('id', 1).single(),
      supabase.from('registrations').select('*').eq('status', 'confirmed').order('approved_at'),
      supabase.from('matchweek_awards').select('*').eq('id', 1).maybeSingle(),
      supabase.rpc('get_featured_cards').then((res) => res.data || [], () => []),
      supabase.rpc('public_get_player_names').then((res) => res.data || [], () => []),
      supabase.from('matchweek_games').select('*').order('created_at', { ascending: true }).then((res) => res.data || [], () => []),
      supabase.rpc('public_get_alltime_stats').then((res) => res.data || [], () => []),
    ])
    if (s.data) setSettings(s.data)
    if (r.data) setConfirmed(r.data)
    setAwards(a.data || null)
    if (fc) setFeaturedCards(Object.fromEntries(fc.map((x) => [x.player_name, x])))
    if (kn) setKnownNames(kn)
    if (lg) setLiveGames(lg)
    if (at) setAllTimeStats(at)
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_settings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchweek_awards' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchweek_games' }, load)
      .subscribe()
    const poll = setInterval(load, 20000)
    return () => { supabase.removeChannel(ch); clearInterval(poll) }
  }, [load])
  return { settings, confirmed, awards, featuredCards, knownNames, liveGames, allTimeStats, reload: load }
}

function Countdown({ since, hours = 48 }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  if (!hours || hours <= 0) return <span className="text-stone-500">ללא הגבלת זמן</span>
  const left = new Date(since).getTime() + hours * 3600e3 - now
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
    <div className={`relative mx-auto select-none ${compact ? 'w-full max-w-[180px] py-2' : 'w-64 py-3'}`}>
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
        <div
          className="absolute inset-0 pointer-events-none rounded-t-[26px] rounded-b-[20px] opacity-25"
          style={{
            backgroundImage: 'repeating-linear-gradient(135deg, transparent 0px, transparent 14px, rgba(255,255,255,0.22) 14px, rgba(255,255,255,0.22) 16px)',
          }}
        />

        {t.badge && (
          <div
            className="relative z-10 text-[9px] font-black tracking-widest uppercase text-center rounded-full px-2.5 py-0.5 mb-1 mx-auto w-fit"
            style={{ background: 'rgba(0,0,0,0.28)', border: `1px solid ${t.border}` }}
          >
            ★ {t.badge} ★
          </div>
        )}

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
              <span
                className="-rotate-45 absolute -top-1 -right-1 text-[9px] font-black leading-none px-0.5 rounded-sm"
                style={{ background: t.psBorder, color: variant === 'totw' || variant === 'potm' ? '#111' : '#fff7cc' }}
              >
                +
              </span>
            </button>

            {showPsBanner && (
              <div
                dir="rtl"
                onClick={togglePsBanner}
                className={`
                  absolute z-40 left-2 right-2 top-[36%] mx-auto w-fit max-w-[94%]
                  rounded-xl px-3 py-1.5 text-center shadow-2xl cursor-pointer
                  backdrop-blur-md border border-amber-300/70
                  ${compact ? 'text-[11px]' : 'text-xs'} font-extrabold text-amber-100
                `}
                style={{ background: 'rgba(15, 15, 15, 0.86)' }}
              >
                <span className="ml-1">{psIcon(c.playstyle_plus)}</span>
                <span>{psLabel(c.playstyle_plus)}+</span>
              </div>
            )}
          </>
        )}

        <div className={`relative z-10 flex items-start justify-between ${compact ? 'h-24' : 'h-36'}`}>
          <div className="flex flex-col items-center text-center leading-none pt-0.5 pl-0.5 z-20">
            <div className={`${compact ? 'text-2xl' : 'text-4xl'} font-black tracking-tight`}>{ovr}</div>
            <div className={`${compact ? 'text-xs' : 'text-sm'} font-extrabold tracking-wide mt-0.5`}>{posCode}</div>
            <div className="text-[10px] font-black tracking-tighter opacity-85">++</div>
          </div>

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

        <div
          className="relative z-10 text-center border-t pt-1.5 mt-1"
          style={{ borderColor: t.line }}
          dir="auto"
        >
          <div className={`${compact ? 'text-sm' : 'text-xl'} font-black tracking-tight truncate`}>
            {name || '—'}
          </div>
        </div>

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

        <div className="relative z-10 text-center mt-1">
          <span className="text-[10px] font-bold opacity-75">{c.role}</span>
        </div>
      </div>

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

/* ---------- FUT.GG Style PlayStyles Diamond Bar (Shown ONLY in Admin Editor) ---------- */
function AdminPlaystylesRow({ plusList = [], grayList = [] }) {
  const [selectedLabel, setSelectedLabel] = useState('')
  const activePlus = plusList.filter(Boolean)
  const activeGray = grayList.filter(Boolean)

  if (activePlus.length === 0 && activeGray.length === 0) return null

  return (
    <div className="bg-stone-900 rounded-xl p-3 border border-stone-700 space-y-2 shadow-inner">
      <div dir="ltr" className="flex items-center justify-center gap-3 flex-wrap py-1">
        {activePlus.map((key, i) => (
          <button
            key={`ps-plus-${key}-${i}`}
            type="button"
            onClick={() => setSelectedLabel(`${psIcon(key)} ${psLabel(key)}+ (זהב)`)}
            className="relative w-9 h-9 rotate-45 rounded-[6px] flex items-center justify-center shadow-md transition-transform active:scale-95 cursor-pointer"
            style={{
              background: 'linear-gradient(135deg,#fff3a6,#d8a832)',
              border: '2px solid #2d2106',
              color: '#2d2106',
            }}
          >
            <div className="w-[82%] h-[82%] rounded-[3px] border border-[#2d2106] flex items-center justify-center">
              <span className="-rotate-45 text-sm leading-none">{psIcon(key)}</span>
            </div>
            <span className="-rotate-45 absolute -top-1.5 -right-1.5 text-[9px] font-black leading-none px-1 py-0.5 rounded-sm bg-[#2d2106] text-[#fff7cc]">
              +
            </span>
          </button>
        ))}

        {activeGray.map((key, i) => (
          <button
            key={`ps-gray-${key}-${i}`}
            type="button"
            onClick={() => setSelectedLabel(`${psIcon(key)} ${psLabel(key)} (אפור)`)}
            className="relative w-9 h-9 rotate-45 rounded-[6px] flex items-center justify-center shadow-md transition-transform active:scale-95 cursor-pointer"
            style={{
              background: 'linear-gradient(135deg,#f8fafc,#94a3b8)',
              border: '2px solid #334155',
              color: '#0f172a',
            }}
          >
            <div className="w-[82%] h-[82%] rounded-[3px] border border-[#334155] flex items-center justify-center">
              <span className="-rotate-45 text-sm leading-none">{psIcon(key)}</span>
            </div>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-center text-amber-200/90 font-medium">
        {selectedLabel || 'תצוגת אדמין בלבד (לא מופיע באתר): לחץ על יהלום לראות את שמו'}
      </p>
    </div>
  )
}

/* ---------- Matchday Tables ---------- */
function MatchdayTables({ games, colors }) {
  const { players, teams } = computeMatchdayAggregates(games, colors)
  if (!games || games.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
        <div className="bg-pitch text-chalk px-4 py-2.5 font-extrabold text-base flex justify-between items-center">
          <span>🏆 טבלת קבוצות המחזור ({games.length} משחקונים)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-center">
            <thead className="bg-stone-100 text-stone-700 font-bold border-b border-stone-200">
              <tr>
                <th className="py-2 px-3 text-right">קבוצה</th>
                <th className="py-2 px-2">מש׳</th>
                <th className="py-2 px-2">נצ׳</th>
                <th className="py-2 px-2">תיקו</th>
                <th className="py-2 px-2">הפ׳</th>
                <th className="py-2 px-2">הפרש</th>
                <th className="py-2 px-2">נק׳</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {teams.map((t, idx) => (
                <tr key={t.idx} className={idx === 0 && t.played > 0 ? 'bg-amber-50/70 font-bold' : ''}>
                  <td className="py-2 px-3 text-right flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded-full border border-stone-400 shrink-0" style={{ background: CSS_COLORS[t.name] || '#57534e' }} />
                    <span>{t.name}</span>
                  </td>
                  <td className="py-2 px-2">{t.played}</td>
                  <td className="py-2 px-2 text-green-700 font-bold">{t.wins}</td>
                  <td className="py-2 px-2">{t.draws}</td>
                  <td className="py-2 px-2 text-red-700">{t.losses}</td>
                  <td className="py-2 px-2" dir="ltr">{t.gf - t.ga > 0 ? `+${t.gf - t.ga}` : t.gf - t.ga}</td>
                  <td className="py-2 px-2 font-black">{t.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {players.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
          <div className="bg-stone-800 text-white px-4 py-2.5 font-extrabold text-base">
            ⚽ מלכי השערים והבישולים של המחזור
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center">
              <thead className="bg-stone-100 text-stone-700 font-bold border-b border-stone-200">
                <tr>
                  <th className="py-2 px-3 text-right">שחקן</th>
                  <th className="py-2 px-2">⚽ שערים</th>
                  <th className="py-2 px-2">🎯 בישולים</th>
                  <th className="py-2 px-2">סה״כ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {players.map((p, idx) => (
                  <tr key={p.name} className={idx === 0 ? 'bg-amber-50/60 font-bold' : ''}>
                    <td className="py-2 px-3 text-right font-medium">{p.name}</td>
                    <td className="py-2 px-2 font-bold text-pitch">{p.goals}</td>
                    <td className="py-2 px-2 font-bold text-amber-700">{p.assists}</td>
                    <td className="py-2 px-2 font-black">{p.goals + p.assists}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Sortable All-Time Roster Table ---------- */
const ALLTIME_COLS = [
  { key: 'player_name', label: 'שחקן', align: 'text-right' },
  { key: 'total_goals', label: '⚽ גולים', align: 'text-center' },
  { key: 'total_assists', label: '🎯 בישולים', align: 'text-center' },
  { key: 'total_matches', label: 'מש׳', align: 'text-center' },
  { key: 'win_pct', label: '% נצחון', align: 'text-center' },
  { key: 'awards_mvp', label: '⭐ כוכב', align: 'text-center' },
  { key: 'awards_top_scorer', label: '👑 מלך', align: 'text-center' },
  { key: 'awards_goal_of_week', label: '🥅 שער', align: 'text-center' },
]

function AllTimeTable({ stats }) {
  const [sortBy, setSortBy] = useState('total_goals')
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (colKey) => {
    if (sortBy === colKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(colKey)
      setSortDir(colKey === 'player_name' ? 'asc' : 'desc')
    }
  }

  const enriched = useMemo(() => {
    return (stats || []).map((s) => {
      const m = Number(s.total_matches) || 0
      const w = Number(s.total_wins) || 0
      const winPct = m > 0 ? Math.round((w / m) * 100) : 0
      return {
        ...s,
        total_goals: Number(s.total_goals) || 0,
        total_assists: Number(s.total_assists) || 0,
        total_matches: m,
        total_wins: w,
        win_pct: winPct,
        awards_mvp: Number(s.awards_mvp) || 0,
        awards_top_scorer: Number(s.awards_top_scorer) || 0,
        awards_goal_of_week: Number(s.awards_goal_of_week) || 0,
      }
    })
  }, [stats])

  const sorted = useMemo(() => {
    const arr = [...enriched]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'player_name') {
        cmp = a.player_name.localeCompare(b.player_name, 'he')
      } else {
        cmp = (a[sortBy] ?? 0) - (b[sortBy] ?? 0) || a.player_name.localeCompare(b.player_name, 'he')
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [enriched, sortBy, sortDir])

  if (!sorted.length) return null

  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
      <div className="bg-stone-900 text-amber-200 px-4 py-2.5 font-extrabold text-sm sm:text-base flex items-center justify-between">
        <span>📊 סטטיסטיקת כל הזמנים (כל המאגר)</span>
        <span className="text-[11px] font-normal text-stone-300">לחץ על כותרת למיון עולה/יורד</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-center whitespace-nowrap">
          <thead className="bg-stone-100 text-stone-800 font-extrabold border-b border-stone-200">
            <tr>
              {ALLTIME_COLS.map((col) => {
                const active = sortBy === col.key
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`py-2 px-2 cursor-pointer select-none hover:bg-stone-200/80 transition ${col.align} ${
                      active ? 'bg-amber-100/80 text-stone-950' : ''
                    }`}
                  >
                    <span>{col.label}</span>
                    {active && <span className="mr-0.5 text-[10px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {sorted.map((s) => (
              <tr key={s.player_name} className="hover:bg-stone-50">
                <td className="py-2 px-2 text-right font-bold">{s.player_name}</td>
                <td className="py-2 px-2 font-extrabold text-pitch">{s.total_goals}</td>
                <td className="py-2 px-2 font-extrabold text-amber-700">{s.total_assists}</td>
                <td className="py-2 px-2">{s.total_matches}</td>
                <td className="py-2 px-2 font-bold">{s.total_matches > 0 ? `${s.win_pct}%` : '–'}</td>
                <td className="py-2 px-2">{s.awards_mvp}</td>
                <td className="py-2 px-2">{s.awards_top_scorer}</td>
                <td className="py-2 px-2">{s.awards_goal_of_week}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------- Public Page ---------- */
function Player() {
  const { settings, confirmed, awards, featuredCards, knownNames, liveGames, allTimeStats } = useLive()
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [myIds, setMyIds] = useState(() => getMyRegIds())

  const registerName = async (targetName) => {
    const cleanName = targetName.trim()
    if (!cleanName || cleanName.length < 2) return
    setBusy(true); setMsg('')
    try {
      const regId = await rpc('public_register_player', { p_name: cleanName })
      if (regId) {
        saveMyRegId(regId)
        setMyIds(getMyRegIds())
      }

      const { data: freshSettings } = await supabase.from('match_settings').select('ntfy_topic').eq('id', 1).single()
      const topic = cleanNtfyTopic(freshSettings?.ntfy_topic || settings?.ntfy_topic)
      if (topic) {
        fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
          method: 'POST',
          keepalive: true,
          body: `⚽ בקשת הרשמה חדשה מ-${cleanName} ממתינה לאישור ב-/admin`,
          headers: { Title: 'Weisgal Football - New Registration' },
        }).catch(() => {})
      }

      setName('')
      setMsg(`בקשת ההרשמה עבור ${cleanName} נקלטה בהצלחה! רשימת המגיעים הסופית תפורסם בקרוב.`)
    } catch (err) {
      if (err?.message?.includes('registration_closed')) {
        setMsg('ההרשמה למשחק עדיין סגורה.')
      } else {
        setMsg('ההרשמה נכשלה. בדקו שהשם באורך 2–40 תווים ונסו שוב.')
      }
    }
    setBusy(false)
  }

  const submit = (e) => {
    e.preventDefault()
    registerName(name)
  }

  if (!settings) return <Shell title="טוען…" />
  const parts = (settings.match_time || '').split(',').map((s) => s.trim()).filter(Boolean)
  const matchDay = parts[0] || ''
  const matchHour = parts.slice(1).join(', ')

  const listPublished = Boolean(settings.list_published)
  const regOpen = settings.registration_open !== false
  const bitEnabled = settings.bit_enabled !== false
  const timeoutHours = Number(settings.payment_timeout_hours ?? 48)
  const myConfirmedPlayer = listPublished ? confirmed.find((p) => myIds.includes(p.id)) : null

  const trimmedInput = name.trim()
  const confirmedSet = listPublished ? new Set(confirmed.map((p) => p.player_name)) : new Set()
  const quickSuggestions = trimmedInput.length >= 1
    ? knownNames.filter((n) => n.includes(trimmedInput) && !confirmedSet.has(n)).slice(0, 5)
    : []

  const publicGames = getPublicLiveGames()
  const displayLiveGames = liveGames.length > 0 ? liveGames : publicGames

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

        {settings.live_page_published && (
          <div className="pt-2">
            <a
              href="/live"
              className="inline-block rounded-xl bg-pitch text-chalk font-extrabold text-sm px-5 py-2.5 shadow hover:brightness-105 transition"
            >
              ⚽ מעבר לעמוד משחק חי
            </a>
          </div>
        )}
      </section>

      {listPublished && bitEnabled && myConfirmedPlayer && !myConfirmedPlayer.is_paid && (
        <section className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 space-y-2 shadow-md">
          <p className="text-center font-extrabold text-stone-800">
            🎉 {myConfirmedPlayer.player_name}, אושרת למשחק!
          </p>
          <a href={settings.bit_link} target="_blank" rel="noreferrer"
            className="block text-center bg-bib text-white font-bold text-xl rounded-xl py-4 shadow-md">
            לחץ כאן לתשלום ב-Bit · {settings.price} ₪
          </a>
          <p className="text-xs text-stone-600 text-center">
            אם משלמים ב-Bit מחשבון אחר, חובה לציין בהערה את השם: <b>{myConfirmedPlayer.player_name}</b>
          </p>
        </section>
      )}

      {settings.teams_published && <Teams colors={settings.team_colors} players={confirmed} />}

      {regOpen ? (
        <form onSubmit={submit} className="space-y-3 bg-white/90 rounded-2xl p-4 border border-stone-200 shadow-sm">
          <label className="block font-bold text-center text-lg" htmlFor="n">רישום למשחק הקרוב</label>
          <input id="n" placeholder="התחל להקליד שם לבחירה מהירה..." value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40}
            autoComplete="off" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-center font-medium" />

          {quickSuggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-stone-500 text-center">הרשמה בלחיצה מהמאגר הקבוע:</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {quickSuggestions.map((sName) => (
                  <button
                    key={sName}
                    type="button"
                    disabled={busy}
                    onClick={() => registerName(sName)}
                    className="rounded-full bg-pitch/10 hover:bg-pitch/20 text-pitch border border-pitch/30 px-3 py-1.5 text-sm font-bold transition"
                  >
                    ⚡ {sName}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button disabled={busy} className={`${btn} w-full bg-pitch text-chalk text-lg`}>שלח בקשת הרשמה</button>
          <p className="text-xs text-stone-500 text-center">
            {listPublished
              ? 'לאחר שליחת הבקשה המנהל יאשר את ההרשמה, וקישור ה-Bit ייפתח אוטומטית במכשירך עם האישור.'
              : 'לאחר שליחת הבקשה המנהל ירכיב ויפרסם את רשימת ה-15 הסופית.'}
          </p>
          {msg && <p className="text-sm font-bold text-pitch text-center" role="status">{msg}</p>}
        </form>
      ) : (
        <section className="bg-stone-800 text-chalk rounded-2xl p-5 text-center space-y-1 shadow-md">
          <div className="text-lg font-extrabold">🔒 ההרשמה למשחק סגורה כעת</div>
          <p className="text-sm opacity-90">
            {settings.registration_note || 'ההרשמה למשחק הקרוב תיפתח ביום רביעי בשעה 10:00'}
          </p>
        </section>
      )}

      {listPublished ? (
        <section>
          <h2 className="text-xl font-bold mb-2">מגיעים מאושרים ({confirmed.length}/{CAP})</h2>
          {confirmed.length === 0 && <p className="text-stone-500">עדיין אין מאושרים.</p>}
          <ul className="divide-y divide-stone-200 bg-white rounded-lg">
            {confirmed.map((p) => (
              <li key={p.id} className="flex justify-between px-3 py-2">
                <span className="font-medium">{p.player_name}</span>
                <span className={p.is_paid ? 'text-green-700 font-bold' : 'text-stone-500'}>
                  {p.is_paid ? 'שולם ✓' : (
                    timeoutHours > 0
                      ? <>לא שולם · <Countdown since={p.approved_at} hours={timeoutHours} /></>
                      : 'לא שולם'
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="bg-white/90 rounded-2xl border border-stone-200 p-4 text-center space-y-1 shadow-sm">
          <div className="text-base font-extrabold text-stone-800">📋 רשימת המגיעים טרם פורסמה</div>
          <p className="text-xs text-stone-500">המנהל אוסף את הבקשות ויפרסם בקרוב את רשימת ה-15 הסופית ותשלום ה-Bit.</p>
        </section>
      )}

      {settings.live_stats_published && displayLiveGames.length > 0 && (
        <section className="space-y-3">
          <MatchdayTables games={displayLiveGames} colors={settings.team_colors || []} />
        </section>
      )}

      {awards?.awards_published && AWARDS.some(([k1, k2]) => awards[k1] || awards[k2]) && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold text-center">נתוני מחזור 🔥</h2>
          <p className="text-xs text-stone-500 text-center">לחצו על יהלום ה-PlayStyle+ שעל הקלף כדי לראות את היכולת המיוחדת</p>
          <div className="grid grid-cols-1 gap-4">
            {AWARDS.map(([k1, k2, icon, label]) => {
              const winners = [awards[k1], awards[k2]].map((s) => (s || '').trim()).filter(Boolean)
              if (winners.length === 0) return null
              return (
                <div key={k1} className="bg-white/95 rounded-2xl shadow-sm border border-stone-200 p-3 text-center space-y-2">
                  <div className="text-base font-extrabold text-stone-800">{icon} {label}</div>
                  <div className={`grid gap-3 justify-items-center ${winners.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {winners.map((pName, idx) => (
                      <FutCard key={`${k1}-${idx}-${pName}`} name={pName} card={featuredCards[pName]} variant="totw" boost={2} compact />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {awards?.potm_published && awards?.potm_player && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold text-center">שחקן החודש 🏆</h2>
          <div className="bg-gradient-to-b from-purple-950/90 to-slate-900 rounded-2xl shadow-lg p-4 text-center">
            <FutCard name={awards.potm_player} card={featuredCards[awards.potm_player]} variant="potm" boost={3} />
          </div>
        </section>
      )}

      {settings.alltime_stats_published && allTimeStats.length > 0 && (
        <section className="space-y-3">
          <AllTimeTable stats={allTimeStats} />
        </section>
      )}
    </Shell>
  )
}

/* ---------- Live Pitch & Matchday Tracker Page (/live) ---------- */
function LivePitchPage() {
  const [pin, setPin] = useState(sessionStorage.getItem('pin') || '')
  const [authed, setAuthed] = useState(false)
  const [err, setErr] = useState('')
  const { settings, confirmed, liveGames, knownNames, reload } = useLive()

  const [teamA, setTeamA] = useState(0)
  const [teamB, setTeamB] = useState(1)
  const [rosters, setRosters] = useState({ 0: [], 1: [], 2: [] })
  const [rostersInitialized, setRostersInitialized] = useState(false)
  const [addPlayerInput, setAddPlayerInput] = useState({ 0: '', 1: '', 2: '' })

  const [baseMinutes, setBaseMinutes] = useState(7)
  const [stoppageMinutes, setStoppageMinutes] = useState(1)
  const [secondsLeft, setSecondsLeft] = useState(420)
  const [timerRunning, setTimerRunning] = useState(false)

  const [events, setEvents] = useState([])
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [pendingAssist, setPendingAssist] = useState('')
  const [penaltiesOpen, setPenaltiesOpen] = useState(false)
  const [penRounds, setPenRounds] = useState([{ a: null, b: null }])
  const [savingGame, setSavingGame] = useState(false)
  const [publicGames, setPublicGames] = useState(() => getPublicLiveGames())

  const isPublicLive = Boolean(settings?.live_page_published)

  const login = async (e) => {
    e?.preventDefault()
    try {
      if (!(await rpc('check_pin', { p_pin: pin }))) throw new Error()
      sessionStorage.setItem('pin', pin); setAuthed(true); setErr('')
    } catch { setErr('קוד שגוי'); sessionStorage.removeItem('pin') }
  }
  useEffect(() => { if (pin) login() }, []) // eslint-disable-line

  useEffect(() => {
    if (confirmed.length > 0 && !rostersInitialized) {
      const nextR = { 0: [], 1: [], 2: [] }
      confirmed.forEach((p) => {
        const t = p.team_index ?? p.draft_team
        if (t === 0 || t === 1 || t === 2) nextR[t].push(p.player_name)
      })
      setRosters(nextR)
      setRostersInitialized(true)
    }
  }, [confirmed, rostersInitialized])

  useEffect(() => {
    if (!timerRunning) return
    const iv = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerRunning(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [timerRunning])

  const selectPreset = (mins, stop = 1) => {
    setTimerRunning(false)
    setBaseMinutes(mins)
    setStoppageMinutes(stop)
    setSecondsLeft(mins * 60)
  }

  const addStoppageTime = () => {
    setSecondsLeft((s) => s + stoppageMinutes * 60)
    setTimerRunning(true)
  }

  const colors = settings?.team_colors || ['כתום', 'צהוב', 'כחול']
  const nameA = colors[teamA] || `קבוצה ${teamA + 1}`
  const nameB = colors[teamB] || `קבוצה ${teamB + 1}`

  const scoreA = events.filter((e) => e.type === 'goal' && Number(e.team) === Number(teamA)).length
  const scoreB = events.filter((e) => e.type === 'goal' && Number(e.team) === Number(teamB)).length
  const penScoreA = penRounds.filter((r) => r.a === true).length
  const penScoreB = penRounds.filter((r) => r.b === true).length

  const activeGamesList = authed ? liveGames : (liveGames.length > 0 ? liveGames : publicGames)

  const moveOrAddPlayerToTeam = (targetTeam, rawName) => {
    const clean = (rawName || '').trim()
    if (!clean) return
    setRosters((prev) => {
      const updated = {
        0: prev[0].filter((n) => n !== clean),
        1: prev[1].filter((n) => n !== clean),
        2: prev[2].filter((n) => n !== clean),
      }
      updated[targetTeam] = [...updated[targetTeam], clean]
      return updated
    })
    setAddPlayerInput((p) => ({ ...p, [targetTeam]: '' }))
  }

  const removePlayerFromTeam = (teamIdx, pName) => {
    setRosters((prev) => ({
      ...prev,
      [teamIdx]: prev[teamIdx].filter((n) => n !== pName),
    }))
  }

  const recordGoal = (scorerName, scorerTeam, assistName = '') => {
    setEvents((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type: 'goal', scorer: scorerName, assist: assistName, team: Number(scorerTeam) },
    ])
    setSelectedPlayer(null)
    setPendingAssist('')
  }

  const recordSoloAssist = (assistName, assistTeam) => {
    setEvents((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type: 'assist_only', scorer: '', assist: assistName, team: Number(assistTeam) },
    ])
    setSelectedPlayer(null)
    setPendingAssist('')
  }

  const removeEvent = (id) => setEvents((prev) => prev.filter((e) => e.id !== id))

  const togglePenKick = (roundIdx, side) => {
    setPenRounds((prev) =>
      prev.map((r, i) => {
        if (i !== roundIdx) return r
        const cur = r[side]
        const nextVal = cur === null ? true : cur === true ? false : null
        return { ...r, [side]: nextVal }
      })
    )
  }

  const finishAndSaveGame = async () => {
    let winner = null
    if (scoreA > scoreB) winner = teamA
    else if (scoreB > scoreA) winner = teamB
    else if (penaltiesOpen) {
      if (penScoreA > penScoreB) winner = teamA
      else if (penScoreB > penScoreA) winner = teamB
    }

    const summary = winner === null
      ? `לשמור תיקו ${scoreA}:${scoreB} (${nameA} נגד ${nameB})?`
      : `לשמור ניצחון ל${colors[winner]} (${scoreA}:${scoreB}${penaltiesOpen ? ` · פנדלים ${penScoreA}:${penScoreB}` : ''})?`

    if (!confirm(summary)) return
    setSavingGame(true)
    try {
      const cleanEvents = events.map(({ type, scorer, assist, team }) => ({ type, scorer, assist, team }))
      if (authed) {
        await rpc('admin_record_live_game', {
          p_pin: pin,
          p_team_a: teamA,
          p_team_b: teamB,
          p_score_a: scoreA,
          p_score_b: scoreB,
          p_pen_a: penaltiesOpen ? penScoreA : 0,
          p_pen_b: penaltiesOpen ? penScoreB : 0,
          p_winner_team: winner,
          p_events: cleanEvents,
          p_lineups: { a: rosters[teamA] || [], b: rosters[teamB] || [] },
        })
        await reload()
      } else {
        const nextGame = {
          id: crypto.randomUUID(),
          team_a: teamA,
          team_b: teamB,
          score_a: scoreA,
          score_b: scoreB,
          pen_a: penaltiesOpen ? penScoreA : 0,
          pen_b: penaltiesOpen ? penScoreB : 0,
          winner_team: winner,
          events: cleanEvents,
          created_at: new Date().toISOString(),
        }
        const updated = [...publicGames, nextGame]
        setPublicGames(updated)
        savePublicLiveGames(updated)
      }

      setEvents([])
      setPenaltiesOpen(false)
      setPenRounds([{ a: null, b: null }])
      setTimerRunning(false)
      setSecondsLeft(baseMinutes * 60)
      if (winner !== null) {
        const otherTeam = [0, 1, 2].find((t) => t !== teamA && t !== teamB)
        if (otherTeam != null) {
          if (winner === teamA) setTeamB(otherTeam)
          else setTeamA(otherTeam)
        }
      }
    } catch {
      alert('שמירת המשחקון נכשלה')
    }
    setSavingGame(false)
  }

  const deleteSavedGame = async (gameId) => {
    if (!confirm('למחוק את המשחקון הזה?')) return
    if (authed) {
      try {
        await rpc('admin_delete_live_game', { p_pin: pin, p_id: gameId })
        await reload()
      } catch { alert('מחיקת המשחקון נכשלה') }
    } else {
      const updated = publicGames.filter((g) => g.id !== gameId)
      setPublicGames(updated)
      savePublicLiveGames(updated)
    }
  }

  const togglePublishStats = async (patch) => {
    if (!authed) return
    try {
      await rpc('admin_publish_stats', {
        p_pin: pin,
        p_live: patch.live ?? Boolean(settings?.live_stats_published),
        p_alltime: patch.alltime ?? Boolean(settings?.alltime_stats_published),
      })
      await reload()
    } catch { alert('עדכון הפרסום נכשל') }
  }

  if (!settings) return <Shell title="טוען…" />

  if (!authed && !isPublicLive) return (
    <Shell title="ניהול משחק חי">
      <form onSubmit={login} className="space-y-3">
        <label htmlFor="p" className="block font-medium">קוד מנהל</label>
        <input id="p" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-3" />
        <button className={`${btn} w-full bg-pitch text-chalk`}>כניסה</button>
        {err && <p className="text-red-700">{err}</p>}
      </form>
    </Shell>
  )

  const mins = Math.floor(secondsLeft / 60)
  const secs = String(secondsLeft % 60).padStart(2, '0')
  const isTimeUp = secondsLeft === 0

  return (
    <div className="min-h-screen bg-stone-950 text-white pb-10">
      <header className="bg-pitch text-chalk px-4 py-4 shadow-lg">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
          <a href="/" className="rounded-lg bg-black/25 px-3 py-1.5 text-sm font-bold hover:bg-black/40">
            → חזרה לעמוד הראשי
          </a>
          <h1 className="text-xl font-black">⚽ משחק חי</h1>
          <span className="text-xs opacity-80">{activeGamesList.length} משחקונים</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-3 py-4 space-y-5">
        <section
          className="relative rounded-3xl border-4 border-white/80 shadow-2xl overflow-hidden p-4 space-y-4"
          style={{
            background: 'repeating-linear-gradient(0deg, #166534 0px, #166534 36px, #15803d 36px, #15803d 72px)',
          }}
        >
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-32 h-32 rounded-full border-2 border-white/35" />
            <div className="absolute inset-x-0 top-1/2 border-t-2 border-white/35" />
          </div>

          <div className="relative z-10 bg-stone-950/90 backdrop-blur-md rounded-2xl border border-white/20 p-3 space-y-3 shadow-xl">
            <div dir="ltr" className="grid grid-cols-3 items-center text-center gap-2">
              <div className="space-y-1">
                <select
                  aria-label="קבוצה שמאל"
                  value={teamA}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (v === teamB) setTeamB(teamA)
                    setTeamA(v)
                  }}
                  className="w-full rounded-lg bg-stone-800 text-white border border-stone-600 px-2 py-1.5 text-sm font-extrabold text-center"
                >
                  {[0, 1, 2].map((t) => <option key={t} value={t}>{colors[t] || `קבוצה ${t + 1}`}</option>)}
                </select>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="w-4 h-4 rounded-full border border-white/60" style={{ background: CSS_COLORS[nameA] || '#57534e' }} />
                  <span className="text-xs font-bold text-stone-300">{nameA}</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-4xl font-black tracking-wider tabular-nums text-amber-300">
                  {scoreA} : {scoreB}
                </div>
                {penaltiesOpen && (
                  <div className="text-xs font-extrabold text-sky-300">
                    PEN ({penScoreA} : {penScoreB})
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <select
                  aria-label="קבוצה ימין"
                  value={teamB}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (v === teamA) setTeamA(teamB)
                    setTeamB(v)
                  }}
                  className="w-full rounded-lg bg-stone-800 text-white border border-stone-600 px-2 py-1.5 text-sm font-extrabold text-center"
                >
                  {[0, 1, 2].map((t) => <option key={t} value={t}>{colors[t] || `קבוצה ${t + 1}`}</option>)}
                </select>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="w-4 h-4 rounded-full border border-white/60" style={{ background: CSS_COLORS[nameB] || '#57534e' }} />
                  <span className="text-xs font-bold text-stone-300">{nameB}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-white/15 pt-2.5 flex flex-col items-center gap-2">
              <div className="flex items-center gap-3">
                <div
                  dir="ltr"
                  className={`text-3xl font-black tabular-nums px-4 py-1 rounded-xl border ${
                    isTimeUp
                      ? 'bg-red-900/90 border-red-400 text-red-100 animate-pulse'
                      : 'bg-black/60 border-white/20 text-white'
                  }`}
                >
                  {mins}:{secs}
                </div>
                <button
                  type="button"
                  onClick={() => setTimerRunning((r) => !r)}
                  className={`rounded-xl px-4 py-2 font-extrabold text-sm ${
                    timerRunning ? 'bg-amber-500 text-stone-950' : 'bg-green-600 text-white'
                  }`}
                >
                  {timerRunning ? '⏸ עצור' : '▶ הפעל'}
                </button>
                <button
                  type="button"
                  onClick={() => { setTimerRunning(false); setSecondsLeft(baseMinutes * 60) }}
                  className="rounded-xl px-3 py-2 font-bold text-xs bg-stone-800 text-stone-200 border border-stone-600"
                >
                  איפוס
                </button>
              </div>

              <div className="flex flex-wrap justify-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => selectPreset(7, 1)}
                  className={`rounded-lg px-2.5 py-1 font-bold border ${
                    baseMinutes === 7 ? 'bg-white text-stone-950 border-white' : 'bg-stone-800 text-stone-300 border-stone-600'
                  }`}
                >
                  7:00 דק׳ (רגיל)
                </button>
                <button
                  type="button"
                  onClick={() => selectPreset(6, 1)}
                  className={`rounded-lg px-2.5 py-1 font-bold border ${
                    baseMinutes === 6 ? 'bg-white text-stone-950 border-white' : 'bg-stone-800 text-stone-300 border-stone-600'
                  }`}
                >
                  6:00 דק׳ (חצי שעה אחרונה)
                </button>
                <button
                  type="button"
                  onClick={addStoppageTime}
                  className="rounded-lg px-2.5 py-1 font-extrabold bg-amber-500/20 text-amber-200 border border-amber-400/50"
                >
                  +1:00 תוספת זמן
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const custom = prompt('הזן מספר דקות למשחק:', String(baseMinutes))
                    if (custom && Number(custom) > 0) selectPreset(Number(custom), 1)
                  }}
                  className="rounded-lg px-2.5 py-1 font-bold bg-stone-800 text-stone-300 border border-stone-600"
                >
                  ✏️ זמן מותאם
                </button>
              </div>
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-2 gap-3">
            {[
              { idx: teamA, label: nameA, list: rosters[teamA] || [] },
              { idx: teamB, label: nameB, list: rosters[teamB] || [] },
            ].map((side) => (
              <div key={side.idx} className="bg-black/55 backdrop-blur-sm rounded-2xl p-2.5 border border-white/25 space-y-2">
                <div className="flex items-center justify-center gap-1.5 border-b border-white/15 pb-1.5">
                  <span className="w-3 h-3 rounded-full border border-white" style={{ background: CSS_COLORS[side.label] || '#57534e' }} />
                  <span className="font-extrabold text-sm">{side.label}</span>
                </div>

                <div className="space-y-1.5">
                  {side.list.map((pName) => {
                    const pGoals = events.filter((e) => e.type === 'goal' && e.scorer === pName).length
                    const pAssists = events.filter((e) => e.assist === pName).length
                    return (
                      <div key={pName} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setSelectedPlayer({ name: pName, team: side.idx }); setPendingAssist('') }}
                          className="flex-1 text-right rounded-xl bg-white/95 hover:bg-amber-100 text-stone-950 px-2.5 py-2 text-xs sm:text-sm font-extrabold shadow flex items-center justify-between transition active:scale-95"
                        >
                          <span className="truncate">{pName}</span>
                          <span className="flex items-center gap-1 shrink-0 text-[11px]">
                            {pGoals > 0 && <span className="bg-green-700 text-white px-1.5 rounded-full">⚽{pGoals}</span>}
                            {pAssists > 0 && <span className="bg-amber-500 text-stone-950 px-1.5 rounded-full">🎯{pAssists}</span>}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removePlayerFromTeam(side.idx, pName)}
                          title="הסר שחקן מקבוצה זו"
                          className="text-white/60 hover:text-red-300 text-xs px-1"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                  {side.list.length === 0 && (
                    <p className="text-[11px] text-white/70 text-center py-2">אין שחקנים משובצים</p>
                  )}
                </div>

                <div className="pt-1 border-t border-white/15 flex gap-1">
                  <input
                    list="live-players-dl"
                    placeholder="+ הוסף/השלם שחקן..."
                    value={addPlayerInput[side.idx] || ''}
                    onChange={(e) => setAddPlayerInput((p) => ({ ...p, [side.idx]: e.target.value }))}
                    className="w-full rounded-lg bg-black/50 border border-white/25 px-2 py-1 text-xs text-white placeholder-white/50"
                  />
                  <button
                    type="button"
                    onClick={() => moveOrAddPlayerToTeam(side.idx, addPlayerInput[side.idx])}
                    className="rounded-lg bg-white/20 hover:bg-white/30 px-2 py-1 text-xs font-black"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <datalist id="live-players-dl">
            {Array.from(new Set([...confirmed.map((c) => c.player_name), ...knownNames])).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          {events.length > 0 && (
            <div className="relative z-10 bg-stone-950/85 rounded-xl p-2.5 border border-white/15 space-y-1">
              <div className="text-xs font-bold text-stone-300">אירועים במשחקון הנוכחי:</div>
              <div className="flex flex-wrap gap-1.5">
                {events.map((ev) => (
                  <span key={ev.id} className="inline-flex items-center gap-1.5 rounded-full bg-stone-800 border border-stone-600 px-2.5 py-1 text-xs">
                    {ev.type === 'goal' ? (
                      <>
                        <span>⚽ <b>{ev.scorer}</b> <span className="text-stone-400">({colors[ev.team]})</span></span>
                        {ev.assist && <span className="text-amber-300">(🎯 {ev.assist})</span>}
                      </>
                    ) : (
                      <span>🎯 בישול: <b>{ev.assist}</b></span>
                    )}
                    <button type="button" onClick={() => removeEvent(ev.id)} className="text-red-400 font-bold mr-1">✕</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="relative z-10 bg-stone-950/90 rounded-2xl p-3 border border-white/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-sky-300">🥅 פנדלים להכרעה (במקרה תיקו)</span>
              <button
                type="button"
                onClick={() => setPenaltiesOpen((v) => !v)}
                className="rounded-lg px-2.5 py-1 text-xs font-bold bg-sky-600 text-white"
              >
                {penaltiesOpen ? 'סגור פנדלים' : 'פתח פנדלים'}
              </button>
            </div>

            {penaltiesOpen && (
              <div className="space-y-2 pt-1 border-t border-white/15">
                <p className="text-[11px] text-stone-300">
                  לחץ על כל עיגול להחלפה בין <b>⚽ הבקיע</b>, <b>❌ החמיץ</b> או ריק. בתיקו אחרי סבב 2 — זוג או פרד והוסף סבב מכריע:
                </p>
                {penRounds.map((r, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-stone-900 rounded-lg px-3 py-1.5 text-xs">
                    <span className="font-bold text-stone-400">סבב {idx + 1}</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => togglePenKick(idx, 'a')}
                        className="rounded-lg px-2.5 py-1 font-extrabold bg-stone-800 border border-stone-600"
                      >
                        {nameA}: {r.a === true ? '⚽' : r.a === false ? '❌' : '⚪'}
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePenKick(idx, 'b')}
                        className="rounded-lg px-2.5 py-1 font-extrabold bg-stone-800 border border-stone-600"
                      >
                        {nameB}: {r.b === true ? '⚽' : r.b === false ? '❌' : '⚪'}
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPenRounds((p) => [...p, { a: null, b: null }])}
                    className="rounded-lg px-3 py-1 text-xs font-bold bg-sky-800 text-white"
                  >
                    + הוסף סבב פנדלים
                  </button>
                  {penRounds.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setPenRounds((p) => p.slice(0, -1))}
                      className="rounded-lg px-2.5 py-1 text-xs bg-stone-800 text-stone-300"
                    >
                      הסר סבב אחרון
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={savingGame}
            onClick={finishAndSaveGame}
            className="relative z-10 w-full rounded-2xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-black text-base py-3.5 shadow-xl transition"
          >
            💾 שמור תוצאה וסיים משחקון ({scoreA}:{scoreB})
          </button>
        </section>

        {selectedPlayer && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={() => setSelectedPlayer(null)}>
            <div className="bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-sm p-4 space-y-4 text-white" onClick={(e) => e.stopPropagation()}>
              <div className="text-center">
                <div className="text-xs text-stone-400">{colors[selectedPlayer.team]}</div>
                <h3 className="text-xl font-black">{selectedPlayer.name}</h3>
              </div>

              <div className="space-y-2 bg-stone-800/80 p-3 rounded-xl border border-stone-700">
                <label className="block text-xs font-bold text-amber-300">
                  מי בישל את הגול? (אופציונלי — אפשר להשאיר ללא בישול)
                </label>
                <select
                  value={pendingAssist}
                  onChange={(e) => setPendingAssist(e.target.value)}
                  className="w-full rounded-lg bg-stone-950 border border-stone-600 px-3 py-2 text-sm text-white"
                >
                  <option value="">ללא בישול (סולו / ריבאונד)</option>
                  {(rosters[selectedPlayer.team] || [])
                    .filter((n) => n !== selectedPlayer.name)
                    .map((mate) => (
                      <option key={mate} value={mate}>🎯 {mate}</option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => recordGoal(selectedPlayer.name, selectedPlayer.team, pendingAssist)}
                  className="w-full rounded-xl bg-green-600 hover:bg-green-500 text-white font-black py-3 text-base shadow"
                >
                  ⚽ סמן גול {pendingAssist ? `+ בישול ל${pendingAssist}` : '(ללא בישול)'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => recordSoloAssist(selectedPlayer.name, selectedPlayer.team)}
                className="w-full rounded-xl bg-amber-500/20 border border-amber-400 text-amber-200 font-bold py-2.5 text-sm"
              >
                🎯 סמן בישול בלבד ל{selectedPlayer.name}
              </button>

              <button
                type="button"
                onClick={() => setSelectedPlayer(null)}
                className="w-full rounded-xl bg-stone-800 text-stone-300 py-2 text-sm font-bold"
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        {authed && (
          <section className="bg-stone-900 rounded-2xl p-4 border border-stone-700 space-y-3">
            <h2 className="text-base font-extrabold text-amber-300">📢 פרסום טבלאות לעמוד הראשי של השחקנים</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => togglePublishStats({ live: !settings?.live_stats_published })}
                className={`rounded-xl py-3 px-3 font-extrabold text-xs sm:text-sm border ${
                  settings?.live_stats_published
                    ? 'bg-green-700 text-white border-green-500'
                    : 'bg-stone-800 text-stone-200 border-stone-600'
                }`}
              >
                {settings?.live_stats_published
                  ? '👁️ טבלת המחזור מפורסמת (לחץ להסתרה)'
                  : '🙈 פרסם טבלת מחזור (מנצחת + שערים/בישולים)'}
              </button>

              <button
                type="button"
                onClick={() => togglePublishStats({ alltime: !settings?.alltime_stats_published })}
                className={`rounded-xl py-3 px-3 font-extrabold text-xs sm:text-sm border ${
                  settings?.alltime_stats_published
                    ? 'bg-purple-800 text-white border-purple-500'
                    : 'bg-stone-800 text-stone-200 border-stone-600'
                }`}
              >
                {settings?.alltime_stats_published
                  ? '👁️ טבלת שיאים כללית מפורסמת (לחץ להסתרה)'
                  : '📊 פרסם טבלת שיאים וסטטיסטיקה כללית'}
              </button>
            </div>
          </section>
        )}

        <div className="text-stone-950">
          <MatchdayTables games={activeGamesList} colors={colors} />
        </div>

        {activeGamesList.length > 0 && (
          <section className="bg-stone-900 rounded-2xl p-4 border border-stone-700 space-y-2">
            <h3 className="text-sm font-extrabold text-stone-200">היסטוריית משחקונים היום ({activeGamesList.length})</h3>
            <ul className="divide-y divide-stone-800 text-xs">
              {activeGamesList.map((g, i) => (
                <li key={g.id} className="py-2 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-stone-400 ml-2">#{i + 1}</span>
                    <b>{colors[g.team_a]}</b> {g.score_a} - {g.score_b} <b>{colors[g.team_b]}</b>
                    {(g.pen_a > 0 || g.pen_b > 0) && <span className="text-sky-300 mr-1">(פנדלים {g.pen_a}:{g.pen_b})</span>}
                  </div>
                  <button type="button" onClick={() => deleteSavedGame(g.id)} className="text-red-400 font-bold px-2">
                    מחק
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}

/* ---------- Admin: FC Card Builder ---------- */
function FcCardModal({ name, initial, onSave, onClose }) {
  const [c, setC] = useState({
    ...DEFAULT_CARD,
    ...initial,
    ovr: initial?.ovr ?? null,
    playstyle_plus_2: initial?.playstyle_plus_2 || '',
    playstyles: Array.isArray(initial?.playstyles) ? initial.playstyles : [],
    skill_moves: initial?.skill_moves ?? 3,
    weak_foot: initial?.weak_foot ?? 3,
  })
  const [busy, setBusy] = useState(false)

  const [rawImg, setRawImg] = useState(null)
  const [zoom, setZoom] = useState(1.2)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const fileInputRef = useRef(null)

  const set = (k, v) => setC((x) => ({ ...x, [k]: v }))

  const toggleGrayPlaystyle = (psKey) => {
    setC((prev) => {
      const list = Array.isArray(prev.playstyles) ? prev.playstyles : []
      if (list.includes(psKey)) {
        return { ...prev, playstyles: list.filter((x) => x !== psKey) }
      }
      if (list.length >= 6) return prev
      return { ...prev, playstyles: [...list, psKey] }
    })
  }

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
      ovr: c.ovr != null && c.ovr !== '' ? clamp(c.ovr, 40, 99) : null,
      height_cm: clamp(c.height_cm, 150, 210),
      photo_url: finalPhoto,
      playstyle_plus: c.playstyle_plus || '',
      playstyle_plus_2: c.playstyle_plus_2 || '',
      playstyles: Array.isArray(c.playstyles) ? c.playstyles : [],
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

  const currentOvr = ovrOf(c)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-chalk w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <FutCard name={name} card={c} interactivePhoto={interactivePhotoNode} />

        <AdminPlaystylesRow
          plusList={[c.playstyle_plus, c.playstyle_plus_2]}
          grayList={c.playstyles || []}
        />

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

        <div className="bg-white rounded-xl p-3 border border-stone-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-extrabold text-stone-800">אוברול (OVR) על הקלף</span>
            {c.ovr != null && (
              <button
                type="button"
                onClick={() => set('ovr', null)}
                className="text-xs text-pitch underline font-bold"
              >
                אפס לחישוב אוטומטי ({clamp(statAvg(c), 40, 99)})
              </button>
            )}
          </div>
          <label className="flex items-center gap-2">
            <span className="w-10 text-sm font-bold" dir="ltr">OVR</span>
            <input
              type="range"
              min="40"
              max="99"
              value={currentOvr}
              onChange={(e) => set('ovr', Number(e.target.value))}
              className="flex-1"
            />
            <input
              type="number"
              min="40"
              max="99"
              value={currentOvr}
              className={input}
              onChange={(e) => set('ovr', e.target.value === '' ? '' : Number(e.target.value))}
              onBlur={() => set('ovr', clamp(currentOvr, 40, 99))}
            />
          </label>
        </div>

        {STATS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <span className="w-10 text-sm font-bold" dir="ltr">{label}</span>
            <input type="range" min="40" max="99" value={clamp(c[k], 40, 99)} onChange={(e) => set(k, Number(e.target.value))} className="flex-1" />
            <input type="number" min="40" max="99" value={c[k]} className={input}
              onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} onBlur={() => set(k, clamp(c[k], 40, 99))} />
          </label>
        ))}

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

          <div className="pt-2 border-t border-stone-100 space-y-2">
            <label className="block">
              <span className="text-xs font-bold text-amber-800">◆ PlayStyle+ ראשי (זהב — מופיע על הקלף וגם למטה)</span>
              <select
                value={c.playstyle_plus || ''}
                onChange={(e) => set('playstyle_plus', e.target.value)}
                className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-2 text-sm font-medium"
              >
                <option value="">ללא PlayStyle+ ראשי</option>
                {PLAYSTYLES.map(([k, ico, label]) => (
                  <option key={k} value={k}>{ico} {label}+</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-amber-800">◆ PlayStyle+ שני (זהב — מופיע רק בשורה למטה באדמין)</span>
              <select
                value={c.playstyle_plus_2 || ''}
                onChange={(e) => set('playstyle_plus_2', e.target.value)}
                className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-2 text-sm font-medium"
              >
                <option value="">ללא PlayStyle+ שני</option>
                {PLAYSTYLES.map(([k, ico, label]) => (
                  <option key={k} value={k}>{ico} {label}+</option>
                ))}
              </select>
            </label>
          </div>

          <div className="pt-2 border-t border-stone-100 space-y-1.5">
            <span className="block text-xs font-bold text-stone-700">
              ◇ PlayStyles רגילים באפור (עד 6 — מופיעים רק בשורה למטה באדמין)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PLAYSTYLES.map(([k, ico, label]) => {
                const selected = (c.playstyles || []).includes(k)
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleGrayPlaystyle(k)}
                    className={`rounded-lg px-2 py-1 text-xs font-bold border transition ${
                      selected
                        ? 'bg-slate-700 text-white border-slate-900'
                        : 'bg-stone-100 text-stone-700 border-stone-300'
                    }`}
                  >
                    {ico} {label.replace(/\s*\(.*\)/, '')}
                  </button>
                )
              })}
            </div>
          </div>
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
  const { settings, allTimeStats, reload } = useLive()
  const [rows, setRows] = useState([])
  const [draft, setDraft] = useState(null)
  const [ratings, setRatings] = useState({})
  const [cardFor, setCardFor] = useState(null)
  const [awardsDraft, setAwardsDraft] = useState(null)
  const [awardsSaved, setAwardsSaved] = useState(null)
  const [next, setNext] = useState(null)
  const [showSecondWinner, setShowSecondWinner] = useState({})
  const [rosterSearch, setRosterSearch] = useState('')
  const [newPlayerName, setNewPlayerName] = useState('')
  const [rosterOpen, setRosterOpen] = useState(false)
  const [allTimeOpen, setAllTimeOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [paidFilter, setPaidFilter] = useState('all')
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
        top_scorer_2: aw[0].top_scorer_2 || '',
        mvp_star: aw[0].mvp_star || '',
        mvp_star_2: aw[0].mvp_star_2 || '',
        best_duo: aw[0].best_duo || '',
        best_duo_2: aw[0].best_duo_2 || '',
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
    if (settings && !draft) {
      setDraft({
        ...settings,
        team_colors: settings.team_colors.join(', '),
        registration_open: settings.registration_open !== false,
        registration_note: settings.registration_note || 'ההרשמה למשחק הקרוב תיפתח ביום רביעי בשעה 10:00',
        bit_enabled: settings.bit_enabled !== false,
        list_published: Boolean(settings.list_published),
        live_page_published: Boolean(settings.live_page_published),
        payment_timeout_hours: Number(settings.payment_timeout_hours ?? 48),
        ntfy_topic: cleanNtfyTopic(settings.ntfy_topic),
      })
    }
  }, [settings, draft])
  useEffect(() => {
    if (settings && !next) setNext({ match_time: settings.match_time, price: settings.price, bit_link: settings.bit_link })
  }, [settings, next])

  const confirmedRows = rows.filter((r) => r.status === 'confirmed')
  const filteredConfirmed = confirmedRows.filter((r) =>
    paidFilter === 'paid' ? r.is_paid : paidFilter === 'unpaid' ? !r.is_paid : true
  )
  const allKnownNames = Array.from(new Set([...rows.map((r) => r.player_name), ...Object.keys(ratings)])).sort()
  const colors = settings?.team_colors || []
  const cardOf = (nameOrRow) => {
    const pName = typeof nameOrRow === 'string' ? nameOrRow : nameOrRow.player_name
    return { ...DEFAULT_CARD, ...ratings[pName] }
  }
  const rOf = (nameOrRow) => {
    const pName = typeof nameOrRow === 'string' ? nameOrRow : nameOrRow.player_name
    return Number(ratings[pName]?.rating ?? 3)
  }
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
  const rate = (nameOrRow) => {
    const pName = typeof nameOrRow === 'string' ? nameOrRow : nameOrRow.player_name
    return (
      <select aria-label={`דירוג ${pName}`} value={ratings[pName]?.rating ?? ''}
        onChange={(e) => setRating(pName, Number(e.target.value))}
        className="rounded border border-stone-300 bg-white px-1 py-1 text-sm">
        <option value="" disabled>דירוג</option>
        {RATING_STEPS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    )
  }
  const smBtn = 'rounded-lg px-2 py-1 text-sm'
  const setRole = async (name, role) => {
    setRatings((m) => ({ ...m, [name]: { ...DEFAULT_CARD, ...m[name], player_name: name, role } }))
    try { await rpc('admin_set_role', { p_pin: pin, p_name: name, p_role: role }) }
    catch { alert('שמירת התפקיד נכשלה'); refresh() }
  }
  const roleSel = (nameOrRow) => {
    const pName = typeof nameOrRow === 'string' ? nameOrRow : nameOrRow.player_name
    return (
      <select aria-label={`תפקיד ${pName}`} value={cardOf(pName).role} onChange={(e) => setRole(pName, e.target.value)}
        className="rounded border border-stone-300 bg-white px-1 py-1 max-w-32 text-sm">
        {ROLES.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    )
  }
  const saveCard = async (name, c) => {
    try {
      await rpc('admin_set_player_card', {
        p_pin: pin, p_name: name, p_role: c.role, p_height_cm: c.height_cm,
        p_pac: c.pac, p_sho: c.sho, p_pas: c.pas, p_dri: c.dri, p_def: c.def, p_phy: c.phy,
        p_photo_url: c.photo_url || '',
        p_playstyle_plus: c.playstyle_plus || '',
        p_playstyle_plus_2: c.playstyle_plus_2 || '',
        p_playstyles: Array.isArray(c.playstyles) ? c.playstyles : [],
        p_skill_moves: c.skill_moves ?? 3,
        p_weak_foot: c.weak_foot ?? 3,
        p_ovr: c.ovr != null && c.ovr !== '' ? clamp(c.ovr, 40, 99) : null,
      })
      await refresh()
      setCardFor(null)
    } catch { alert('שמירת הקלף נכשלה') }
  }

  const renameRegistration = async (r) => {
    const nextName = prompt('הזן שם מתוקן לנרשם:', r.player_name)
    if (!nextName || nextName.trim() === r.player_name || nextName.trim().length < 2) return
    await act('admin_rename_registration', { p_id: r.id, p_new_name: nextName.trim() })()
  }

  const renameRosterPlayer = async (oldName) => {
    const nextName = prompt('הזן שם חדש לשחקן במאגר (אם השם כבר קיים, הנתונים יאוחדו):', oldName)
    if (!nextName || nextName.trim() === oldName || nextName.trim().length < 2) return
    await act('admin_rename_player_rating', { p_old_name: oldName, p_new_name: nextName.trim() })()
  }

  const editPlayerAllTime = async (pName) => {
    const cur = ratings[pName] || {}
    const g = prompt(`סה״כ שערים בקריירה עבור ${pName}:`, String(cur.total_goals ?? 0))
    if (g === null) return
    const a = prompt(`סה״כ בישולים בקריירה עבור ${pName}:`, String(cur.total_assists ?? 0))
    if (a === null) return
    const m = prompt(`כמות משחקים ששיחק עבור ${pName}:`, String(cur.total_matches ?? 0))
    if (m === null) return
    const w = prompt(`כמות ניצחונות עבור ${pName}:`, String(cur.total_wins ?? 0))
    if (w === null) return
    const mvp = prompt(`פעמים כוכב המחזור עבור ${pName}:`, String(cur.awards_mvp ?? 0))
    if (mvp === null) return
    const ts = prompt(`פעמים מלך שערים עבור ${pName}:`, String(cur.awards_top_scorer ?? 0))
    if (ts === null) return
    const gow = prompt(`פעמים שער המחזור עבור ${pName}:`, String(cur.awards_goal_of_week ?? 0))
    if (gow === null) return
    await act('admin_set_player_alltime', {
      p_name: pName,
      p_goals: Number(g) || 0,
      p_assists: Number(a) || 0,
      p_matches: Number(m) || 0,
      p_wins: Number(w) || 0,
      p_mvp: Number(mvp) || 0,
      p_top_scorer: Number(ts) || 0,
      p_goal_of_week: Number(gow) || 0,
    })()
  }

  const addManualPlayer = (targetStatus) => async () => {
    const clean = manualName.trim()
    if (clean.length < 2) return alert('יש להזין שם שחקן (לפחות 2 תווים)')
    await act('admin_add_registration', { p_name: clean, p_status: targetStatus })()
    setManualName('')
  }

  const addPlayerToRoster = async (e) => {
    e.preventDefault()
    const clean = newPlayerName.trim()
    if (!clean) return
    await setRating(clean, 3)
    setNewPlayerName('')
    setCardFor(clean)
  }

  const deleteFromRoster = async (pName) => {
    if (!confirm(`למחוק את "${pName}" ממאגר השחקנים והדירוגים הקבוע?`)) return
    try {
      await rpc('admin_delete_player_rating', { p_pin: pin, p_name: pName })
      await refresh()
    } catch { alert('מחיקת השחקן נכשלה') }
  }

  const bulk = (message, fn, args) => () => confirm(message) && act(fn, args)()

  const saveAwards = (publish) => async () => {
    if (publish && !AWARDS.some(([k1, k2]) => awardsDraft[k1]?.trim() || awardsDraft[k2]?.trim())) {
      return alert('יש למלא לפחות קטגוריה אחת בנתוני המחזור')
    }
    if (!publish && !confirm('לבטל פרסום ולהסתיר את נתוני המחזור?')) return
    await act('admin_save_awards', {
      p_top_scorer: awardsDraft.top_scorer || '',
      p_top_scorer_2: awardsDraft.top_scorer_2 || '',
      p_mvp_star: awardsDraft.mvp_star || '',
      p_mvp_star_2: awardsDraft.mvp_star_2 || '',
      p_best_duo: awardsDraft.best_duo || '',
      p_best_duo_2: awardsDraft.best_duo_2 || '',
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
      p_top_scorer_2: awardsSaved?.top_scorer_2 ?? awardsDraft.top_scorer_2 ?? '',
      p_mvp_star: awardsSaved?.mvp_star ?? awardsDraft.mvp_star ?? '',
      p_mvp_star_2: awardsSaved?.mvp_star_2 ?? awardsDraft.mvp_star_2 ?? '',
      p_best_duo: awardsSaved?.best_duo ?? awardsDraft.best_duo ?? '',
      p_best_duo_2: awardsSaved?.best_duo_2 ?? awardsDraft.best_duo_2 ?? '',
      p_published: awardsSaved?.awards_published ?? false,
      p_potm_player: awardsDraft.potm_player || '',
      p_potm_published: publish,
    })()
  }

  const toggleListPublished = async () => {
    if (!draft) return
    const nextVal = !draft.list_published
    if (nextVal && !confirm(`לפרסם עכשיו את רשימת המגיעים (${confirmedRows.length}/${CAP}) ולפתוח למאושרים את כפתור ה-Bit?`)) return
    setDraft({ ...draft, list_published: nextVal })
    await act('admin_publish_list', { p_published: nextVal })()
  }

  const quickToggleSetting = async (patch) => {
    if (!draft) return
    const nextDraft = { ...draft, ...patch }
    const cleanedTopic = cleanNtfyTopic(nextDraft.ntfy_topic)
    nextDraft.ntfy_topic = cleanedTopic
    setDraft(nextDraft)
    await act('admin_update_settings', {
      p_location: nextDraft.location,
      p_match_time: nextDraft.match_time,
      p_price: Number(nextDraft.price),
      p_bit_link: nextDraft.bit_link,
      p_team_colors: nextDraft.team_colors.split(',').map((s) => s.trim()).filter(Boolean),
      p_registration_open: nextDraft.registration_open,
      p_registration_note: nextDraft.registration_note,
      p_bit_enabled: nextDraft.bit_enabled,
      p_ntfy_topic: cleanedTopic,
      p_list_published: nextDraft.list_published,
      p_payment_timeout_hours: Number(nextDraft.payment_timeout_hours ?? 48),
      p_live_page_published: Boolean(nextDraft.live_page_published),
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
    if (!confirm('לאפס את המשחק? ההרשמות, הקבוצות, משחקוני הלייב ונתוני המחזור יימחקו, והרשימה תחזור למצב מוסתר. הדירוגים, הקלפים, שחקן החודש וטבלת השיאים הכללית יישמרו.')) return
    await act('admin_reset_match', { p_match_time: next.match_time, p_price: Number(next.price), p_bit_link: next.bit_link })()
    setDraft(null); setAwardsDraft(null); await refresh()
  }

  const act = (fn, args) => async () => {
    try { await rpc(fn, { p_pin: pin, ...args }); await Promise.all([refresh(), reload()]) }
    catch (e) { alert(e.message === 'confirmed list is full' ? 'רשימת המגיעים מלאה' : 'הפעולה נכשלה') }
  }

  const saveSettings = async (e) => {
    e.preventDefault()
    await quickToggleSetting({})
    alert('ההגדרות נשמרו בהצלחה!')
  }

  const testPushNotification = async () => {
    const topic = cleanNtfyTopic(draft?.ntfy_topic)
    if (!topic) return alert('הזן קודם שם ערוץ התראות (למשל Weisgalilay1709)')
    if (draft.ntfy_topic !== topic) {
      setDraft({ ...draft, ntfy_topic: topic })
    }
    try {
      const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        body: 'בדיקת התראה! תקבל הודעה כזו באייפון בכל הרשמה חדשה ⚽',
        headers: { Title: 'Weisgal Football - Test' },
      })
      if (!res.ok) throw new Error()
      alert(`נשלחה התראת בדיקה לערוץ: ${topic}`)
    } catch {
      alert('שליחת ההתראה נכשלה. בדוק חיבור לאינטרנט.')
    }
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
  const List = ({ title, items, children, actions, extraHeader }) => (
    <section>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h2 className="text-xl font-bold">{title} ({items.length})</h2>
        {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
      </div>
      {extraHeader}
      {items.length === 0 && <p className="text-stone-500">אין שחקנים ברשימה.</p>}
      <ul className="divide-y divide-stone-200 bg-white rounded-lg">
        {items.map((r) => (
          <li key={r.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{r.player_name}</span>
              <button
                type="button"
                onClick={() => renameRegistration(r)}
                title="ערוך שם נרשם"
                className="text-xs text-stone-500 hover:text-stone-900 px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200"
              >
                ✏️
              </button>
            </div>
            <div className="flex gap-2 items-center flex-wrap">{children(r)}</div>
          </li>
        ))}
      </ul>
    </section>
  )
  const remove = (r) => <button className={`${btn} text-red-700`} onClick={() => confirm(`להסיר את ${r.player_name}?`) && act('admin_remove', { p_id: r.id })()}>הסר</button>
  const field = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2'

  const rosterNames = Object.keys(ratings)
    .filter((n) => !rosterSearch.trim() || n.includes(rosterSearch.trim()))
    .sort((a, b) => a.localeCompare(b, 'he'))

  const timeoutHours = Number(draft?.payment_timeout_hours ?? 48)
  const paidCount = confirmedRows.filter((r) => r.is_paid).length
  const unpaidCount = confirmedRows.length - paidCount

  return (
    <Shell title="ניהול משחק">
      <a
        href="/live"
        className="block w-full rounded-2xl bg-gradient-to-l from-green-800 to-pitch text-chalk p-4 text-center shadow-lg border-2 border-green-500/40 hover:brightness-105 transition"
      >
        <div className="text-lg font-black">⚽ כניסה למצב ניהול משחק חי (מגרש, שעון וסטטיסטיקות) ←</div>
        <div className="text-xs opacity-90 mt-0.5">לוח תוצאות חי · תיעוד גולים ובישולים · פנדלים · טבלת מנצחות</div>
      </a>

      {draft && (
        <section className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm space-y-3">
          <h2 className="text-lg font-extrabold">בקרה מהירה (סינון, פרסום רשימה ו-Bit)</h2>

          <button
            type="button"
            onClick={toggleListPublished}
            className={`w-full rounded-xl py-3.5 px-4 font-extrabold text-base border shadow-sm transition ${
              draft.list_published
                ? 'bg-blue-700 text-white border-blue-800'
                : 'bg-amber-500 text-stone-950 border-amber-600'
            }`}
          >
            {draft.list_published
              ? '👁️ רשימת המאושרים מפורסמת כעת (לחץ להסתרה)'
              : '🙈 רשימת המאושרים מוסתרת (לחץ לפרסום הרשימה ופתיחת Bit)'}
          </button>

          <button
            type="button"
            onClick={() => quickToggleSetting({ live_page_published: !draft.live_page_published })}
            className={`w-full rounded-xl py-3 px-4 font-extrabold text-sm border transition ${
              draft.live_page_published
                ? 'bg-emerald-700 text-white border-emerald-800'
                : 'bg-stone-100 text-stone-800 border-stone-300'
            }`}
          >
            {draft.live_page_published
              ? '🔗 הקישור לניהול משחק חי מפורסם לכולם (לחץ לביטול פרסום)'
              : '🔗 פרסם קישור לניהול משחק חי בקישור של כולם'}
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => quickToggleSetting({ registration_open: !draft.registration_open })}
              className={`rounded-xl py-3 px-4 font-bold text-sm border transition ${
                draft.registration_open
                  ? 'bg-green-700 text-white border-green-800'
                  : 'bg-stone-800 text-white border-stone-900'
              }`}
            >
              {draft.registration_open ? '🟢 ההרשמה פתוחה (לחץ לסגירה)' : '🔒 ההרשמה סגורה (לחץ לפתיחה)'}
            </button>

            <button
              type="button"
              onClick={() => quickToggleSetting({ bit_enabled: !draft.bit_enabled })}
              className={`rounded-xl py-3 px-4 font-bold text-sm border transition ${
                draft.bit_enabled
                  ? 'bg-bib text-white border-amber-700'
                  : 'bg-stone-200 text-stone-700 border-stone-300'
              }`}
            >
              {draft.bit_enabled ? '💳 תשלום Bit פעיל עם הפרסום' : '🚫 כפתור Bit כבוי ידנית'}
            </button>
          </div>

          <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-stone-700">⏱️ טיימר הדחה אוטומטית לתשלום:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                [48, '48 שעות'],
                [24, '24 שעות'],
                [12, '12 שעות'],
                [0, 'ללא טיימר (כבוי)'],
              ].map(([hrs, label]) => (
                <button
                  key={hrs}
                  type="button"
                  onClick={() => quickToggleSetting({ payment_timeout_hours: hrs })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold border transition ${
                    timeoutHours === hrs
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-stone-100 text-stone-700 border-stone-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm space-y-2">
        <h2 className="text-lg font-extrabold">➕ הוספת שחקן ידנית למשחק</h2>
        <div className="flex gap-2 flex-wrap">
          <input
            className={`${field} flex-1 min-w-[160px]`}
            list="players-dl"
            placeholder="בחר מהמאגר או הקלד שם..."
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
          />
          <button type="button" onClick={addManualPlayer('confirmed')} className={`${btn} bg-pitch text-chalk text-sm`}>
            הוסף למגיעים
          </button>
          <button type="button" onClick={addManualPlayer('pending')} className={`${btn} bg-stone-200 text-stone-800 text-sm`}>
            הוסף לממתינים
          </button>
        </div>
      </section>

      <List title="ממתינים לאישור" items={by('pending')}
        actions={by('pending').length > 0 && (
          <button className={`${btn} bg-pitch text-chalk`}
            onClick={bulk('לאשר את כל הממתינים? מעבר ל-15 מגיעים יועברו לרשימת מזמינים.', 'admin_approve_all', {})}>אשר הכל</button>
        )}>
        {(r) => <>
          {rate(r)}
          <button className={`${smBtn} bg-stone-800 text-white`} onClick={() => setCardFor(r.player_name)}>קלף FC</button>
          <button className={`${btn} bg-pitch text-chalk`} onClick={act('admin_approve', { p_id: r.id })}>אשר</button>
          {remove(r)}
        </>}
      </List>

      <List
        title="מגיעים"
        items={filteredConfirmed}
        actions={confirmedRows.length > 0 && <>
          <button className={`${smBtn} bg-green-50 text-green-800 border border-green-300`}
            onClick={bulk('לסמן את כל המגיעים כשילמו?', 'admin_set_all_paid', { p_is_paid: true })}>סמן לכולם שולם</button>
          <button className={`${smBtn} bg-red-50 text-red-800 border border-red-300`}
            onClick={bulk('לסמן את כל המגיעים כלא שילמו?', 'admin_set_all_paid', { p_is_paid: false })}>סמן לכולם לא שולם</button>
          {timeoutHours > 0 && (
            <button className={`${smBtn} bg-amber-50 text-amber-900 border border-amber-300`}
              onClick={bulk('לאפס את שעון התשלום לכל המגיעים שעדיין לא שילמו?', 'admin_reset_timers', {})}>⏱️ אפס טיימר</button>
          )}
        </>}
        extraHeader={confirmedRows.length > 0 && (
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {[
              ['all', `הכל (${confirmedRows.length})`],
              ['paid', `שילמו ✓ (${paidCount})`],
              ['unpaid', `לא שילמו ⏳ (${unpaidCount})`],
            ].map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setPaidFilter(val)}
                className={`rounded-full px-3 py-1 text-xs font-extrabold border transition ${
                  paidFilter === val
                    ? 'bg-pitch text-chalk border-pitch'
                    : 'bg-white text-stone-700 border-stone-300'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}
      >
        {(r) => <>
          {rate(r)}
          {roleSel(r)}
          <button className={`${smBtn} bg-stone-800 text-white`} onClick={() => setCardFor(r.player_name)}>קלף FC</button>
          <button
            type="button"
            className={`${smBtn} bg-amber-100 text-amber-950 border border-amber-300 font-bold`}
            onClick={() => confirm(`להעביר את ${r.player_name} לממתינים?`) && act('admin_move_to_pending', { p_id: r.id })()}
          >
            לממתינים
          </button>
          <select aria-label={`סטטוס תשלום ${r.player_name}`} value={r.is_paid ? 'true' : 'false'}
            onChange={(e) => act('admin_set_paid', { p_id: r.id, p_paid: e.target.value === 'true' })()}
            className={`rounded border px-1 py-1 ${r.is_paid ? 'bg-green-50 text-green-800 border-green-300' : 'bg-red-50 text-red-800 border-red-300'}`}>
            <option value="false">לא שולם</option>
            <option value="true">שולם</option>
          </select>
          {!r.is_paid && timeoutHours > 0 && (
            <span className="text-sm text-stone-600"><Countdown since={r.approved_at} hours={timeoutHours} /></span>
          )}
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
          <p className="text-xs text-stone-600">פרסום נתוני המחזור מוסיף אוטומטית +1 לזכיות בטבלת השיאים הכללית!</p>
          {AWARDS.map(([k1, k2, icon, label]) => {
            const hasSecond = showSecondWinner[k1] || Boolean(awardsDraft[k2]?.trim())
            return (
              <div key={k1} className="space-y-2 border-b border-stone-100 pb-3 last:border-b-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{icon} {label}</span>
                  {!hasSecond && (
                    <button
                      type="button"
                      onClick={() => setShowSecondWinner((prev) => ({ ...prev, [k1]: true }))}
                      className="text-xs font-bold text-pitch underline"
                    >
                      + הוסף שחקן נוסף (תיקו)
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <input className={field} list="players-dl" placeholder="בחר או הקלד שם שחקן..." value={awardsDraft[k1] || ''} onChange={(e) => setAwardsDraft({ ...awardsDraft, [k1]: e.target.value })} />
                  {awardsDraft[k1]?.trim() && (
                    <button type="button" onClick={() => setCardFor(awardsDraft[k1].trim())} className="rounded-lg px-3 py-2 text-xs font-bold bg-stone-800 text-white shrink-0">
                      ערוך קלף
                    </button>
                  )}
                </div>

                {hasSecond && (
                  <div className="flex gap-2 items-center pr-3 border-r-2 border-amber-400">
                    <input className={field} list="players-dl" placeholder="שחקן שני בתיקו..." value={awardsDraft[k2] || ''} onChange={(e) => setAwardsDraft({ ...awardsDraft, [k2]: e.target.value })} />
                    {awardsDraft[k2]?.trim() && (
                      <button type="button" onClick={() => setCardFor(awardsDraft[k2].trim())} className="rounded-lg px-3 py-2 text-xs font-bold bg-stone-800 text-white shrink-0">
                        ערוך קלף
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAwardsDraft({ ...awardsDraft, [k2]: '' })
                        setShowSecondWinner((prev) => ({ ...prev, [k1]: false }))
                      }}
                      className="text-xs text-red-700 font-bold px-2"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )
          })}
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

      <section className="bg-white rounded-xl p-4 border border-stone-200 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">טבלת סטטיסטיקה כללית (כל הזמנים)</h2>
            <p className="text-xs text-stone-500">כל המאגר · גולים, בישולים, משחקים, % ניצחון ותארים עם מיון עולה/יורד.</p>
          </div>
          <button
            type="button"
            onClick={() => setAllTimeOpen((v) => !v)}
            className="rounded-lg px-3 py-1.5 text-sm font-bold bg-stone-100 border border-stone-300 shrink-0"
          >
            {allTimeOpen ? 'הסתר ▲' : 'הצג ▼'}
          </button>
        </div>

        {allTimeOpen && (
          <div className="space-y-3 pt-2 border-t border-stone-200">
            <button
              type="button"
              onClick={async () => {
                await rpc('admin_publish_stats', {
                  p_pin: pin,
                  p_live: Boolean(settings?.live_stats_published),
                  p_alltime: !settings?.alltime_stats_published,
                })
                await reload()
              }}
              className={`w-full rounded-xl py-2.5 px-3 font-extrabold text-sm border ${
                settings?.alltime_stats_published
                  ? 'bg-purple-900 text-white border-purple-950'
                  : 'bg-stone-100 text-stone-800 border-stone-300'
              }`}
            >
              {settings?.alltime_stats_published
                ? '👁️ טבלת השיאים מפורסמת באתר (לחץ להסתרה)'
                : '📢 פרסם טבלת שיאים בעמוד הראשי'}
            </button>
            <AllTimeTable stats={allTimeStats} />
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl p-4 border border-stone-200 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">מאגר שחקנים ודירוגים קבוע ({Object.keys(ratings).length})</h2>
            <p className="text-xs text-stone-500">ערוך שמות, דירוגים, תפקידים, קלפי FC וסטטיסטיקה היסטורית.</p>
          </div>
          <button
            type="button"
            onClick={() => setRosterOpen((v) => !v)}
            className="rounded-lg px-3 py-1.5 text-sm font-bold bg-stone-100 border border-stone-300"
          >
            {rosterOpen ? 'הסתר מאגר ▲' : 'פתח מאגר ▼'}
          </button>
        </div>

        {rosterOpen && (
          <div className="space-y-3 pt-2 border-t border-stone-200">
            <form onSubmit={addPlayerToRoster} className="flex gap-2">
              <input
                className={field}
                placeholder="הוסף שחקן חדש למאגר..."
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
              />
              <button className={`${btn} bg-pitch text-chalk shrink-0`}>+ הוסף</button>
            </form>

            <input
              className={field}
              placeholder="🔍 חיפוש שחקן במאגר..."
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
            />

            <ul className="divide-y divide-stone-200 max-h-96 overflow-y-auto border border-stone-200 rounded-lg">
              {rosterNames.map((pName) => (
                <li key={pName} className="p-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-stone-50">
                  <div className="flex items-center gap-2">
                    {ratings[pName]?.photo_url ? (
                      <img src={ratings[pName].photo_url} alt={pName} className="w-8 h-8 rounded-full object-cover border border-stone-300" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-xs font-bold text-stone-600">
                        {ovrOf(cardOf(pName))}
                      </span>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm">{pName}</span>
                        <button
                          type="button"
                          onClick={() => renameRosterPlayer(pName)}
                          title="ערוך שם במאגר"
                          className="text-[11px] text-stone-500 hover:text-stone-900 px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200"
                        >
                          ✏️
                        </button>
                      </div>
                      <div className="text-[11px] text-stone-500">
                        OVR {ovrOf(cardOf(pName))} · ⚽{ratings[pName]?.total_goals ?? 0} 🎯{ratings[pName]?.total_assists ?? 0}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {rate(pName)}
                    {roleSel(pName)}
                    <button type="button" className={`${smBtn} bg-stone-800 text-white`} onClick={() => setCardFor(pName)}>
                      קלף FC
                    </button>
                    <button type="button" className={`${smBtn} bg-amber-100 text-amber-900 border border-amber-300`} onClick={() => editPlayerAllTime(pName)} title="ערוך שערים/בישולים/משחקים/ניצחונות/תארים">
                      📊
                    </button>
                    <button type="button" className="text-red-600 text-xs font-bold px-2 py-1" onClick={() => deleteFromRoster(pName)}>
                      🗑️
                    </button>
                  </div>
                </li>
              ))}
              {rosterNames.length === 0 && <li className="p-3 text-center text-sm text-stone-500">לא נמצאו שחקנים.</li>}
            </ul>
          </div>
        )}
      </section>

      {draft && (
        <form onSubmit={saveSettings} className="space-y-3 bg-white rounded-xl p-4 border border-stone-200">
          <h2 className="text-xl font-bold">הגדרות משחק והתראות</h2>
          {[['location', 'מיקום'], ['match_time', 'זמן'], ['price', 'מחיר (₪)'], ['bit_link', 'קישור Bit'], ['team_colors', 'צבעי קבוצות (מופרדים בפסיק)'], ['registration_note', 'הודעה כשההרשמה סגורה']].map(([k, label]) => (
            <label key={k} className="block"><span className="text-sm font-medium">{label}</span>
              <input className={field} value={draft[k]} type={k === 'price' ? 'number' : 'text'}
                dir={k === 'bit_link' ? 'ltr' : undefined} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            </label>
          ))}

          <label className="block">
            <span className="text-sm font-medium">שעות טיימר להדחה אוטומטית (0 = ללא טיימר)</span>
            <input
              className={field}
              type="number"
              min="0"
              max="168"
              value={draft.payment_timeout_hours ?? 48}
              onChange={(e) => setDraft({ ...draft, payment_timeout_hours: Number(e.target.value) })}
            />
          </label>

          <div className="pt-2 border-t border-stone-200 space-y-1">
            <span className="text-sm font-bold">🔔 התראות Push לאייפון בהרשמה חדשה (ntfy)</span>
            <p className="text-xs text-stone-500">
              הזן בדיוק את שם הערוץ כפי שמופיע באפליקציית ntfy (למשל: <code dir="ltr">Weisgalilay1709</code>):
            </p>
            <div className="flex gap-2">
              <input
                className={field}
                dir="ltr"
                placeholder="Weisgalilay1709"
                value={draft.ntfy_topic || ''}
                onChange={(e) => setDraft({ ...draft, ntfy_topic: e.target.value })}
              />
              <button type="button" onClick={testPushNotification} className="rounded-lg px-3 py-2 text-xs font-bold bg-stone-800 text-white shrink-0">
                בדיקת התראה
              </button>
            </div>
          </div>

          <button className={`${btn} w-full bg-pitch text-chalk`}>שמור הגדרות</button>
        </form>
      )}

      {next && (
        <form onSubmit={doReset} className="space-y-3 border-t border-stone-300 pt-5">
          <h2 className="text-xl font-bold">איפוס משחק לשבוע הבא</h2>
          <p className="text-sm text-stone-600">מוחק את כל ההרשמות, הקבוצות, משחקוני הלייב ונתוני המחזור ומבטל פרסום. הדירוגים, הקלפים, שחקן החודש וטבלת השיאים הכללית נשמרים.</p>
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
  if (location.pathname.startsWith('/live')) return <LivePitchPage />
  if (location.pathname.startsWith('/admin')) return <Admin />
  return <Player />
}
