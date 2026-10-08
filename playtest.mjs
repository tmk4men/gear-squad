// 実時間プレイテスト。時間を止めず、本物のキー入力で人のように遊ばせ、
// 連写と状態ログを 検証/playtest/ に残す。node playtest.mjs [webkit] [幅x高さ] [秒]
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const ROOT = import.meta.dirname
const PORT = 5198
const useWebkit = process.argv.includes('webkit')
const noLook = process.argv.includes('nolook')
const sniper = process.argv.includes('sniper')
const sizeArg = process.argv.find(a => /^\d+x\d+$/.test(a)) || '1280x800'
const secs = Number(process.argv.find(a => /^\d+$/.test(a)) || 100)
const [W, H] = sizeArg.split('x').map(Number)
const OUT = join(ROOT, '検証', 'playtest', (useWebkit ? 'webkit-' : 'chromium-') + sizeArg + (noLook ? '-nolook' : '') + (process.argv.includes('noauto') ? '-noauto' : '') + (sniper ? '-sniper' : '') + (process.argv.includes('harbor') ? '-harbor' : ''))
await mkdir(OUT, { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const browser = useWebkit ? await webkit.launch() : await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
const errors = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', e => errors.push('[pageerror] ' + e.message))
page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url()))
await page.addInitScript(([l, st]) => { try { localStorage.setItem('ts-loadout', l); localStorage.setItem('ts-stage', st) } catch {} }, [sniper ? 'sniper' : 'allround', process.argv.includes('harbor') ? 'harbor' : 'city'])
await page.goto(`http://localhost:${PORT}/`)
await page.waitForFunction(() => window.__tsReady, null, { timeout: 20000 })
await page.waitForTimeout(800)
await page.evaluate(n => { window.__tsNoHint = true; window.__tsNoAuto = n }, process.argv.includes('noauto'))
await page.keyboard.press('Enter')
await page.waitForTimeout(150)
if (sniper) await page.keyboard.press('Digit2') // スナイパー型の武器は ライフル(1)・狙撃銃(2)
await page.waitForTimeout(100)

const held = new Set()
async function hold(keys) {
  for (const k of held) if (!keys.includes(k)) { await page.keyboard.up(k); held.delete(k) }
  for (const k of keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k) }
}
const log = [], anomalies = []
let shot = 1, lastShot = Date.now(), lastPos = null, stillMs = 0
const t0 = Date.now()
let skipped = false
while (Date.now() - t0 < secs * 1000) {
  const s = await page.evaluate(() => ({ mode: ts.mode, st: ts.state(), cov: ts.coverage(), camIn: ts.camInside(), bullets: ts.raw() ? ts.raw().bullets.map(b => [b.x, b.z, b.vx, b.vz, b.team]) : [] }))
  const ms = Date.now() - t0
  log.push({ ms, mode: s.mode, st: s.st })
  if (s.mode === 'result') break
  const st = s.st
  if (!st) { await page.waitForTimeout(100); continue }
  const me = st.units.find(u => u.player)
  if (st.units.some(u => ![u.x, u.y, u.z, u.en].every(Number.isFinite))) anomalies.push({ ms, what: 'NaN' })
  if (s.camIn) anomalies.push({ ms, what: 'カメラが建物の中', cam: st.cam })
  if (s.cov.std < 8) anomalies.push({ ms, what: '画面がほぼ単色', cov: s.cov })
  if (s.mode === 'play' && me.alive) {
    // 一番近い敵を狙う（マウスで視点を向ける代わりに視点を直接その方向へ向ける）
    const foes = st.units.filter(u => u.team === 1 && u.alive).map(u => ({ u, d: Math.hypot(u.x - me.x, u.z - me.z) })).sort((a, b) => a.d - b.d)
    const t = foes[0] && foes[0].u
    const d = foes[0] ? foes[0].d : 99
    const keys = []
    const incoming = s.bullets.some(b => b[4] !== 0 && Math.hypot(b[0] - me.x, b[1] - me.z) < 7)
    if (t) {
      // nolook: 視点に一切触らず、カメラの自動追従だけで戦わせる（キーボードだけの人の再現）
      if (!noLook) await page.evaluate(([x, z]) => ts.look(Math.atan2(x, z), 0.12), [t.x - me.x, t.z - me.z])
      // 中距離は横に回りながら、遠ければ前へ、近ければ斬りに行く
      if (d > 9 || d < 3) keys.push('KeyW')
      else keys.push(Math.floor(ms / 2500) % 2 ? 'KeyA' : 'KeyD')
    }
    // スナイパー: 6m より遠ければ J を約0.8秒押してためて、離して撃つ
    if (sniper) {
      if (d > 6 && d < 45 && Date.now() - (globalThis.snipeEnd || 0) > 1500) {
        if (!globalThis.snipeStart) globalThis.snipeStart = Date.now()
        if (Date.now() - globalThis.snipeStart < 800) keys.push('KeyJ') // スナイパー型は1番が狙撃銃
        else { globalThis.snipeStart = 0; globalThis.snipeEnd = Date.now(); globalThis.shots = (globalThis.shots || 0) + 1 }
      } else globalThis.snipeStart = 0
    }
    // 武器スロット: 近ければ1（近接）、それ以外は2（銃）に持ち替えて J で攻撃（銃は押している間撃つ）
    if (!sniper) {
      const want = d < 3.2 ? 'Digit1' : 'Digit2'
      if (globalThis.slot !== want) { await page.keyboard.press(want); globalThis.slot = want }
      if (d < 3.2) keys.push('KeyJ'); else if (d < 25 && !incoming) keys.push('KeyJ')
    }
    await hold(keys)
    if (Math.random() < 0.03) await page.keyboard.press('KeyE')
    // 動けていない時間を測る（壁に引っかかる不具合の検出）
    if (lastPos && keys.some(k => ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) && Math.hypot(me.x - lastPos.x, me.z - lastPos.z) < 0.02) stillMs += 60; else stillMs = 0
    if (stillMs > 1500) { anomalies.push({ ms, what: '移動キーを押しているのに動かない', me }); stillMs = 0 }
    lastPos = { x: me.x, z: me.z }
  } else if (s.mode === 'play' && !me.alive && !skipped && ms > 0) {
    await hold([])
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(OUT, `bailout-spectate.png`) })
    skipped = true
    if (await page.isVisible('#skipBtn')) await page.click('#skipBtn')
  } else await hold([])
  if (Date.now() - lastShot > 2500) {
    await page.screenshot({ path: join(OUT, String(shot++).padStart(2, '0') + `-${s.mode}.png`) })
    lastShot = Date.now()
  }
  await page.waitForTimeout(40)
}
await hold([])
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, '99-end.png') })
const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else r(n) }; requestAnimationFrame(f) }))
await writeFile(join(OUT, 'log.json'), JSON.stringify({ errors, anomalies, log }, null, 1))
const last = log[log.length - 1]
console.log(JSON.stringify({ shots: globalThis.shots || 0, out: OUT, samples: log.length, endMode: last.mode, t: last.st && last.st.t, score: last.st && last.st.score, me: last.st && last.st.units[0], fps, errors, anomalies: anomalies.slice(0, 10), anomalyCount: anomalies.length }, null, 1))
await browser.close()
server.kill()
