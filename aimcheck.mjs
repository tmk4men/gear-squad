// 狙撃の着弾が画面中央の照準からどれだけずれるかを測る。node aimcheck.mjs [city|harbor|mall]
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ROOT = import.meta.dirname, PORT = 5199
const stage = process.argv[2] || 'city'
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('[pageerror]', e.message))
await page.addInitScript(st => { try { localStorage.setItem('ts-loadout', 'sniper'); localStorage.setItem('ts-stage', st) } catch {} }, stage)
await page.goto(`http://localhost:${PORT}/`)
await page.waitForFunction(() => window.__tsReady, null, { timeout: 20000 })
const res = await page.evaluate(async () => {
  window.__tsNoAuto = true
  ts.start({ loadout: 'sniper' })
  await new Promise(r => setTimeout(r, 300))
  ts.pause(true)
  const st = ts.raw(), me = st.units.find(u => u.player)
  for (const u of st.units) if (u.team !== me.team) { u.alive = false; u.outT = -1 }
  const { camera, THREE } = ts.three()
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const out = []
  for (let i = 0; i < 160; i++) {
    // 歩ける所に置く: 前回の位置から少しずつ歩かせる
    const yaw = rnd() * Math.PI * 2, pitch = -0.1 + rnd() * 0.35
    ts.look(yaw, pitch)
    ts.run(25 + Math.floor(rnd() * 40), { mx: rnd() * 2 - 1, mz: -1 })
    ts.look(yaw, pitch)
    me.snipeCd = 0; me.en = 100
    ts.run(70, { snipe: true })
    // 半分の回は照準の先に敵を立たせる（当たるか）
    const ap0 = ts.aimPoint(), cp = camera.position.clone(), ad0 = Math.hypot(ap0.x - cp.x, ap0.z - cp.z)
    const foe = st.units.find(u => u.team !== me.team)
    let foeAt = null
    if (i % 2 && ad0 > 15 && Math.abs(cp.x + (ap0.x - cp.x) * 0.7) < 155 && Math.abs(cp.z + (ap0.z - cp.z) * 0.7) < 155) {
      const k = 0.7, fx = cp.x + (ap0.x - cp.x) * k, fz = cp.z + (ap0.z - cp.z) * k, fy = Math.max(0, cp.y + (ap0.y - cp.y) * k - 1)
      Object.assign(foe, { alive: true, x: fx, y: fy, z: fz, vx: 0, vy: 0, vz: 0, en: 100, leak: 0, outT: -1 }); foe.hist = []; foeAt = foe.id
    }
    let ev = null
    const arr = [], types = []; arr.push = function (e) { types.push(e.type + (e.id !== undefined ? ':' + e.id : '')); if (e.type === 'snipe' && e.id === me.id) ev = e; return Array.prototype.push.call(this, e) }
    st.events = arr
    const pre = foeAt !== null ? [foe.alive, foe.x.toFixed(1), foe.y.toFixed(1), foe.z.toFixed(1), foe.cham, foe.bag].join(',') : ''
    camera.updateMatrixWorld()
    const camAt = camera.clone(); camAt.updateMatrixWorld()
    ts.run(1, {})
    if (foeAt !== null) { foe.alive = false; foe.outT = -1 }
    if (!ev) { out.push({ i, none: true }); continue }
    if (foeAt !== null) { out.push({ i, foe: true, hit: ev.hit === foeAt, hitId: ev.hit, evLen: +Math.hypot(ev.hx - ev.x, ev.hz - ev.z).toFixed(1), foeD: +Math.hypot(foe.x - ev.x, foe.z - ev.z).toFixed(1), foeY: +foe.y.toFixed(1), evY: +ev.hy.toFixed(1), post: [foe.x.toFixed(1), foe.y.toFixed(1), foe.z.toFixed(1)].join(','), ap: [ap0.x.toFixed(1), ap0.y.toFixed(1), ap0.z.toFixed(1)].join(','), cam: [cp.x.toFixed(1), cp.y.toFixed(1), cp.z.toFixed(1)].join(','), o: [ev.x.toFixed(1), ev.y.toFixed(1), ev.z.toFixed(1)].join(','), h: [ev.hx.toFixed(1), ev.hy.toFixed(1), ev.hz.toFixed(1)].join(','), types: types.join(' '), pre, blk: st.blocks.filter(b => Math.abs(ev.hx - b.x) <= b.w / 2 + 0.05 && Math.abs(ev.hz - b.z) <= b.d / 2 + 0.05 && ev.hy <= b.h + 0.05 && ev.hy >= (b.y0 || -1) - 0.05).map(b => b.id + '/' + (b.kind || '') + '/' + b.w + 'x' + b.d + 'x' + b.h + '/hp' + b.hp).join(' '), vis: ts.three().buildings.filter(bd => bd.box.containsPoint(new THREE.Vector3(ev.hx, ev.hy, ev.hz).addScaledVector(new THREE.Vector3(ev.hx - ev.x, ev.hy - ev.y, ev.hz - ev.z).normalize(), 0.1))).map(bd => bd.id + (bd.dead ? 'dead' : '')).join(' ') }); continue }
    const p = new THREE.Vector3(ev.hx, ev.hy, ev.hz).project(camAt)
    const ap = me.aimPoint
    const cam = camAt.position
    out.push({ i, px: Math.round(p.x * 640), py: Math.round(-p.y * 400), dist: +Math.hypot(ev.hx - cam.x, ev.hy - cam.y, ev.hz - cam.z).toFixed(1), aimDist: ap ? +Math.hypot(ap.x - cam.x, ap.y - cam.y, ap.z - cam.z).toFixed(1) : -1, me: [me.x.toFixed(1), me.y.toFixed(1), me.z.toFixed(1)].join(','), cam: [cam.x.toFixed(1), cam.y.toFixed(1), cam.z.toFixed(1)].join(','), inside: ts.camInside() })
  }
  return out
})
const foes = res.filter(r => r.foe)
console.log(stage, 'foe shots', foes.length, 'hit', foes.filter(r => r.hit).length)
for (const r of foes.filter(r => !r.hit)) console.log(JSON.stringify(r))
const plain = res.filter(r => !r.none && !r.foe)
const wall = plain.filter(r => r.aimDist < 5)
console.log(stage, 'aim on wall next to me', wall.length)
const bad = plain.filter(r => r.aimDist >= 5 && Math.hypot(r.px, r.py) > 12)
console.log(stage, 'shots', res.filter(r => !r.none).length, 'none', res.filter(r => r.none).length, 'off>12px', bad.length)
for (const r of bad.slice(0, 25)) console.log(JSON.stringify(r))
await browser.close(); server.kill()
