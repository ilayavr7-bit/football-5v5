// Splits 15 players into 3 teams of 5 by a strict priority order:
//   1. Rating: smallest gap between strongest and weakest team total (ratings doubled to integers, so half-points are exact).
//   2. Roles: spread each tactical role as evenly as possible across the 3 teams.
//   3. Stats: even team averages for PAC, DEF+PHY and height.
// Accepts an array of numbers (ratings only) or objects { rating, role, pac, def, phy, height_cm }.
// Exhaustive search (~4.5M candidate pairs) with pruning, well under a second.
const N = 15
const R = 5
const ROLE_IDX = { 'מאוזן': 0, 'הגנה / שוער': 1, 'קישור / פליימייקר': 2, 'התקפה / סקורר': 3, 'כושר / רץ': 4 }

const masks = []
for (let m = 0; m < 1 << N; m++) {
  let c = 0
  for (let x = m; x; x >>= 1) c += x & 1
  if (c === 5) masks.push(m)
}

const spread3 = (a, b, c) => Math.max(a, b, c) - Math.min(a, b, c)

export function balance(input) {
  if (input.length !== N) throw new Error('need exactly 15 players')
  const P = input.map((p) => (typeof p === 'number' ? { rating: p } : p))
  const num = (v, d) => (v == null || Number.isNaN(Number(v)) ? d : Number(v))
  const w = P.map((p) => Math.round(num(p.rating, 3) * 2))
  const role = P.map((p) => ROLE_IDX[p.role] ?? 0)
  const pac = P.map((p) => num(p.pac, 70))
  const dp = P.map((p) => num(p.def, 70) + num(p.phy, 70))
  const ht = P.map((p) => num(p.height_cm, 175))

  const M = masks.length
  const sw = new Int32Array(M), sp = new Float64Array(M), sd = new Float64Array(M), sh = new Float64Array(M)
  const rc = new Int8Array(M * R)
  masks.forEach((m, k) => {
    for (let i = 0; i < N; i++) {
      if ((m >> i) & 1) { sw[k] += w[i]; sp[k] += pac[i]; sd[k] += dp[i]; sh[k] += ht[i]; rc[k * R + role[i]]++ }
    }
  })
  const sum = (a) => a.reduce((x, y) => x + y, 0)
  const tw = sum(w), tp = sum(pac), td = sum(dp), th = sum(ht)
  const tr = Array(R).fill(0)
  role.forEach((r) => tr[r]++)
  let minRoleCost = 0 // lowest possible sum of squared per-team role counts
  tr.forEach((n) => { const q = Math.floor(n / 3), rem = n % 3; minRoleCost += (3 - rem) * q * q + rem * (q + 1) * (q + 1) })

  const all = (1 << N) - 1
  let best = Infinity, ties = 0, pick = null
  for (let i = 0; i < M; i++) {
    for (let j = i + 1; j < M; j++) {
      if (masks[i] & masks[j]) continue
      const a = sw[i], b = sw[j]
      const s2 = spread3(a, b, tw - a - b)
      if (s2 * 1e7 > best) continue // can't beat the best rating gap found so far
      let cost = 0
      for (let r = 0; r < R; r++) {
        const x = rc[i * R + r], y = rc[j * R + r], z = tr[r] - x - y
        cost += x * x + y * y + z * z
      }
      const stat = spread3(sp[i], sp[j], tp - sp[i] - sp[j]) / 25
        + spread3(sd[i], sd[j], td - sd[i] - sd[j]) / 50
        + spread3(sh[i], sh[j], th - sh[i] - sh[j]) / 25
      const score = s2 * 1e7 + (cost - minRoleCost) * 1e4 + Math.round(stat * 100)
      if (score < best) { best = score; ties = 1; pick = [masks[i], masks[j], all & ~(masks[i] | masks[j])] }
      else if (score === best && Math.random() * ++ties < 1) pick = [masks[i], masks[j], all & ~(masks[i] | masks[j])]
    }
  }
  for (let k = 2; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [pick[k], pick[r]] = [pick[r], pick[k]] }
  return pick.map((m) => P.map((_, i) => i).filter((i) => (m >> i) & 1))
}
