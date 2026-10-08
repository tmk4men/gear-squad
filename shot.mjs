// 1シーンだけ撮る。node shot.mjs <title|play|fight|bail|over> [幅x高さ] [webkit]
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const ROOT = import.meta.dirname
const scene = process.argv[2] || 'title'
const size = process.argv.find(a => /^\d+x\d+$/.test(a)) || '1280x800'
const useWebkit = process.argv.includes('webkit')
const [W, H] = size.split('x').map(Number)
const PORT = 5196
await mkdir(join(ROOT, '検証'), { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const browser = useWebkit ? await webkit.launch() : await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: W, height: H }, ...(useWebkit && W < H ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
const page = await ctx.newPage()
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', e => errs.push(e.message))
await page.goto(`http://localhost:${PORT}/`)
await page.waitForFunction(() => window.__tsReady, null, { timeout: 20000 })
await page.waitForTimeout(600)
const wx = process.argv.find(a => ['storm', 'snow', 'clear'].includes(a))
if (process.argv.includes('harbor')) { await page.evaluate(() => document.querySelector('.sg[data-s="harbor"]').click()); await page.waitForTimeout(1500) }
if (wx) await page.evaluate(w => document.querySelector(`.wx[data-w="${w}"]`).click(), wx)
if (scene !== 'title') {
  await page.evaluate(sn => { ts.pause(true); ts.start(sn ? { loadout: 'sniper' } : {}) }, scene.startsWith('snipe'))
  await page.evaluate(() => ts.run(30))
  if (scene === 'fight') {
    await page.evaluate(() => { ts.place(0, 0, 4, { yaw: Math.PI }); ts.place(3, 0.6, 1.6, { yaw: 0 }); ts.place(5, -5, -6); ts.look(Math.PI, 0.16); ts.run(20, {}) })
    await page.evaluate(() => ts.run(8, { blade: true }))
  }
  if (scene === 'shoot') {
    await page.evaluate(() => { ts.place(0, 2, 13, { yaw: Math.PI }); ts.place(5, 0, 1, { yaw: 0 }); ts.look(Math.PI, 0.1); ts.run(10) })
    await page.evaluate(() => ts.run(5, { shoot: true }))
  }
  if (scene === 'wall') {
    // 壁に背を向けて張り付く・壁に向かって張り付く、の両方でカメラが壁に埋まらないか
    const r = await page.evaluate(() => {
      const out = []
      for (const [x, z, yaw] of [[-12, -10.5, 0.15], [-12, -10.5, Math.PI], [-10.3, -6, Math.PI / 2], [-10.3, -6, -Math.PI / 2]]) {
        ts.place(0, x, z, { yaw }); ts.look(yaw, 0.12); ts.run(40)
        out.push({ x, z, yaw: +yaw.toFixed(2), inside: ts.camInside(), cov: ts.coverage().std })
      }
      return out
    })
    console.log(JSON.stringify(r))
  }
  if (scene === 'hop') await page.evaluate(() => { ts.place(0, -20, 20, { yaw: Math.PI / 2 }); ts.look(Math.PI / 2, 0.05); ts.run(1, { pad: true, mx: 1 }); for (let i = 0; i < 3; i++) { ts.run(14, { mx: 1 }); ts.run(1, { pad: true, mx: 1 }) } ts.run(6, { mx: 1 }) })
  // 狙撃: ためている途中（スコープ）と、撃った瞬間（光線）
  // 大通り（z=0）で東を向き、25m先の敵を狙う。味方は邪魔にならない所へ
  const avenue = "ts.place(1, -28, 28); ts.place(2, -26, 28); ts.place(0, -18, 0, { yaw: Math.PI / 2 }); ts.place(3, 8, 0); ts.look(Math.PI / 2, 0.05); ts.run(20)"
  if (scene === 'snipe-charge') await page.evaluate(a => { eval(a); ts.run(40, { snipe: true }) }, avenue)
  if (scene === 'snipe-shot') await page.evaluate(a => { eval(a); ts.run(56, { snipe: true }); ts.run(3) }, avenue)
  if (scene === 'snipe-enemy') await page.evaluate(() => { ts.place(0, 2, 2, { yaw: 0 }); ts.place(4, 2, 24); ts.look(0, 0.1); const s = ts.raw(); s.units[4].snipeCd = 0; ts.run(50) })
  // 背景: 屋上から空と遠景を見上げる
  if (scene === 'sky') await page.evaluate(() => { window.__tsNoAuto = true; ts.place(0, 14, 6, { yaw: -2.3 }); const s = ts.raw(); s.units[0].y = 15.6; ts.look(-2.3, -0.4); ts.run(30) })
  // キャラの作り込み: 3役を並べて正面と背面から
  if (scene === 'chars' || scene === 'chars-back') await page.evaluate(back => {
    const s = ts.raw()
    for (const id of [1, 2, 3, 4, 5]) { s.units[id].ai.think = 99; s.units[id].ai.targetId = -1 }
    ts.place(0, -14, -1, { yaw: 0 }); ts.place(1, -15.4, -1, { yaw: 0 }); ts.place(2, -12.6, -1, { yaw: 0 })
    ts.place(3, 25, -25); ts.place(4, 26, -26); ts.place(5, 27, -24)
    if (back) for (const id of [0, 2]) s.units[id].bag = true
    ts.run(20)
    window.__tsCam = back ? [-14, 1.7, -4.6, -14, 1.05, -1] : [-14, 1.6, 2.6, -14, 1.05, -1]
  }, scene === 'chars-back')
  if (scene === 'lowen') await page.evaluate(() => { const s = ts.raw(); s.units[0].en = 22; s.units[0].wounds.push({ rate: 0.4, t: 30 }); ts.run(30) })
  // 全景: 上空から街全体を見下ろす
  if (scene === 'overview') await page.evaluate(() => { ts.run(2); window.__tsCam = [100, 200, 160, 0, 0, 0] })
  // ダメージの数値: 大通りで敵を目の前に置いて、斬る・撃つ
  if (scene === 'dmg-blade') await page.evaluate(() => { const s = ts.raw(); for (const id of [1, 2, 4, 5]) ts.place(id, 90, 90 - id); ts.place(0, -10, 0, { yaw: Math.PI / 2 }); ts.place(3, -8, 0); s.units[3].ai.think = 99; s.units[3].ai.targetId = -1; ts.look(Math.PI / 2, 0.12); ts.run(10); ts.run(12, { blade: true }) })
  if (scene === 'dmg-shoot') await page.evaluate(() => { const s = ts.raw(); for (const id of [1, 2, 4, 5]) ts.place(id, 90, 90 - id); ts.place(0, -16, 0, { yaw: Math.PI / 2 }); ts.place(3, -6, 0); s.units[3].ai.think = 99; s.units[3].ai.targetId = -1; s.units[0].shootCd = 0; ts.look(Math.PI / 2, 0.08); ts.run(10); ts.run(22, { shoot: true }) })
  // 狙撃場所: 屋上の手すり壁と塔屋。屋上に立った自機を少し離れた上空から
  if (scene === 'nest') await page.evaluate(() => {
    const s = ts.raw(), n = ts.nests()[0]
    for (const id of [1, 2, 3, 4, 5]) { ts.place(id, 95, 95 - id); s.units[id].ai.think = 99; s.units[id].ai.targetId = -1 }
    ts.place(0, n.x - 1, n.z + 1); s.units[0].y = n.h; ts.run(10)
    window.__tsCam = [n.x + n.w * 0.9, n.h + 7, n.z + n.d * 1.1, n.x, n.h, n.z]
  })
  if (scene === 'pad') await page.evaluate(() => { ts.run(1, { pad: true, mz: -1 }); ts.run(14, { mz: -1 }) })
  if (scene === 'bail') await page.evaluate(() => { ts.place(3, 0, 18); const s = ts.raw(); s.units[3].en = 0.001; s.units[3].wounds.push({ rate: 1, t: 5 }); s.units[3].lastHitBy = 0; ts.run(2); ts.run(22) })
  // 脱出中の秒読み（spectate）と、再出撃した直後（respawn）
  if (scene === 'spectate' || scene === 'respawn') await page.evaluate(r => { const s = ts.raw(); s.units[0].en = 0.001; s.units[0].wounds.push({ rate: 1, t: 5 }); s.units[0].lastHitBy = 3; ts.run(2); ts.run(r ? 60 * 8 + 20 : 120) }, scene === 'respawn')
  if (scene === 'over') await page.evaluate(() => { const s = ts.raw(); s.score[0] = 3; s.score[1] = 1; s.timeLeft = 0.05; ts.run(2); ts.run(70) })
  // 延長戦に入った瞬間
  if (scene === 'overtime') await page.evaluate(() => { const s = ts.raw(); s.timeLeft = 0.05; ts.run(30) })
  // 敵のスナイパーにためられている（画面の外から）
  if (scene === 'warn') await page.evaluate(() => { const s = ts.raw(); for (const id of [1, 2, 3, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } ts.place(0, 0, 0, { yaw: 0 }); ts.place(4, 0, -40); s.units[4].role = 'sniper'; s.units[4].trig = ['snipe', 'shoot', 'pad', 'bag']; s.units[4].snipeCd = 0; s.units[4].bag = false; ts.look(0, 0.1); ts.run(35) })
  // 見えていない敵の音がミニマップに出る（マントを着た敵が離れた所で撃つ）
  if (scene === 'ping') await page.evaluate(() => { const s = ts.raw(); for (const id of [1, 2, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } ts.place(0, 0, 0, { yaw: Math.PI }); ts.place(3, 30, 70); s.units[3].bag = true; s.units[3].trig = ['blade', 'shoot', 'pad', 'bag']; ts.look(0, 0.1); for (let i = 0; i < 4; i++) { s.units[3].shootCd = 0; s.units[3].dashCd = 0; ts.run(1, {}); s.units[3].ai.think = 0 } const sh = s.units[3]; sh.shootCd = 0; ts.run(1); ts.run(20) })
  // 寸法の比較: 建物の壁の前に立たせ、真横から撮る
  if (scene === 'scale') await page.evaluate(() => {
    const s = ts.raw(); for (const id of [1, 2, 3, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 }
    // 正面（+z）の前12mに何もない低い建物
    const free = (x, z) => !s.blocks.some(k => Math.abs(x - k.x) < k.w / 2 + 0.5 && Math.abs(z - k.z) < k.d / 2 + 0.5)
    const b = s.blocks.find(b => !b.kind && b.h < 16 && b.w >= 12 && [2, 6, 10, 12].every(t => free(b.x, b.z + b.d / 2 + t)))
    ts.place(0, b.x + 2.4, b.z + b.d / 2 + 0.6, { yaw: 0 }); ts.run(10)
    window.__tsCam = [b.x, 1.6, b.z + b.d / 2 + 10, b.x, 3, b.z + b.d / 2]
  })
  // 新しいギア: 自機の射撃を差し替えて撃つ。meteora は爆発、hound は曲がる弾、tele は跳んだ直後、cham は味方から見た姿
  // 銃と弾の見た目: launcher=グレネード、homing/blast/curve/weight=ハンドガンにその弾
  if (['launcher', 'homing', 'blast', 'curve', 'weight', 'normal'].includes(scene)) await page.evaluate(g => { const s = ts.raw(); for (const id of [1, 2, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } ts.place(0, 0, 14, { yaw: Math.PI }); ts.place(3, 4, 0); s.units[3].ai.think = 99; s.units[3].ai.targetId = -1; s.units[0].gun = g === 'launcher' ? 'launcher' : 'rifle'; s.units[0].ammo = g === 'launcher' ? 'normal' : g; s.units[0].shootCd = 0; ts.look(Math.PI, 0.1); ts.run(5); ts.run(g === 'launcher' ? 30 : g === 'weight' ? 120 : 14, { shoot: true }); if (g === 'weight') { ts.place(0, 12, 14); ts.run(30); window.__tsW = s.units[3].weights; window.__tsCam = [s.units[3].x + 2.2, 2.0, s.units[3].z - 2.6, s.units[3].x, 1, s.units[3].z] } }, scene)
  if (scene === 'tele') await page.evaluate(() => { const s = ts.raw(); for (const id of [1, 2, 3, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } ts.place(0, 0, 14, { yaw: Math.PI }); s.units[0].trig = [...s.units[0].trig, 'teleport']; ts.look(Math.PI, 0.1); ts.run(5); ts.run(4, { tele: true, mz: -1 }) })
  if (scene === 'cham') await page.evaluate(() => { const s = ts.raw(); for (const id of [3, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } ts.place(0, 0, 14, { yaw: Math.PI }); ts.place(1, 1.5, 9); s.units[1].ai.think = 99; s.units[1].trig = ['blade', 'chameleon']; s.units[1].cham = true; ts.look(Math.PI, 0.1); ts.run(40) })
  // ゲーム中の距離で見た並び（前と後ろ）。lineup-back は後ろの2人にマントを着せる
  if (scene === 'lineup' || scene === 'lineup-back') await page.evaluate(back => { const s = ts.raw(); for (const id of [3, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } window.__tsNoAuto = true; for (const [id, x] of [[0, 0], [1, -1.6], [2, 1.6]]) { ts.place(id, x, 40, { yaw: back ? Math.PI : 0 }); s.units[id].ai.think = 99 } if (back) { s.units[2].bag = true } ts.run(10); window.__tsCam = [2.5, 2.2, back ? 34 : 46, 0, 1.1, 40] }, scene === 'lineup-back')
  // 建物に背を向けて立つ: カメラと自機の間に建物が入り、建物が透ける
  if (scene === 'fade') await page.evaluate(() => { const s = ts.raw(); for (const id of [1, 2, 3, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } window.__tsNoAuto = true; const free = (x, z) => !s.blocks.some(k => Math.abs(x - k.x) < k.w / 2 + 0.5 && Math.abs(z - k.z) < k.d / 2 + 0.5); const b = s.blocks.find(b => !b.kind && b.h > 10 && b.w >= 12 && [2, 6, 10].every(t => free(b.x, b.z + b.d / 2 + t))); ts.place(0, b.x, b.z + b.d / 2 + 2, { yaw: 0 }); ts.look(0, 0.12); ts.run(40) })
  // 全体地図（M キー）
  if (scene === 'bigmap') await page.evaluate(() => { ts.run(60); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); ts.run(2) })
  // 高い建物のベランダ（足場）を地上から
  if (scene === 'ledge') await page.evaluate(() => { const s = ts.raw(); for (const id of [1, 2, 3, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } const l = s.blocks.find(b => b.kind === 'ledge' && b.h === 18); const t = s.blocks.find(b => !b.kind && Math.abs(l.x - b.x) <= b.w / 2 + l.w && Math.abs(l.z - b.z) <= b.d / 2 + l.d && b.h > 26); const ox = Math.abs(l.x - t.x) > t.w / 2 ? Math.sign(l.x - t.x) : 0, oz = ox ? 0 : Math.sign(l.z - t.z); ts.place(0, l.x + ox * 8, l.z + oz * 8); ts.run(5); window.__tsCam = [l.x + ox * 26 + oz * 10, 6, l.z + oz * 26 + ox * 10, t.x, 28, t.z] })
  // 建物の破壊: 近くの小さな建物にバーストを撃ち込んで崩す（crumble はその途中、rubble は崩れた後）
  if (scene === 'crumble' || scene === 'rubble') await page.evaluate(late => { const s = ts.raw(); for (const id of [1, 2, 3, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } window.__tsNoAuto = true
    const free = (x, z) => !s.blocks.some(k => Math.abs(x - k.x) < k.w / 2 + 0.5 && Math.abs(z - k.z) < k.d / 2 + 0.5)
    const b = s.blocks.find(b => !b.kind && Number.isFinite(b.hp) && b.h > 8 && b.w >= 12 && [3, 8, 14, 20].every(t => free(b.x, b.z + b.d / 2 + t)))
    ts.place(0, b.x, b.z + b.d / 2 + 14, { yaw: Math.PI }); s.units[0].gun = 'meteora'; s.units[0].targetId = -1; ts.look(Math.PI, 0.05)
    let n = 0; while (s.blocks.includes(b) && n++ < 80) { s.units[0].shootCd = 0; s.units[0].en = 100; ts.run(1, { shoot: true }); ts.run(40) }
    ts.run(late ? 200 : 25); window.__tsCam = [b.x + 14, 9, b.z + b.d / 2 + 26, b.x, b.h * 0.4, b.z] }, scene === 'rubble')
  // 強制帰還の演出（自機の前の敵）: bail2 は0.2秒後、bail3 は0.6秒後
  if (scene === 'bail2' || scene === 'bail3') await page.evaluate(late => { const s = ts.raw(); for (const id of [1, 2, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } window.__tsNoAuto = true; ts.place(0, 0, 40, { yaw: Math.PI }); ts.place(3, 0, 33); s.units[3].ai.think = 99; s.units[3].ai.targetId = -1; ts.look(Math.PI, 0.1); ts.run(5); s.units[3].en = 0.01; s.units[3].lastHitBy = 0; s.units[3].wounds.push({ rate: 1, t: 2 }); ts.run(late ? 36 : 12) }, scene === 'bail3')
  // 武器の持ち替え: 2番（銃）を持った後ろ姿
  if (scene === 'swap') await page.evaluate(() => { const s = ts.raw(); for (const id of [1, 2, 3, 4, 5]) { ts.place(id, 150, 150 - id); s.units[id].ai.think = 99 } window.__tsNoAuto = true; ts.place(0, 0, 40, { yaw: Math.PI }); ts.look(Math.PI + 0.6, 0.1); dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' })); ts.run(+(new URLSearchParams(location.search).get('n') || 8)) })
  // 地上から大通りの高層ビルを見上げる
  if (scene === 'street') await page.evaluate(() => { window.__tsNoAuto = true; ts.place(0, 0, 40, { yaw: Math.PI }); ts.look(Math.PI, -0.25); ts.run(20) })
}
await page.waitForTimeout(scene === 'title' || scene === 'spectate' || scene === 'respawn' || scene === 'warn' || scene.startsWith('snipe') ? 0 : scene === 'over' ? 300 : 2000)
await page.evaluate(() => window.ts && ts.render())
const out = join(ROOT, '検証', `${scene}-${size}${useWebkit ? '-webkit' : ''}.png`)
await page.screenshot({ path: out })
console.log(out, JSON.stringify(await page.evaluate(() => ({ cov: ts.coverage(), info: ts.info(), mode: ts.mode, w0: ts.weights(0), w1: ts.weights(1), weights: window.__tsW, wVisible: (() => { let n = 0; ts.three().scene.traverse(o => { if (o.isMesh && o.visible && o.material && o.material.color && o.material.color.getHexString() === '8e96a3' && o.parent && o.parent.visible) n++ }); return n })() }))), errs.length ? 'ERR ' + errs.join(' | ') : 'no errors')
await browser.close(); server.kill()
