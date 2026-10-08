// ロジックだけで試合を回して勝率・決着時間・事故を数える。node sim.mjs [試合数]
import * as G from './src/game.js'
const N = Number(process.argv[2] || 200)
let stalls = 0
let win = [0, 0, 0], durs = [], firsts = [], kills = 0, nan = 0, stuckIn = 0, bailRoles = {}, playerOut = 0
for (let i = 0; i < N; i++) {
  const st = G.createState(1000 + i, { autoplay: true })
  let steps = 0, lastChange = 0, lastSum = 0, first = -1
  while (st.phase === "play" && steps < 60 * (G.MATCH_TIME + 10)) {
    G.step(st, {})
    steps++
    const sum = st.units.reduce((a, u) => a + Math.round(u.en), 0)
    if (sum !== lastSum) { lastSum = sum; lastChange = steps }
    if (steps - lastChange === 60 * 20) stalls++
    for (const u of st.units) {
      if (![u.x, u.y, u.z, u.en].every(Number.isFinite)) nan++
      if (u.alive) for (const b of st.blocks) if (!b.y0 && u.y < b.h - 0.4 && Math.abs(u.x - b.x) < b.w / 2 - 0.05 && Math.abs(u.z - b.z) < b.d / 2 - 0.05) stuckIn++
    }
    for (const e of G.drainEvents(st)) if (e.type === 'hit' && first < 0) first = st.t; else if (e.type === 'bailout') { kills++; const r = st.units[e.id].role + e.team; bailRoles[r] = (bailRoles[r] || 0) + 1; if (st.units[e.id].player) playerOut++ }
  }
  win[st.winner === -1 ? 2 : st.winner]++
  durs.push(+st.t.toFixed(1)); if (first >= 0) firsts.push(first)
}
durs.sort((a, b) => a - b)
firsts.sort((a, b) => a - b)
console.log({ firstContact: +(firsts[firsts.length >> 1] || 0).toFixed(1), N, win0: win[0], win1: win[1], draw: win[2], medianTime: durs[N >> 1], minTime: durs[0], maxTime: durs[N - 1], stalls, killsPerMatch: +(kills / N).toFixed(2), playerOutRate: +(playerOut / N).toFixed(2), nan, stuckIn, bailRoles })
