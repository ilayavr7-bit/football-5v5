// Splits 15 ratings into 3 teams of 5, minimising (strongest team total - weakest team total).
// Exhaustive search (~4.5M pairs, well under a second). Ties are broken by evenness, then randomly.
const N = 15
const masks = []
for (let m = 0; m < 1 << N; m++) {
  let c = 0
  for (let x = m; x; x >>= 1) c += x & 1
  if (c === 5) masks.push(m)
}

export function balance(ratings) {
  if (ratings.length !== N) throw new Error('need exactly 15 players')
  const all = (1 << N) - 1
  const total = ratings.reduce((a, b) => a + b, 0)
  const sums = masks.map((m) => ratings.reduce((s, r, i) => s + ((m >> i) & 1 ? r : 0), 0))
  let best = Infinity, ties = 0, pick = null
  for (let i = 0; i < masks.length; i++) {
    for (let j = i + 1; j < masks.length; j++) {
      if (masks[i] & masks[j]) continue
      const sa = sums[i], sb = sums[j], sc = total - sa - sb
      const spread = Math.max(sa, sb, sc) - Math.min(sa, sb, sc)
      const score = spread * 10000 + sa * sa + sb * sb + sc * sc
      if (score < best) { best = score; ties = 1; pick = [masks[i], masks[j], all & ~(masks[i] | masks[j])] }
      else if (score === best && Math.random() * ++ties < 1) pick = [masks[i], masks[j], all & ~(masks[i] | masks[j])]
    }
  }
  for (let k = 2; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [pick[k], pick[r]] = [pick[r], pick[k]] }
  return pick.map((m) => ratings.map((_, i) => i).filter((i) => (m >> i) & 1))
}
