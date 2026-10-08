import * as G from './src/game.js'
const N = +process.argv[2] || 150
const MEL = ['blade', 'scorpion'], GUN = ['handgun', 'rifle', 'shotgun', 'launcher'], SNP = ['snipe', 'lightning', 'ibis'], SUP = ['pad', 'bag', 'chameleon', 'teleport']
const stat = {}, add = (k, f, v) => { stat[k] ??= { n: 0, kills: 0, dmg: 0, deaths: 0, alive: 0 }; stat[k][f] += v }
let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const pick = a => a[Math.floor(rnd() * a.length)]
for (let m = 0; m < N; m++) {
  const st = G.createState(20000 + m, { autoplay: true, stage: m % 2 ? 'harbor' : 'city' })
  for (const u of st.units) {
    // 武器1〜2種＋補助で4枠
    const classes = [[MEL], [GUN], [SNP], [MEL, GUN], [MEL, SNP], [GUN, SNP]][Math.floor(rnd() * 6)]
    const w = classes.map(pick), sup = [...SUP].sort(() => rnd() - 0.5).slice(0, 4 - w.length)
    u.trig = G.validTriggers([...w, ...sup]); u.melee = u.trig.find(t => MEL.includes(t)) || null; u.gun = u.trig.find(t => GUN.includes(t)) || null; u.sniper = u.trig.find(t => SNP.includes(t)) || null
    u.role = G.roleOf(u.trig); u.ammo = pick(G.AMMO_TYPES); u.stats = { spd: 3, en: 3, atk: 3, jmp: 3 }
    u._keys = [...u.trig, u.gun ? 'ammo:' + u.ammo : null].filter(Boolean)
    for (const k of u._keys) add(k, 'n', 1)
  }
  let s = 0
  while (st.phase === 'play' && s < 60 * 300) { G.step(st, {}); s++
    if (s % 60 === 0) for (const u of st.units) if (u.alive) for (const k of u._keys) add(k, 'alive', 1)
    for (const e of G.drainEvents(st)) {
      if (e.type === 'hit') { const src = st.units[e.src]; const used = e.kind === 'blade' ? src.melee : e.kind === 'snipe' ? src.sniper : src.gun; add(used, 'dmg', e.amount); if (src.gun && used === src.gun) add('ammo:' + src.ammo, 'dmg', e.amount) }
      if (e.type === 'bailout') { const k = st.units[e.killer]; if (k) { const used = e.how; if (used) add(used, 'kills', 1); if (k.gun && used === k.gun) add('ammo:' + k.ammo, 'kills', 1) } for (const key of st.units[e.id]._keys) add(key, 'deaths', 1) }
    }
  }
}
const rows = Object.entries(stat).map(([k, v]) => ({ trig: k, units: v.n, killsPerUnit: +(v.kills / v.n).toFixed(2), dmgPerUnit: +(v.dmg / v.n).toFixed(0), deathsPerUnit: +(v.deaths / v.n).toFixed(2) }))
console.table(rows.sort((a, b) => b.killsPerUnit - a.killsPerUnit))
