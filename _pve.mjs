// 協力（PvE）を CPU だけで回して勝率を見る。node _pve.mjs <boss|defense> [試合数] [from=N] [json]
import * as G from './src/game.js'
const mode = process.argv[2] || 'boss', N = +process.argv[3] || 20
const FROM = +(process.argv.find(a => a.startsWith('from=')) || 'from=0').slice(5)
const R = { N, win: 0, reasons: {}, t: [], deaths: 0, kills: 0, hpLeft: [], wave: [], base: [], nan: 0, stuck: 0, parts: 0, stagger: 0, maxFoes: 0 }
for (let m = FROM; m < FROM + N; m++) {
  const st = G.createState(30000 + m, { autoplay: true, mode })
  let s = 0
  while (st.phase === 'play' && s < 60 * 900) {
    G.step(st, {}); s++
    for (const e of G.drainEvents(st)) { if (e.type === 'partBreak') R.parts++; if (e.type === 'stagger') R.stagger++ }
    if (s % 30 === 0) {
      R.maxFoes = Math.max(R.maxFoes, st.foes.filter(f => f.alive).length)
      for (const u of st.units) {
        if (![u.x, u.y, u.z, u.en].every(Number.isFinite)) R.nan++
        if (u.alive) for (const b of st.blocks) if (!b.y0 && u.y < b.h - 0.4 && Math.abs(u.x - b.x) < b.w / 2 - 0.05 && Math.abs(u.z - b.z) < b.d / 2 - 0.05) R.stuck++
      }
      for (const f of st.foes) if (!f.boss && ![f.x, f.z].every(Number.isFinite)) R.nan++
    }
  }
  if (st.winner === 0) R.win++
  R.reasons[st.endReason || 'none'] = (R.reasons[st.endReason || 'none'] || 0) + 1
  R.t.push(Math.round(st.t)); R.deaths += st.units.reduce((a, u) => a + u.deaths, 0); R.kills += st.score[0]
  if (mode === 'boss') R.hpLeft.push(Math.round(st.boss.hp / st.boss.maxHp * 100))
  else { R.wave.push(st.def.wave); R.base.push(st.def.base.hp) }
}
if (process.argv.includes('json')) console.log(JSON.stringify(R))
else console.log(mode, { win: `${R.win}/${N}`, reasons: R.reasons, medT: R.t.sort((a, b) => a - b)[N >> 1], deathsPerMatch: +(R.deaths / N).toFixed(1), killsPerMatch: +(R.kills / N).toFixed(1), hpLeft: R.hpLeft.join(','), wave: R.wave.join(','), base: R.base.join(','), nan: R.nan, stuck: R.stuck, parts: R.parts, stagger: R.stagger, maxFoes: R.maxFoes })
