// CPU の型ごとの撃破・被撃破・与ダメージ・攻撃回数。node _styles.mjs [試合数] [all=自機の枠も型にする]
import * as G from './src/game.js'
const N = +process.argv[2] || 30
const FROM = +(process.argv.find(a => a.startsWith('from=')) || 'from=0').slice(5) // 並列で回すときの開始番号
const S = {}, add = (k, f, v = 1) => { S[k] ??= { n: 0, kills: 0, deaths: 0, dmg: 0, blade: 0, shoot: 0, snipe: 0, tele: 0, cham: 0, swap: 0 }; S[k][f] += v }
let win = [0, 0, 0], kills = 0
for (let m = FROM; m < FROM + N; m++) {
  const st = G.createState(5000 + m, { autoplay: true, stage: ['city', 'harbor', 'mall'][m % 3] })
  const key = u => u.style || 'player:' + u.role
  if (process.argv.includes('all')) { // 自機の枠も型にする（型どうしだけの釣り合いを見る）
    const me = st.units[0], used = st.units.filter(u => u.team === 0).map(u => u.slot)
    const k = Object.keys(G.STYLES).find(k => G.STYLES[k].slot === 'mid' && !st.units.some(u => u.style === k && u.team === 0)) || 'gunner', S = G.STYLES[k]
    Object.assign(me, { style: k, slot: S.slot, trig: [...S.trig], held: null, ammo: S.ammo[0], stats: { ...S.stats }, name: S.name, melee: S.trig.find(t => G.TRIGGER_CLASS[t] === 'melee') || null, gun: S.trig.find(t => G.TRIGGER_CLASS[t] === 'gun') || null, sniper: S.trig.find(t => G.TRIGGER_CLASS[t] === 'sniper') || null, role: G.roleOf(S.trig) })
  }
  for (const u of st.units) add(key(u), 'n')
  let s = 0
  while (st.phase === 'play' && s < 60 * 320) { G.step(st, {}); s++
    for (const e of G.drainEvents(st)) {
      const u = st.units[e.id]
      if (e.type === 'hit') add(key(st.units[e.src]), 'dmg', e.amount)
      else if (e.type === 'bailout') { kills++; add(key(u), 'deaths'); const k = st.units[e.killer]; if (k) add(key(k), 'kills') }
      else if (e.type === 'blade') add(key(u), 'blade')
      else if (e.type === 'shoot') add(key(u), 'shoot')
      else if (e.type === 'snipe') add(key(u), 'snipe')
      else if (e.type === 'teleport') add(key(u), 'tele')
      else if (e.type === 'cham' && e.on) add(key(u), 'cham')
      else if (e.type === 'swap') add(key(u), 'swap')
    }
  }
  win[st.winner === -1 ? 2 : st.winner]++
}
if (process.argv.includes('json')) { console.log(JSON.stringify({ S, win, kills, N })); process.exit(0) }
console.log({ N, win0: win[0], win1: win[1], draw: win[2], killsPerMatch: +(kills / N).toFixed(1) })
console.table(Object.fromEntries(Object.entries(S).map(([k, v]) => [k, { n: v.n, 'K/人': +(v.kills / v.n).toFixed(2), 'D/人': +(v.deaths / v.n).toFixed(2), 'dmg/人': Math.round(v.dmg / v.n), 斬: Math.round(v.blade / v.n), 撃: Math.round(v.shoot / v.n), 狙: Math.round(v.snipe / v.n), 跳: Math.round(v.tele / v.n), 消: Math.round(v.cham / v.n), 替: Math.round(v.swap / v.n) }])))
