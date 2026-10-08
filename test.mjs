// ロジックの検証。node test.mjs
import * as G from './src/game.js'
let pass = 0, fail = 0
// テストは以前の小さい街・固定の出撃位置で回す（地形を作り直しても検査の前提がずれない）
const mk = (seed, o = {}) => G.createState(seed, { blocks: G.LEGACY_BLOCKS, spawn: 'fixed', ...o })
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'OK  ' : 'FAIL'} ${name}${info !== '' ? '  ' + info : ''}`) }
const fresh = () => { const st = mk(42); for (const u of st.units) { u.x = 100; u.z = 100; u.alive = !u.player && u.id !== 3 ? false : true } return st }
const put = (u, x, z, extra = {}) => Object.assign(u, { x, z, y: 0, vx: 0, vz: 0, vy: 0, grounded: true }, extra)
const run = (st, n, inp = {}) => { for (let i = 0; i < n; i++) G.step(st, i === 0 ? inp : { ...inp, blade: false, shoot: false, pad: false, jump: false }) }
// 外した機体は再出撃させない（outT = -1）
const killAllBut = (st, ids) => st.units.forEach(u => { if (!ids.includes(u.id)) { u.alive = false; u.outT = -1 } })

{ // ブレードが正面の相手に当たる
  const st = mk(1); killAllBut(st, [0, 3])
  const [me, e] = [st.units[0], st.units[3]]
  put(me, 0, 2, { yaw: Math.PI }); put(e, 0, 0, { yaw: 0 }); e.ai.think = 99; e.ai.targetId = -1
  st.units[3].role = 'shooter'
  run(st, 20, { blade: true })
  ok(e.en < 100 && e.en > 70, 'ブレードが当たる', `en=${e.en.toFixed(1)}`)
  ok(e.leak > 0, '斬られると漏れる', `leak=${e.leak}`)
}
{ // シールドは無い: 正面から斬っても防がれずに当たる
  const st = mk(2); killAllBut(st, [0, 3])
  const [me, e] = [st.units[0], st.units[3]]
  e.role = 'shooter'
  put(me, 0, 2, { yaw: Math.PI }); put(e, 0, 0, { yaw: 0 })
  e.ai.think = 99; e.ai.targetId = 0
  run(st, 20, { blade: true, shield: true })
  ok(e.en < 100, '正面からの斬撃が防がれない（シールド無し）', `en=${e.en.toFixed(1)}`)
}
{ // ショットガンの散り方は撃つ向きに依らない（南向きと北向きで、撃った本人から見た並びが同じ）
  const shape = yaw => {
    const st = mk(9, { triggers: ['shotgun', 'pad'] }); killAllBut(st, [0, 3])
    const me = st.units[0], e = st.units[3]
    put(me, 0, 0, { yaw, shootCd: 0 }); put(e, Math.sin(yaw) * 15, Math.cos(yaw) * 15); e.ai.think = 99
    G.step(st, { shoot: true })
    if (st.bullets.length !== G.GUNS.shotgun.n) return 'no-bullets:' + st.bullets.length
    const fx = Math.sin(yaw), fz = Math.cos(yaw)
    return st.bullets.map(b => [+(b.vx * fz - b.vz * fx).toFixed(2), +(b.vx * fx + b.vz * fz).toFixed(1), +((b.x - me.x) * fz - (b.z - me.z) * fx).toFixed(2)]).map(String).sort().join('|')
  }
  const s0 = shape(0)
  ok(!s0.startsWith('no-bullets') && s0 === shape(Math.PI) && s0 === shape(Math.PI / 2), 'ショットガンの散り方が撃つ向きで変わらない（9発出ている）', s0.slice(0, 20))
}
// 狙撃: 自機をスナイパーにして、相手1体を置いて撃つ
const snipeSetup = (seed, ex, ez) => {
  const st = mk(seed, { loadout: 'sniper' }); killAllBut(st, [0, 3])
  const me = st.units[0], e = st.units[3]
  e.role = 'attacker'
  put(me, -27, 27, { yaw: Math.PI / 2, snipeCd: 0 }); put(e, ex, ez); e.ai.think = 99; e.ai.targetId = -1
  return { st, me, e }
}
const hold = (st, n, inp = {}) => { for (let i = 0; i < n; i++) G.step(st, { ...inp, snipe: true }) }
{ // 止まっている相手には当たり、ためるほど強い
  const a = snipeSetup(20, -2, 27)
  hold(a.st, 60); G.step(a.st, {})
  const full = 100 - a.e.en
  ok(a.me.role === 'sniper' && Math.abs(full - G.SNIPERS.snipe.dmax) < 1, '止まった相手に満タンの狙撃が当たる（最大威力）', `dmg=${full.toFixed(1)}`)
  const b = snipeSetup(21, -2, 27)
  hold(b.st, 20); G.step(b.st, {})
  const half = 100 - b.e.en
  ok(half > 5 && half < full, 'ためが短いと弱い', `短い=${half.toFixed(1)} 満タン=${full.toFixed(1)}`)
  const c = snipeSetup(22, -2, 27)
  hold(c.st, 5); G.step(c.st, {})
  ok(c.e.en === 100 && c.me.snipeT < 0 && c.me.snipeCd === 0, '押してすぐ離すと不発（待ち時間も付かない）', `en=${c.e.en}`)
}
{ // 真横に走り続ける相手には外れる（狙いが0.15秒遅れる）
  const a = snipeSetup(23, -2, 27)
  hold(a.st, 40)
  for (let i = 0; i < 20; i++) { a.e.vz = 0; a.e.vx = 0; a.e.z -= 8 * G.STEP; G.step(a.st, { snipe: i < 19 }) }
  const shotA = a.st.events.filter(e => e.type === 'snipe').length
  ok(a.e.en === 100 && shotA === 1, '横に走り続ける相手には外れる（撃ってはいる）', `en=${a.e.en.toFixed(1)} 撃った=${shotA}`)
}
{ // 建物の向こうの相手には当たらない
  const b = G.LEGACY_BLOCKS[0] // x-14 z6 w8 d6 h5
  const st = mk(24, { loadout: 'sniper' }); killAllBut(st, [0, 3])
  const me = st.units[0], e = st.units[3]
  e.role = 'attacker'
  put(me, b.x, b.z + b.d / 2 + 4, { snipeCd: 0 }); put(e, b.x, b.z - b.d / 2 - 4); e.ai.think = 99; e.ai.targetId = -1
  hold(st, 60); G.step(st, {})
  const shotB = st.events.filter(x => x.type === 'snipe').length
  ok(e.en === 100 && shotB === 1, '建物の向こうには当たらない（撃ってはいる）', `en=${e.en} 撃った=${shotB}`)
}
{ // 損傷の流出はダメージに比例した時間だけ続き、そのあと止まる
  const st = mk(30); killAllBut(st, [0, 3])
  const [me, e] = [st.units[0], st.units[3]]
  e.role = 'shooter'
  put(me, 0, 2, { yaw: Math.PI }); put(e, 0, 0, { yaw: 0 }); e.ai.think = 99; e.ai.targetId = -1
  run(st, 1, { blade: true }); run(st, 30)
  const dur = G.MELEE.blade.dmg * G.LEAK_SEC_PER_DMG
  put(me, 20, 20) // 離れて追撃しない
  const leakAt = sec => { while (st.t < sec) G.step(st, {}); return e.leak }
  const t0 = st.t
  const mid = leakAt(t0 + dur - 1)
  const after = leakAt(t0 + dur + 0.6)
  ok(mid > 0 && after === 0, 'ブレードの流出は約5秒で止まる', `${(dur - 1).toFixed(1)}秒後=${mid.toFixed(2)} ${(dur + 0.6).toFixed(1)}秒後=${after}`)
  const enStop = e.en
  run(st, 120)
  ok(e.en === enStop, '止まったあとはENが減らない', `${enStop.toFixed(2)} -> ${e.en.toFixed(2)}`)
}
{ // ダメージが大きい傷ほど長く漏れる（狙撃 > ブレード > スプリッター）
  const len = (amount) => {
    const st = mk(31); killAllBut(st, [0, 3])
    const u = st.units[3]; put(u, 0, 0); u.ai.think = 99; u.ai.targetId = -1
    u.wounds.push({ rate: 0.3, t: amount * G.LEAK_SEC_PER_DMG }); u.leak = 0.3
    let n = 0; while (st.units[3].leak > 0 && n < 6000) { G.step(st, {}); n++ }
    return n / 60
  }
  const a = len(30), b = len(14), c = len(1.3)
  ok(a > b && b > c && c < 0.6, 'ダメージが大きいほど流出が長い', `狙撃30=${a.toFixed(1)}秒 ブレード14=${b.toFixed(1)}秒 弾1.3=${c.toFixed(2)}秒`)
}
{ // ダッシュ: 押した向きへ一気に進み、3秒は再使用できない。入力が無ければ後ろへ下がる
  const st = mk(40); killAllBut(st, [0, 3])
  const me = st.units[0], e = st.units[3]
  put(e, 25, -25); e.ai.think = 99; e.ai.targetId = -1
  put(me, -20, 20, { yaw: 0 })
  run(st, 1, { dash: true, mx: 1 }); run(st, 14, { mx: 1 })
  const d1 = me.x + 20
  const st2 = mk(40); killAllBut(st2, [0, 3])
  put(st2.units[3], 25, -25); st2.units[3].ai.think = 99; st2.units[3].ai.targetId = -1
  put(st2.units[0], -20, 20, { yaw: 0 }); run(st2, 15, { mx: 1 })
  const d0 = st2.units[0].x + 20
  ok(d1 > d0 + 2.5, 'ダッシュは歩くより大きく進む', `ダッシュ=${d1.toFixed(1)}m 走り=${d0.toFixed(1)}m`)
  const cd = me.dashCd
  const x0 = me.x; run(st, 1, { dash: true, mx: 1 }); run(st, 14, { mx: 1 })
  ok(cd > 0 && cd <= G.DASH_CD && me.x - x0 < d0 + 0.5, '待ち時間中はもう一度ダッシュできない', `待ち=${cd.toFixed(2)} 次の15ステップ=${(me.x - x0).toFixed(1)}m`)
  run(st, Math.ceil(G.DASH_CD * 60) + 2, {}); const x1 = me.x; run(st, 1, { dash: true, mx: 1 }); run(st, 14, { mx: 1 })
  ok(me.x - x1 > d0 + 1, `${G.DASH_CD}秒たてばまたダッシュできる（止まった所から）`, `${(me.x - x1).toFixed(1)}m`)
  run(st, 200)
  put(me, -20, 20, { yaw: 0 }) // 向き +Z
  run(st, 1, { dash: true }); run(st, 14)
  ok(me.z < 20 - 2.5, '入力が無ければ後ろへ下がる', `z=${me.z.toFixed(1)}`)
}
{ // ステルスマント: 建物の陰でマントを着た敵は狙えない。見通せて近ければ狙える。着ている間ENが減る
  const b = G.LEGACY_BLOCKS[0] // x-14 z6 w8 d6
  const st = mk(50); killAllBut(st, [0, 3])
  const me = st.units[0], e = st.units[3]
  put(me, b.x, b.z + b.d / 2 + 4); put(e, b.x, b.z - b.d / 2 - 4); e.ai.think = 99; e.ai.targetId = -1
  e.bag = true
  run(st, 2, { lock: true })
  ok(me.targetId === -1 && !G.detectable(st, 0, e), '陰でマントを着た敵は狙えない', `target=${me.targetId}`)
  e.bag = false; run(st, 2, { lock: true })
  ok(me.targetId === 3, 'マントを脱げばレーダーで見つかる（陰でも狙える）', `target=${me.targetId}`)
  put(e, b.x - b.w / 2 - 6, b.z + b.d / 2 + 4); e.bag = true; run(st, 2, { lock: true })
  ok(me.targetId === 3, 'マントを着ていても、見通せて近ければ見つかる', `target=${me.targetId}`)
  const st2 = mk(51); killAllBut(st2, [0, 3])
  const m2 = st2.units[0]; put(st2.units[3], 25, -25); st2.units[3].ai.think = 99; st2.units[3].ai.targetId = -1
  put(m2, -20, 20); const en0 = m2.en
  run(st2, 1, { bag: true }); run(st2, 299)
  ok(m2.bag && en0 - m2.en > 0.8 && en0 - m2.en < 1.2, 'マントは5秒で約1のENを使う', `減り=${(en0 - m2.en).toFixed(2)}`)
  run(st2, 1, { bag: true })
  ok(!m2.bag, 'もう一度押すと脱ぐ')
}
{ // ギアの組み方: 4つまで・攻撃用が1つ以上。持っていないギアは押しても出ない
  ok(G.validTriggers(['blade', 'shoot', 'snipe', 'pad', 'bag']).length === 4, '5つ渡しても4つまで')
  ok(G.validTriggers(['pad', 'bag']) === null, '攻撃用が無い組み方は通らない')
  ok(G.validTriggers(['blade', 'blade', 'x']).join() === 'blade', '重複と知らない名前は落とす')
  const st = mk(60, { triggers: ['snipe', 'pad'] }); killAllBut(st, [0, 3])
  const me = st.units[0], e = st.units[3]
  ok(me.role === 'sniper' && me.trig.join() === 'snipe,pad', '組んだギアで出撃し、役割が決まる', `${me.role} ${me.trig}`)
  put(me, 0, 2, { yaw: Math.PI, shootCd: 0 }); put(e, 0, 0); e.ai.think = 99; e.ai.targetId = -1
  run(st, 1, { blade: true, shoot: true, bag: true })
  ok(me.bladeT < 0 && st.bullets.length === 0 && !me.bag, '持っていないブレード・スプリッター・マントは出ない')
  const st2 = mk(61, { triggers: ['blade', 'snipe'] })
  ok(st2.units[0].role === 'sniper' && st2.units[0].trig.includes('blade'), 'ブレードと狙撃を両方持てる')
}
{ // 本番の街: 建物が重ならず、範囲からはみ出さず、点対称。出撃位置は建物の外で、敵から45m以上
  const B = G.BLOCKS.filter(b => !b.kind) // 屋上の手すり壁・塔屋は本体に乗るので数えない
  let over = 0
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) if (Math.abs(B[i].x - B[j].x) < (B[i].w + B[j].w) / 2 + 0.9 && Math.abs(B[i].z - B[j].z) < (B[i].d + B[j].d) / 2 + 0.9) over++
  const sym = B.every(b => B.some(c => Math.abs(c.x + b.x) < 1e-6 && Math.abs(c.z + b.z) < 1e-6 && c.h === b.h))
  ok(over === 0 && sym && B.every(b => Math.abs(b.x) + b.w / 2 < G.MAP_HALF && Math.abs(b.z) + b.d / 2 < G.MAP_HALF), '本番の街は重ならず点対称', `棟=${B.length} 重なり=${over}`)
  let minD = 1e9, inside = 0
  for (let k = 0; k < 30; k++) {
    const st = G.createState(500 + k)
    for (const a of st.units) {
      if (B.some(b => Math.abs(a.x - b.x) < b.w / 2 + 0.5 && Math.abs(a.z - b.z) < b.d / 2 + 0.5)) inside++
      for (const e of st.units) if (e.team !== a.team) minD = Math.min(minD, Math.hypot(a.x - e.x, a.z - e.z))
    }
  }
  ok(inside === 0 && minD >= G.SPAWN_GAP, `出撃位置は建物の外で、敵から${G.SPAWN_GAP}m以上`, `最短=${minD.toFixed(1)}m 建物内=${inside}`)
}
{ // 開始時点では、どちらの隊も相手を1人も捉えていない（レーダーにも目にも入らない）。狙いも付かない
  let seen = 0, locked = 0
  for (let k = 0; k < 60; k++) {
    const st = G.createState(800 + k)
    for (const u of st.units) for (const e of st.units) if (e.team !== u.team && G.detectable(st, u.team, e)) seen++
    G.step(st, { lock: true })
    if (st.units[0].targetId !== -1) locked++
  }
  ok(seen === 0 && locked === 0, '開始時点では互いの位置が分からない', `捉えた=${seen} 狙いが付いた=${locked}`)
}
{ // 索敵: レーダーの範囲内なら壁の向こうでも分かる。それより遠いと、見通しが通る目視の範囲内だけ見つかる
  const R = G.RADAR_RANGE, S = G.SIGHT
  const st = G.createState(70, { blocks: [{ x: 0, z: 0, w: 4, d: 40, h: 12.6 }], spawn: 'fixed' })
  st.units.forEach(u => { if (u.id !== 0 && u.id !== 3) u.alive = false })
  const me = st.units[0], e = st.units[3]
  const at = (ex, ez) => { put(me, -30, 0); put(e, ex, ez); return G.detectable(st, 0, e) }
  ok(at(-30 + R - 5, 0) === true, `レーダーの範囲（${R}m）内は壁の向こうでも分かる`)
  ok(at(-30 + R + 5, 0) === false, 'レーダーより遠く、壁の向こうなら分からない')
  ok(at(-30, S - 5) === true, `レーダーより遠くても、見通しが通る${S}m以内なら見える`)
  ok(at(-30, -(S + 5)) === false, `見通しがあっても${S}mより遠いと見えない`)
}
{ // 弾は建物で止まる
  const st = mk(4); killAllBut(st, [0, 3])
  const b = G.LEGACY_BLOCKS[1] // x0 z8.5 w6 d3 h2.6
  const [me, e] = [st.units[0], st.units[3]]
  e.role = 'attacker'; e.ai.think = 99
  put(me, 0, 14, { yaw: Math.PI }); put(e, 0, 3)
  ok(!G.lineOfSight(st, me, e), '建物越しは見通せない')
  st.bullets.push({ x: 0, y: 1.2, z: 13, vx: 0, vy: 0, vz: -32, life: 1.3, team: 0, owner: 0 })
  for (let i = 0; i < 40; i++) { G.step(st, {}); e.x = 0; e.z = 3 }
  ok(e.en === 100, '弾が建物を抜けない', `en=${e.en}`)
}
{ // ショットガンは9発出てENを消費する
  const st = mk(5, { triggers: ['shotgun', 'pad'] }); killAllBut(st, [0, 3])
  const [me, e] = [st.units[0], st.units[3]]
  put(me, 0, 20, { yaw: Math.PI, shootCd: 0 }); put(e, 0, 5); e.ai.think = 99
  G.step(st, { shoot: true })
  ok(st.bullets.filter(b => b.team === 0).length === G.GUNS.shotgun.n, 'ショットガンは1回で9発', st.bullets.length)
  ok(me.en < 100, '撃つとENが減る', me.en)
}
{ // エアステップで屋上に乗れて、縁から歩けば落ちる
  const st = mk(6); killAllBut(st, [0])
  st.units[3].alive = true; put(st.units[3], 25, -25); st.units[3].ai.think = 99; st.units[3].role = 'shooter'
  const me = st.units[0]
  const b = G.LEGACY_BLOCKS[1]
  put(me, b.x, b.z + b.d / 2 + 1.2, { yaw: Math.PI })
  let maxY = 0
  for (let i = 0; i < 160; i++) { G.step(st, { mz: i < 25 ? -0.5 : 0, pad: i === 0 }); maxY = Math.max(maxY, me.y) } // 高く跳ぶので滞空が長い
  ok(maxY > b.h + 1, 'エアステップで建物より高く跳ぶ', `maxY=${maxY.toFixed(2)}`)
  ok(Math.abs(me.y - b.h) < 0.01 && me.grounded, '屋上に着地する', `y=${me.y.toFixed(2)} grounded=${me.grounded}`)
  for (let i = 0; i < 80; i++) G.step(st, { mx: 1 })
  ok(me.y === 0 && me.grounded, '屋上の縁から歩くと地面に落ちる', `y=${me.y}`)
}
{ // エアステップは着地までに2回まで（地上1回＋空中1回）。3回目は出ない。着地で回数が戻る
  const st = mk(7); killAllBut(st, [0])
  st.units[3].alive = true; put(st.units[3], 25, -25); st.units[3].ai.think = 99; st.units[3].role = 'shooter'
  const me = st.units[0]
  put(me, -27, 27, { yaw: Math.PI / 2 })
  let n = 0
  for (let i = 0; i < 3; i++) { const b = st.pads.length; run(st, 1, { pad: true, mx: 1 }); if (st.pads.length > b) n++; run(st, 15, { mx: 1 }) }
  ok(n === 2, 'エアステップは着地までに2回まで', `出た回数=${n}`)
  run(st, 240, {})
  ok(me.grounded && me.padAir === 0, '着地で回数が戻る', `padAir=${me.padAir}`)
  const b = st.pads.length; run(st, 1, { pad: true }); 
  ok(st.pads.length === b + 1, '着地後はまた出せる')
}
{ // 屋根から歩いて落ちた空中では2回とも空中で出せる
  const st = mk(8); killAllBut(st, [0])
  st.units[3].alive = true; put(st.units[3], 25, -25); st.units[3].ai.think = 99; st.units[3].role = 'shooter'
  const me = st.units[0]
  put(me, -27, 27); me.y = 6; me.grounded = false
  let n = 0
  for (let i = 0; i < 3; i++) { const b = st.pads.length; run(st, 1, { pad: true, mx: 1 }); if (st.pads.length > b) n++; run(st, 15, { mx: 1 }) }
  ok(n === 2, '空中からでも2回まで', `出た回数=${n}`)
}
{ // 建物に向かって走り続けてもめり込まない
  const st = mk(7); killAllBut(st, [0])
  st.units[3].alive = true; put(st.units[3], 25, -25); st.units[3].ai.think = 99; st.units[3].role = 'shooter'
  const me = st.units[0]
  const b = G.LEGACY_BLOCKS[0]
  put(me, b.x, b.z + b.d / 2 + 3)
  for (let i = 0; i < 120; i++) G.step(st, { mz: -1, mx: 0.3 })
  const inside = Math.abs(me.x - b.x) < b.w / 2 && Math.abs(me.z - b.z) < b.d / 2
  ok(!inside && me.z >= b.z + b.d / 2 + G.UNIT_R - 0.01 - 0.0001 || Math.abs(me.x - b.x) > b.w / 2, '壁にめり込まない', `x=${me.x.toFixed(2)} z=${me.z.toFixed(2)}`)
}
{ // ENが尽きると強制帰還、撃破点が入る。8秒後に敵から離れた所へ再出撃し、直後は攻撃を受けない
  const st = mk(8); killAllBut(st, [0, 3])
  const [me, e] = [st.units[0], st.units[3]]
  put(me, 0, 2, { yaw: Math.PI }); put(e, 0, 0); e.en = 5; e.role = 'shooter'; e.ai.think = 99
  run(st, 20, { blade: true })
  ok(!e.alive, 'ENが尽きると強制帰還')
  ok(st.score[0] === G.SCORE.kill && st.score[1] === 0, '撃破で1点', st.score.join(':'))
  ok(st.phase === 'play', '脱出しても試合は続く', st.phase)
  run(st, Math.round(G.RESPAWN_T * 60) - 10)
  ok(e.alive && e.en === G.MAX_EN, `${G.RESPAWN_T}秒で再出撃（ENは満タン）`, `alive=${e.alive} en=${e.en}`)
  const d = Math.hypot(e.x - me.x, e.z - me.z)
  ok(d >= G.RADAR_RANGE, '再出撃は敵のレーダーの外', d.toFixed(1))
  ok(e.shieldT > 0, '再出撃直後は守られている', e.shieldT.toFixed(2))
  const en0 = e.en
  put(me, e.x, e.z + 2, { yaw: Math.PI }); put(e, e.x, e.z); e.ai.think = 99
  run(st, 20, { blade: true })
  ok(e.en === en0, '守られている間はダメージを受けない', e.en)
}
{ // 時間切れで同点なら延長戦。撃破で決まる。誰も撃破しなければ最長60秒で引き分け
  const st = mk(9, { time: 1 })
  for (const u of st.units) { put(u, u.team ? 25 : -25, u.id * 3 - 8); u.ai.think = 1e9 }
  run(st, 70)
  ok(st.phase === 'play' && st.overtime, '同点で時間切れなら延長戦', `phase=${st.phase} ot=${st.overtime}`)
  st.score[1] = 1
  run(st, 2)
  ok(st.phase === 'over' && st.endReason === 'overtime' && st.winner === 1, '延長戦は撃破した側の勝ち', `${st.endReason} ${st.winner}`)
  const s2 = mk(9, { time: 1 })
  for (const u of s2.units) { put(u, u.team ? 25 : -25, u.id * 3 - 8); u.ai.think = 1e9 }
  run(s2, 70 + G.OVERTIME_MAX * 60 + 5)
  ok(s2.phase === 'over' && s2.winner === -1, '延長戦でも撃破がなければ引き分け', `${s2.phase} ${s2.winner}`)
}
{ // 時間切れで撃破数が多い方の勝ち
  const st = mk(9, { time: 1 })
  for (const u of st.units) { put(u, u.team ? 25 : -25, u.id * 3 - 8); u.ai.think = 1e9 }
  st.score[0] = 2
  run(st, 70)
  ok(st.phase === 'over' && st.endReason === 'time' && st.winner === 0, '時間切れで多く撃破した側の勝ち', `${st.endReason} ${st.winner}`)
}
{ // 漏れだけで尽きても、最後に当てた相手の撃破になる
  const st = mk(10); killAllBut(st, [0, 3, 4])
  const e = st.units[3]
  put(e, 20, -20); e.ai.think = 99; e.role = 'shooter'
  put(st.units[4], -20, -20); st.units[4].ai.think = 99
  e.en = 0.05; e.wounds.push({ rate: 1, t: 5 }); e.lastHitBy = 0
  run(st, 10)
  ok(!e.alive && st.units[0].kills === 1, '漏れで尽きても撃破は当てた側', `kills=${st.units[0].kills}`)
}
{ // ロックオン切替は今の相手以外を選ぶ（敵3人をレーダーの範囲内に置く）
  const st = mk(11)
  const me = st.units[0]
  put(me, 0, 10); put(st.units[3], -8, -6); put(st.units[4], 8, -8); put(st.units[5], 0, -12)
  for (const id of [3, 4, 5]) { st.units[id].ai.think = 99; st.units[id].ai.targetId = -1 }
  run(st, 1)
  const first = me.targetId
  G.step(st, { lock: true })
  ok(me.targetId !== first && me.targetId >= 3, 'ロックオン切替', `${first} -> ${me.targetId}`)
}
{ // 乱入テスト: ランダム入力で200試合分回して壊れない
  let bad = 0, stuck = 0
  for (let k = 0; k < 40; k++) {
    const st = mk(100 + k)
    let n = 0
    while (st.phase === 'play' && n < 60 * 120) {
      const r = Math.random
      G.step(st, { mx: r() * 2 - 1, mz: r() * 2 - 1, blade: r() < 0.05, shoot: r() < 0.05, pad: r() < 0.02, jump: r() < 0.03, lock: r() < 0.01 })
      G.drainEvents(st)
      n++
      for (const u of st.units) {
        if (![u.x, u.y, u.z, u.en, u.vx, u.vz].every(Number.isFinite)) bad++
        if (u.alive) for (const b of st.blocks) if (!b.y0 && u.y < b.h - 0.4 && Math.abs(u.x - b.x) < b.w / 2 - 0.05 && Math.abs(u.z - b.z) < b.d / 2 - 0.05) stuck++
        if (Math.abs(u.x) > G.MAP_HALF || Math.abs(u.z) > G.MAP_HALF) bad++
      }
    }
  }
  ok(bad === 0, 'ランダム入力でNaN・場外なし', bad)
  ok(stuck === 0, 'ランダム入力で建物にめり込まない', stuck)
}

// ---------------------------------------------------------------- 追加したギア
const duel = (seed, trig, ex = 0, ez = 0) => {
  const st = mk(seed, { triggers: trig }); killAllBut(st, [0, 3])
  const [me, e] = [st.units[0], st.units[3]]
  e.role = 'shooter'; e.trig = ['pad']; e.gun = e.melee = e.sniper = null
  put(e, ex, ez, { yaw: 0 }); e.ai.think = 1e9; e.ai.targetId = -1
  return [st, me, e]
}
{ // 近接・射撃・狙撃は1つずつまで
  ok(G.validTriggers(['blade', 'scorpion', 'rifle', 'pad']).join() === 'blade,rifle,pad', '近接を2つ選ぶと後の方は落ちる')
  ok(G.validTriggers(['snipe', 'ibis', 'handgun', 'launcher', 'teleport']).join() === 'snipe,handgun,teleport', '狙撃・銃も1つずつ')
  ok(G.validTriggers(['blade', 'shoot']).join() === 'blade,handgun', '前の名前で保存された組み方も読める（shoot → ハンドガン）')
  ok(G.validTriggers(['chameleon', 'teleport']) === null, '補助だけでは出撃できない')
}
{ // スティンガー: ブロードセイバーより軽く、速く振り直せる
  const hits = {}
  for (const t of ['blade', 'scorpion']) {
    const [st, me, e] = duel(50, [t, 'pad'])
    put(me, 0, 2, { yaw: Math.PI })
    for (let i = 0; i < 120; i++) { G.step(st, { blade: true }); put(e, 0, 0); put(me, 0, 2, { yaw: Math.PI }) }
    hits[t] = 100 - e.en
  }
  ok(hits.scorpion > 0 && hits.blade > 0, 'ブロードセイバーもスティンガーも当たる', `2秒で ブロードセイバー=${hits.blade.toFixed(0)} スティンガー=${hits.scorpion.toFixed(0)}`)
  ok(G.MELEE.scorpion.dmg < G.MELEE.blade.dmg, 'スティンガーは1振りがブロードセイバーより軽い', `${G.MELEE.scorpion.dmg} < ${G.MELEE.blade.dmg}`)
  ok(G.MELEE.scorpion.time + G.MELEE.scorpion.cd < G.MELEE.blade.time + G.MELEE.blade.cd, 'スティンガーは振り直しが速い')
}
{ // ラピッドショットは速くためられて軽い、ヘビーショットは遅くて重い
  const S = G.SNIPERS
  ok(S.lightning.charge < S.snipe.charge && S.snipe.charge < S.ibis.charge, 'ためる時間: ラピッドショット < ロングショット < ヘビーショット')
  ok(S.lightning.dmax < S.snipe.dmax && S.snipe.dmax < S.ibis.dmax, '威力: ラピッドショット < ロングショット < ヘビーショット')
  const dealt = {}
  for (const t of ['lightning', 'ibis']) {
    const [st, me, e] = duel(53, [t, 'pad'], 34, -25)
    put(me, 34, 0, { yaw: Math.PI }); me.snipeCd = 0
    const n = Math.ceil(S[t].charge * 60) + 2
    for (let i = 0; i < n; i++) { G.step(st, { snipe: true }); put(e, 34, -25) }
    G.step(st, { snipe: false })
    dealt[t] = 100 - e.en
  }
  ok(Math.abs(dealt.lightning - G.SNIPERS.lightning.dmax) < 0.5 && Math.abs(dealt.ibis - G.SNIPERS.ibis.dmax) < 0.5, 'ためきって撃つとそれぞれの最大威力', `ラピッドショット=${dealt.lightning.toFixed(1)} ヘビーショット=${dealt.ibis.toFixed(1)}`)
}
{ // ミラージュ: 30m 先からはレーダーにも目にも映らない。近づくと見つかる。攻撃すると解ける
  const st = mk(54, { triggers: ['scorpion', 'chameleon'] }); killAllBut(st, [0, 3])
  const [me, e] = [st.units[0], st.units[3]]
  e.ai.think = 1e9; e.ai.targetId = -1
  put(me, 0, 30); put(e, 0, 0)
  G.step(st, { cham: true })
  ok(me.cham && !G.detectable(st, 1, me), 'ミラージュ中は30m先から見つからない')
  put(me, 0, 1.5); G.step(st, {})
  ok(!G.detectable(st, 1, me), 'すぐ隣にいても目には映らない（狙いも付かない）')
  ok(G.radarBlip(st, 1, me), 'レーダーの点には映る（マントを着ていなければ）')
  G.step(st, { blade: true })
  ok(!me.cham, '攻撃するとミラージュが解ける')
}
{ // ブリンク: 向いている方へ15m。建物の手前で止まる
  const st = mk(55, { triggers: ['blade', 'teleport'] }); killAllBut(st, [0])
  const me = st.units[0]
  put(me, 0, 60, { yaw: 0 })
  G.step(st, { tele: true, mx: 1, mz: 0 })
  ok(Math.abs(me.x - G.TELEPORT_DIST) < 0.6 && me.teleCd > 0, `何もなければ${G.TELEPORT_DIST}m跳ぶ`, me.x.toFixed(2))
  G.step(st, { tele: true, mx: 1, mz: 0 }); const x1 = me.x
  ok(Math.abs(x1 - G.TELEPORT_DIST) < 1, '待ち時間の間は跳べない', x1.toFixed(2))
  const b = G.LEGACY_BLOCKS[2]
  put(me, b.x - b.w / 2 - 6, b.z, { yaw: Math.PI / 2 }); me.teleCd = 0
  G.step(st, { tele: true, mx: 1, mz: 0 })
  ok(me.x < b.x - b.w / 2 && me.x > b.x - b.w / 2 - 3, '建物の手前で止まる（中に入らない）', `x=${me.x.toFixed(2)} 壁=${(b.x - b.w / 2).toFixed(2)}`)
}

// ---------------------------------------------------------------- 銃と弾
const gunDuel = (seed, gun, ammo, ex, ez) => {
  const st = mk(seed, { triggers: [gun, 'pad'], ammo }); killAllBut(st, [0, 3])
  const me = st.units[0], e = st.units[3]
  e.role = 'shooter'; e.trig = ['pad']; e.gun = e.melee = e.sniper = null
  put(e, ex, ez); e.ai.think = 1e9; e.ai.targetId = -1
  put(me, 34, 0, { yaw: Math.PI, shootCd: 0 })
  return [st, me, e]
}
{ // 押している間は銃ごとの速さで撃ち続ける（ハンドガンは毎秒5発、アサルトライフルはもっと速い）
  const count = gun => { const [st] = gunDuel(70, gun, 'normal', 34, -60); for (let i = 0; i < 60; i++) G.step(st, { shoot: true }); return st.events.filter(x => x.type === 'shoot' && x.id === 0).length }
  const h = count('handgun'), r = count('rifle')
  ok(h >= 4 && h <= 6, 'ハンドガンは押している間 毎秒約5発', h)
  ok(r > h * 1.8, 'アサルトライフルはハンドガンの2倍近く速い', `${r}発/秒`)
}
{ // 通常弾は照準の向きにまっすぐ出る（散りは小さい）
  const st = mk(71, { triggers: ['handgun', 'pad'] }); killAllBut(st, [0])
  const me = st.units[0]; put(me, 34, 0, { yaw: 0, shootCd: 0 })
  G.step(st, { shoot: true, lockOff: true, aimYaw: 0.7, aimPitch: 0 })
  const b = st.bullets[0], v = Math.hypot(b.vx, b.vy, b.vz)
  const dev = Math.acos((Math.sin(0.7) * b.vx + Math.cos(0.7) * b.vz) / v) * 180 / Math.PI
  ok(dev < 2, '通常弾は照準の向きから2度以内に出る', `${dev.toFixed(2)}度`)
}
{ // 追尾弾は横へ走る相手に当たる。通常弾は同じ条件で外れる
  const res = {}
  for (const am of ['homing', 'normal']) {
    const [st, me, e] = gunDuel(72, 'handgun', am, 34, -24)
    me.targetId = 3
    for (let i = 0; i < 150; i++) { e.vx = 7; e.x += 7 / 60; G.step(st, { shoot: i < 30 && i % 12 === 0 }); e.x -= e.vx / 60 }
    res[am] = 100 - e.en
  }
  ok(res.homing > 0 && res.homing > res.normal, '追尾弾は動く相手に曲がって当たる', `追尾=${res.homing.toFixed(1)} 通常=${res.normal.toFixed(1)}`)
}
{ // 曲射弾は横へふくらんでから、撃った時の狙いの点に戻ってくる（正面の遮蔽物を回り込む）
  const st = mk(73, { triggers: ['handgun', 'pad'], ammo: 'curve' }); killAllBut(st, [0])
  const me = st.units[0]; put(me, 34, 0, { yaw: Math.PI, shootCd: 0 })
  G.step(st, { shoot: true, lockOff: true, aimYaw: Math.PI, aimPitch: 0, aimPoint: { x: 34, y: 1.45, z: -25 } })
  const b = st.bullets[0]
  let maxOff = 0, near = 99
  for (let i = 0; i < 90 && st.bullets.includes(b); i++) { G.step(st, {}); maxOff = Math.max(maxOff, Math.abs(b.x - 34)); near = Math.min(near, Math.hypot(b.x - 34, b.z + 25)) }
  ok(maxOff > 2.5, '曲射弾は横へ2.5m以上ふくらむ', maxOff.toFixed(1))
  ok(near < 2, '曲射弾は狙いの点の近くへ戻る', near.toFixed(2))
}
{ // 炸裂弾は当たった所で弾け、壁に隠れていない近くの相手にも届く。建物も通常弾より大きく削る
  const [st, me, e] = gunDuel(74, 'handgun', 'blast', 34, -12)
  const e2 = st.units[4]; e2.alive = true; e2.outT = -1; e2.role = 'shooter'; e2.trig = ['pad']; e2.gun = e2.melee = e2.sniper = null; put(e2, 35.3, -12); e2.ai.think = 1e9; e2.ai.targetId = -1
  me.targetId = 3
  G.step(st, { shoot: true }); for (let i = 0; i < 40; i++) G.step(st, {})
  ok(e.en < 100 && e2.en < 100, '炸裂弾は直撃の隣の相手にも当たる', `${e.en.toFixed(1)} ${e2.en.toFixed(1)}`)
  const bl = {}
  for (const am of ['blast', 'normal']) {
    const s2 = G.createState(75, { spawn: 'fixed', triggers: ['handgun', 'pad'], ammo: am }); s2.units.forEach(u => { if (u.id) { u.alive = false; u.outT = -1 } })
    const free = (x, z) => !s2.blocks.some(k => Math.abs(x - k.x) < k.w / 2 + 0.5 && Math.abs(z - k.z) < k.d / 2 + 0.5)
    const b = s2.blocks.find(b => !b.kind && Number.isFinite(b.hp) && b.h > 8 && [3, 8].every(t => free(b.x, b.z + b.d / 2 + t)))
    const m = s2.units[0]; put(m, b.x, b.z + b.d / 2 + 8, { yaw: Math.PI, shootCd: 0 })
    for (let i = 0; i < 30; i++) G.step(s2, { shoot: true, lockOff: true, aimYaw: Math.PI, aimPitch: 0.1 })
    for (let i = 0; i < 30; i++) G.step(s2, {})
    bl[am] = b.maxHp - b.hp
  }
  ok(bl.blast > bl.normal * 1.5, '炸裂弾は建物を通常弾より大きく削る', `炸裂=${bl.blast.toFixed(0)} 通常=${bl.normal.toFixed(0)}`)
}
{ // グレネードランチャー: 弧を描いて、20m 先の地面の相手の近くで爆発する
  const [st, me, e] = gunDuel(76, 'launcher', 'normal', 34, -20)
  me.targetId = 3
  G.step(st, { shoot: true }); for (let i = 0; i < 120; i++) G.step(st, {})
  const ex = st.events.find(x => x.type === 'explode')
  ok(ex && Math.hypot(ex.x - 34, ex.z + 20) < 3 && e.en < 100, 'グレネードは狙った相手の近くで爆発する', ex ? `${Math.hypot(ex.x - 34, ex.z + 20).toFixed(1)}m en=${e.en.toFixed(1)}` : '爆発なし')
}
{ // ショットガンは近いほど強い（5m と 12m で当たる量が違う）
  const hit = d => { const [st, me, e] = gunDuel(77, 'shotgun', 'normal', 34, -d); me.targetId = 3; G.step(st, { shoot: true }); for (let i = 0; i < 40; i++) G.step(st, {}); return 100 - e.en }
  const a = hit(5), b = hit(12)
  ok(a > b && a > 10, 'ショットガンは近いほど多く当たる', `5m=${a.toFixed(1)} 12m=${b.toFixed(1)}`)
}
// ---------------------------------------------------------------- ダッシュ・エアステップ・ベランダ
{ // ダッシュは EN を使わない
  const st = mk(60); killAllBut(st, [0])
  const me = st.units[0]; put(me, 34, 0)
  const en0 = me.en
  G.step(st, { dash: true, mx: 1 })
  ok(me.dashT >= 0 && me.en === en0, 'ダッシュしても EN は減らない', `${en0} -> ${me.en}`)
}
{ // エアステップ: 1回で16m以上、2回（頂点で2回目）で24m以上
  const st = mk(61, { triggers: ['blade', 'pad'] }); killAllBut(st, [0])
  const me = st.units[0]; put(me, 34, 0)
  let top1 = 0, top2 = 0, used2 = false
  G.step(st, { pad: true })
  for (let i = 0; i < 400; i++) {
    if (!used2 && me.vy <= 0 && i > 5) { G.step(st, { pad: true }); used2 = true; top1 = me.y; continue }
    G.step(st, {}); if (used2) top2 = Math.max(top2, me.y)
  }
  ok(top1 >= 16, 'エアステップ1回で16m以上', top1.toFixed(1))
  ok(top2 >= 24, 'エアステップ2回で24m以上', top2.toFixed(1))
}
{ // ベランダ: 高い建物にはどれも付いていて、足場の間隔はエアステップで届く。一番上の足場から屋上にも届く
  const reach = 24
  const tall = G.BLOCKS.filter(b => !b.kind && b.h > reach)
  let bad = []
  for (const t of tall) {
    const ls = G.BLOCKS.filter(l => l.kind === 'ledge' && Math.abs(l.x - t.x) <= t.w / 2 + l.w && Math.abs(l.z - t.z) <= t.d / 2 + l.d).map(l => l.h).sort((a, b) => a - b)
    const steps = [0, ...ls, t.h]
    for (let i = 1; i < steps.length; i++) if (steps[i] - steps[i - 1] > reach) bad.push([t.x, t.z, t.h, ls.join('/')])
  }
  ok(tall.length > 0 && bad.length === 0, `エアステップで届かない高い建物（${tall.length}棟）は全部ベランダで登れる`, bad.length ? JSON.stringify(bad.slice(0, 3)) : '')
  const ledges = G.BLOCKS.filter(l => l.kind === 'ledge')
  const hit = ledges.filter(l => G.BLOCKS.some(o => !o.kind && Math.abs(l.x - o.x) < (l.w + o.w) / 2 - 0.01 && Math.abs(l.z - o.z) < (l.d + o.d) / 2 - 0.01))
  ok(hit.length === 0, 'ベランダは建物に食い込まない', hit.length)
}
{ // ベランダの上に立てる。下は頭がぶつからずに歩いてくぐれる
  const l = G.BLOCKS.find(b => b.kind === 'ledge')
  const st = G.createState(62, { spawn: 'fixed' }); st.units.forEach(u => { if (u.id) { u.alive = false; u.outT = -1 } })
  const me = st.units[0]
  put(me, l.x, l.z); me.y = l.h + 2; me.grounded = false
  for (let i = 0; i < 90; i++) G.step(st, {})
  ok(me.grounded && Math.abs(me.y - l.h) < 0.05, 'ベランダの上に立てる', `y=${me.y.toFixed(2)} 足場=${l.h}`)
  put(me, l.x, l.z)
  const x0 = me.x, z0 = me.z
  for (let i = 0; i < 10; i++) G.step(st, {})
  ok(Math.hypot(me.x - x0, me.z - z0) < 0.05 && me.y === 0, '足場の下（地面）にいても押し出されない', `${me.x.toFixed(2)},${me.z.toFixed(2)}`)
}
{ // 実際に登れる: 一番高い建物の前から、エアステップで足場を順に跳び移って屋上まで
  const tall = G.BLOCKS.filter(b => !b.kind).sort((a, b) => b.h - a.h)[0]
  const ls = G.BLOCKS.filter(l => l.kind === 'ledge' && Math.abs(l.x - tall.x) <= tall.w / 2 + l.w && Math.abs(l.z - tall.z) <= tall.d / 2 + l.d).sort((a, b) => a.h - b.h)
  const st = G.createState(63, { spawn: 'fixed', triggers: ['blade', 'pad'] }); st.units.forEach(u => { if (u.id) { u.alive = false; u.outT = -1 } })
  const me = st.units[0], l0 = ls[0]
  const ox = Math.abs(l0.x - tall.x) > tall.w / 2 ? Math.sign(l0.x - tall.x) : 0, oz = ox ? 0 : Math.sign(l0.z - tall.z)
  put(me, l0.x + ox * (l0.w / 2 + 3), l0.z + oz * (l0.d / 2 + 3))
  const landed = []
  for (const t of [...ls, tall]) {
    G.step(st, { pad: true, mx: -ox, mz: -oz })
    let second = false
    for (let i = 0; i < 300; i++) {
      const dx = t.x - me.x, dz = t.z - me.z, d = Math.hypot(dx, dz) || 1
      const inp = { mx: dx / d, mz: dz / d }
      if (!second && me.vy < 1 && i > 3) { inp.pad = true; second = true }
      G.step(st, inp)
      if (me.grounded && i > 10) break
    }
    landed.push(+me.y.toFixed(1))
    if (Math.abs(me.y - t.h) > 0.1) break
  }
  ok(Math.abs(me.y - tall.h) < 0.1, `${tall.h}mの屋上まで足場を伝って登れる`, landed.join(' → '))
}
{ // 撃ち続けると建物が崩れてがれきになる。屋上にいた者は落ちる。屋上の物も一緒に消える
  const st = G.createState(67, { spawn: 'fixed', triggers: ['launcher', 'pad'] }); st.units.forEach(u => { if (u.id && u.id !== 4) { u.alive = false; u.outT = -1 } })
  const free = (x, z) => !st.blocks.some(k => Math.abs(x - k.x) < k.w / 2 + 0.5 && Math.abs(z - k.z) < k.d / 2 + 0.5)
  const b = st.blocks.find(b => b.nest && [3, 8, 14].every(t => free(b.x, b.z + b.d / 2 + t)))
  const kids = st.blocks.filter(k => k.parent === b.id).length
  const me = st.units[0], top = st.units[4]
  top.ai.think = 1e9; top.ai.targetId = -1
  put(top, b.x, b.z); top.y = b.h; top.grounded = true; top.shieldT = 99
  put(me, b.x, b.z + b.d / 2 + 14, { yaw: Math.PI })
  const hp0 = b.hp
  let n = 0
  while (st.blocks.includes(b) && n++ < 200) { me.shootCd = 0; me.en = 100; G.step(st, { shoot: true, lockOff: true, aimYaw: Math.PI, aimPitch: 0.05 }); for (let i = 0; i < 40; i++) G.step(st, {}) }
  ok(Number.isFinite(hp0) && !st.blocks.includes(b), `撃ち続けると建物が崩れる（耐久${hp0}・${n}発）`)
  ok(st.blocks.some(k => k.kind === 'rubble' && k.x === b.x && k.z === b.z && k.h < 2), '跡にはがれき（低い山）が残る')
  ok(!st.blocks.some(k => k.parent === b.id) && kids > 0, '屋上の手すり壁・塔屋も一緒に消える', `消えた=${kids}`)
  for (let i = 0; i < 120; i++) G.step(st, {})
  ok(top.y < 2, '屋上にいた者は落ちる', `y=${top.y.toFixed(2)}`)
  ok(st.events.some(e => e.type === 'collapse' && e.id === b.id), '崩れたことが画面側に伝わる')
}
{ // 高層ビル（ベランダで登る建物）は壊れない
  const st = G.createState(68, { spawn: 'fixed' })
  const t = st.blocks.find(b => !b.kind && b.h > 26)
  ok(t && t.hp === Infinity, '高層ビルは壊れない（足場が消えない）', t && t.h)
  const small = st.blocks.find(b => !b.kind && b.h <= 26)
  ok(Number.isFinite(small.hp) && small.hp > 0, 'それより低い建物には耐久がある', small.hp)
}
// ---------------------------------------------------------------- ステータス・照準・EN
{ // ステータス: 合計12点まで。EN量・足の速さ・ジャンプ・攻撃が効く
  ok(JSON.stringify(G.validStats({ spd: 5, en: 5, atk: 5, jmp: 5 })) === JSON.stringify({ spd: 3, en: 3, atk: 3, jmp: 3 }), '合計12点を超える振り方は標準に戻す')
  const a = G.createState(80, { spawn: 'fixed', stats: { spd: 5, en: 1, atk: 1, jmp: 5 } }).units[0]
  const b = G.createState(80, { spawn: 'fixed', stats: { spd: 1, en: 5, atk: 5, jmp: 1 } }).units[0]
  ok(a.maxEn === 80 && b.maxEn === 120 && b.en === 120, 'EN量は 80〜120', `${a.maxEn} ${b.maxEn}`)
  const runFar = stats => { const st = G.createState(81, { spawn: 'fixed', stats }); st.units.forEach(u => { if (u.id) { u.alive = false; u.outT = -1 } }); const me = st.units[0]; put(me, 34, 0); for (let i = 0; i < 60; i++) G.step(st, { mx: 0, mz: -1 }); return Math.abs(me.z) }
  ok(runFar({ spd: 5, en: 3, atk: 2, jmp: 2 }) > runFar({ spd: 1, en: 3, atk: 4, jmp: 4 }) * 1.15, '足の速さが効く')
  const jumpTop = stats => { const st = G.createState(82, { spawn: 'fixed', stats }); st.units.forEach(u => { if (u.id) { u.alive = false; u.outT = -1 } }); const me = st.units[0]; put(me, 34, 0); G.step(st, { jump: true }); let t = 0; for (let i = 0; i < 90; i++) { G.step(st, {}); t = Math.max(t, me.y) } return t }
  const j3 = jumpTop({ spd: 3, en: 3, atk: 3, jmp: 3 })
  ok(j3 > 2.6 && jumpTop({ spd: 2, en: 2, atk: 3, jmp: 5 }) > j3, '基礎ジャンプは約3m、跳躍を上げると高い', j3.toFixed(2))
}
{ // 人が撃つ狙撃は、狙いを固定した敵ではなく照準の先へ飛ぶ
  const st = mk(83, { loadout: 'sniper' }); killAllBut(st, [0, 3, 4])
  const me = st.units[0], e = st.units[3], f = st.units[4]
  for (const x of [e, f]) { x.role = 'attacker'; x.ai.think = 1e9; x.ai.targetId = -1 }
  put(me, 34, 0, { yaw: Math.PI, snipeCd: 0 }); put(e, 30, -25); put(f, 38, -25)
  me.targetId = 3
  const aim = { x: 38, y: 1.0, z: -25 } // 照準は右の敵（狙いの固定は左の敵）
  for (let i = 0; i < 60; i++) G.step(st, { snipe: true, aimPoint: aim, aimYaw: Math.PI })
  G.step(st, { snipe: false, aimPoint: aim, aimYaw: Math.PI })
  ok(f.en < 100 && e.en === 100, '狙撃は照準の先の敵に当たる（固定した敵ではない）', `照準の敵=${f.en.toFixed(1)} 固定の敵=${e.en.toFixed(1)}`)
}
{ // 撃ち続けても EN はゆっくりしか減らない（ハンドガン10秒撃ちっぱなしで EN の1割強）
  const [st, me] = gunDuel(84, 'handgun', 'normal', 34, -80)
  const en0 = me.en
  for (let i = 0; i < 600; i++) G.step(st, { shoot: true })
  ok(en0 - me.en < 15, 'ハンドガン10秒撃ち続けて EN の減りは15未満', (en0 - me.en).toFixed(1))
}
{ // ミラージュで消えたら、CPU はまっすぐ寄ってこない（見失って別の場所を探す）
  let tgt = 0
  for (let k = 0; k < 6; k++) {
    const st = mk(92 + k, { triggers: ['blade', 'chameleon'] }); killAllBut(st, [0, 3])
    const me = st.units[0], e = st.units[3]
    put(me, 34, 0); put(e, 34, -20); e.role = 'attacker'
    G.step(st, { cham: true })
    for (let i = 0; i < 600; i++) { G.step(st, {}); if (e.targetId === 0) tgt++ }
  }
  ok(tgt / 6 < 120, 'ミラージュ中は10秒のうち2秒も狙われない（使う前は約8秒狙われていた）', `${(tgt / 6).toFixed(0)}コマ/600`)
}
{ // 重り弾: 当たった相手の足が遅くなり、時間で戻る
  const [st, me, e] = gunDuel(85, 'handgun', 'weight', 34, -10)
  e.role = 'attacker'; me.targetId = 3
  for (let i = 0; i < 40; i++) G.step(st, { shoot: i < 30 })
  const slowed = e.slow
  const runDist = () => { const x0 = e.z; for (let i = 0; i < 30; i++) { e.vx = 0; G.step(st, {}) } return x0 }
  ok(slowed >= 0.18 && e.weights >= 3 && Math.abs(slowed - Math.min(0.75, e.weights * 0.06)) < 1e-9, '重り弾は当たった数だけ重くなる', `重り${e.weights}個 重さ=${slowed.toFixed(2)}`)
  ok(e.slowT > 50, '効き目は1分続く', e.slowT.toFixed(1))
  for (let i = 0; i < 61 * 60; i++) G.step(st, {})
  ok(e.slow === 0 && e.weights === 0, '1分たつと重りが外れる', `${e.slow} ${e.weights}`)
  ok(100 - e.en < 15, '重り弾はほとんど削れない', (100 - e.en).toFixed(1))
}
{ // ベランダは下からすり抜けて跳び上がれる（頭をぶつけて建物側へ押し込まれない）
  const l = G.BLOCKS.find(b => b.kind === 'ledge' && b.h === 18)
  const st = G.createState(86, { spawn: 'fixed', triggers: ['blade', 'pad'] }); st.units.forEach(u => { if (u.id) { u.alive = false; u.outT = -1 } })
  const me = st.units[0]
  put(me, l.x, l.z)
  G.step(st, { pad: true }); let top = 0, inside = 0, second = false
  for (let i = 0; i < 400; i++) { G.step(st, !second && me.vy < 1 && i > 3 ? (second = true, { pad: true }) : {}); top = Math.max(top, me.y); for (const b of st.blocks) if (!b.kind && !b.y0 && me.y < b.h - 0.4 && Math.abs(me.x - b.x) < b.w / 2 - 0.05 && Math.abs(me.z - b.z) < b.d / 2 - 0.05) inside++ }
  ok(top > l.h && inside === 0, 'ベランダの真下から跳んでも上へ抜け、建物に入らない', `最高=${top.toFixed(1)} めり込み=${inside}`)
  ok(Math.abs(me.y - l.h) < 0.05 || me.y === 0, '落ちてくると足場の上か地面に立つ', me.y.toFixed(2))
}
{ // 銃ごとの特徴
  // 走りながら撃つと、ハンドガンは散らず、ライフルは散る
  const devOf = gun => { const st = mk(87, { triggers: [gun, 'pad'] }); killAllBut(st, [0]); const me = st.units[0]; put(me, 34, 0, { yaw: Math.PI, shootCd: 0 }); let mx = 0
    for (let i = 0; i < 40; i++) { G.step(st, { mx: 1, mz: 0, shoot: true, lockOff: true, aimYaw: Math.PI, aimPitch: 0 }) }
    for (const b of st.bullets) mx = Math.max(mx, Math.abs(Math.atan2(b.vx, -b.vz))); return mx }
  const h = devOf('handgun'), r = devOf('rifle')
  ok(h < 0.012 && r > h * 2, '走りながらでもハンドガンは散らず、ライフルは散る', `ハンドガン=${(h * 57.3).toFixed(1)}度 ライフル=${(r * 57.3).toFixed(1)}度`)
  // ライフルは撃ち続けると散りが増える
  { const st = mk(88, { triggers: ['rifle', 'pad'] }); killAllBut(st, [0]); const me = st.units[0]; put(me, 34, 0, { yaw: Math.PI, shootCd: 0 })
    for (let i = 0; i < 60; i++) G.step(st, { shoot: true, lockOff: true, aimYaw: Math.PI, aimPitch: 0 })
    ok(me.bloom > 0.03, 'ライフルは撃ち続けるほど散る', me.bloom.toFixed(3)) }
  // ショットガンは近くで当てると押し返してよろめかせる
  { const [st, me, e] = gunDuel(89, 'shotgun', 'normal', 34, -4); e.role = 'attacker'; me.targetId = 3
    const z0 = e.z; G.step(st, { shoot: true }); for (let i = 0; i < 6; i++) G.step(st, {})
    ok(e.z < z0 - 0.1 || e.stun > 0, 'ショットガンは相手を押し返す・よろめかせる', `押した=${(z0 - e.z).toFixed(2)}m よろめき=${e.stun.toFixed(2)}`) }
  // ハンドガンは頭に当たると1.5倍
  { const st = mk(90, { triggers: ['handgun', 'pad'] }); killAllBut(st, [0, 3]); const me = st.units[0], e = st.units[3]
    e.role = 'shooter'; e.trig = ['pad']; e.gun = e.melee = e.sniper = null; e.ai.think = 1e9; e.ai.targetId = -1
    put(me, 34, 0, { yaw: Math.PI, shootCd: 0 }); put(e, 34, -12)
    G.step(st, { shoot: true, lockOff: true, aimPoint: { x: 34, y: 1.75, z: -12 } }); for (let i = 0; i < 30; i++) G.step(st, {})
    const head = 100 - e.en
    ok(head > G.GUNS.handgun.dmg * 1.3, 'ハンドガンは頭に当たると1.5倍', `${head.toFixed(2)}（ふつうは${G.GUNS.handgun.dmg}）`) }
}
{ // 重りが付くとジャンプも低くなる
  const top = w => { const st = G.createState(93, { spawn: 'fixed' }); st.units.forEach(u => { if (u.id) { u.alive = false; u.outT = -1 } }); const me = st.units[0]; put(me, 34, 0)
    me.weights = w; me.slow = Math.min(0.75, w * 0.06); me.slowT = 60; G.step(st, { jump: true }); let t = 0; for (let i = 0; i < 90; i++) { G.step(st, {}); t = Math.max(t, me.y) } return t }
  const a = top(0), b = top(8)
  ok(b < a * 0.6, '重り8個でジャンプが大きく下がる', `重りなし=${a.toFixed(2)}m 8個=${b.toFixed(2)}m`)
}
{ // レベルで増えた点: 合計15点まで振れる。それを超える振り方は標準に戻す
  ok(G.validStats({ spd: 5, en: 4, atk: 3, jmp: 3 }, 3).spd === 5, 'レベルの点（+3）があれば合計15点まで振れる')
  ok(G.validStats({ spd: 5, en: 4, atk: 3, jmp: 3 }, 0).spd === 3, '点が足りなければ標準に戻す')
  ok(G.validStats({ spd: 5, en: 5, atk: 5, jmp: 5 }, 9).spd === 3, '増える点は3点まで')
}
// ---------------------------------------------------------------- 第六感
{ // 鷹の目: 60m 先の敵がレーダーに映る（ふつうは50mまで）
  const st = mk(94, { sense: 'hawk' }); killAllBut(st, [0, 3])
  const me = st.units[0], e = st.units[3]
  const b = G.LEGACY_BLOCKS[2] // 間に建物を挟み、目では見えないようにする
  put(me, b.x, b.z + 58); put(e, b.x, b.z - b.d / 2 - 1); e.ai.think = 1e9
  const hawk = G.detectable(st, 0, e); me.sense = null
  ok(hawk && !G.detectable(st, 0, e), '鷹の目は建物の陰の約60m先の敵もレーダーで見つける（ふつうは見えない）', `距離=${Math.hypot(me.x - e.x, me.z - e.z).toFixed(1)}m`)
}
{ // 再起: 5秒で再出撃（ふつうは8秒）
  const st = mk(95, { sense: 'rally' }); killAllBut(st, [0, 3])
  const me = st.units[0], e = st.units[3]; e.ai.think = 1e9; e.ai.targetId = -1; put(e, 34, -40)
  put(me, 34, 0); me.en = 0.01; me.lastHitBy = 3; me.wounds.push({ rate: 1, t: 1 })
  for (let i = 0; i < 60 * 5.5; i++) G.step(st, {})
  ok(me.alive, '再起は5秒で再出撃する', `alive=${me.alive}`)
}
{ // 精密: 頭への狙撃が1.3倍
  ok(G.PRECISE_HEAD > 1, '精密の頭の倍率は1倍より大きい')
  // 銃: 頭を狙ったハンドガンは精密で1.5×1.3倍
  const head = sense => { const st = mk(97, { triggers: ['handgun', 'pad'], sense }); killAllBut(st, [0, 3]); const me = st.units[0], e = st.units[3]
    e.role = 'shooter'; e.trig = ['pad']; e.gun = e.melee = e.sniper = null; e.ai.think = 1e9; e.ai.targetId = -1
    put(me, 34, 0, { yaw: Math.PI, shootCd: 0 }); put(e, 34, -12)
    G.step(st, { shoot: true, lockOff: true, aimPoint: { x: 34, y: 1.75, z: -12 } }); for (let i = 0; i < 30; i++) G.step(st, {}); return 100 - e.en }
  const a = head(null), b = head('precise')
  ok(b > a * 1.2, '精密は頭に当たるとさらに1.3倍', `ふつう=${a.toFixed(2)} 精密=${b.toFixed(2)}`)
}
{ // 逆境: EN が3割を切ると攻撃+20%・足+10%
  const st = mk(98, { sense: 'adversity' }); killAllBut(st, [0])
  const me = st.units[0]
  ok(!G.adverse(me), 'EN が多いうちは逆境は効かない')
  me.en = 25
  ok(G.adverse(me), 'EN が3割を切ると逆境が効く')
  const far = sense => { const s2 = mk(99, { sense }); killAllBut(s2, [0]); const m = s2.units[0]; put(m, 34, 0); m.en = 20; for (let i = 0; i < 60; i++) G.step(s2, { mx: 0, mz: -1 }); return Math.abs(m.z) }
  ok(far('adversity') > far(null) * 1.07, '逆境中は足が速い')
}
console.log(`\n${pass} OK / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
