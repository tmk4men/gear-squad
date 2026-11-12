// スマホの縦画面（と横画面の回帰）で、全画面の収まり・重なり・タッチ領域・回転を数える。
// node portrait.mjs [webkit|chromium] [shots] [only=390x844]   → 結果を1行ずつ OK/FAIL で出す。shots で 検証/portrait/ に撮る
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const ROOT = import.meta.dirname, PORT = 5193
const engine = process.argv.includes('chromium') ? 'chromium' : 'webkit'
const SHOTS = process.argv.includes('shots')
const only = (process.argv.find(a => a.startsWith('only=')) || '').slice(5)
const OUT = join(ROOT, '検証', 'portrait')
if (SHOTS) await mkdir(OUT, { recursive: true })
const PORTRAIT = ['360x640', '390x844', '430x932'], LANDSCAPE = ['844x390', '667x375']
const SIZES = (only ? only.split(',').filter(a => /^\d+x\d+$/.test(a)) : [...PORTRAIT, ...LANDSCAPE])
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/`); break } catch { await new Promise(r => setTimeout(r, 100)) } }
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch(MUTE_LAUNCH)
let pass = 0, fail = 0
const ok = (c, msg, extra = '') => { if (c) pass++; else fail++; console.log(`${c ? 'OK  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`) }

// 見えている要素の矩形（hidden・display:none・opacity 0 は除く）
const MEASURE = () => {
  const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || e.hidden) return false } return true }
  const rect = el => { const r = el.getBoundingClientRect(); return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }
  const W = innerWidth, H = innerHeight
  const page = { sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, bh: document.body.scrollHeight, bw: document.body.scrollWidth, W, H }
  // 押せる物（画面内に全部入っていること・44px）
  const taps = [...document.querySelectorAll('button, #stick, #radar, #bigmap')].filter(vis).filter(el => !el.closest('.sh-body') || true).map(el => ({ id: el.id || el.className || el.tagName, r: rect(el), inSheetBody: !!el.closest('.sh-body') }))
  // 試合中の操作とHUD（重なりを数える物）
  const ids = ['stick', 'tBlade', 'tShoot', 'tPad', 'tJump', 'tDash', 'tBag', 'tSup3', 'tLock', 'board', 'pveBar', 'me', 'radar', 'call', 'feed', 'mute', 'snipeWarn', 'spectate']
  const hud = ids.map(id => document.getElementById(id)).filter(vis).map(el => ({ id: el.id, r: rect(el) }))
  // 中でスクロールしている板（シートの中身）
  const scrollers = [...document.querySelectorAll('.sh-body, #result')].filter(vis).map(el => ({ id: el.id || el.className, sh: el.scrollHeight, ch: el.clientHeight }))
  return { page, taps, hud, scrollers, rotate: vis(document.getElementById('rotate')), cam: window.ts && ts.three().camera.aspect, W, H }
}
const inter = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad

async function check(page, size, scr, opt = {}) {
  const m = await page.evaluate(MEASURE)
  const tag = `${engine} ${size} ${scr}`
  ok(m.page.sh <= m.H + 1 && m.page.bh <= m.H + 1 && m.page.sw <= m.W + 1 && m.page.bw <= m.W + 1, `${tag}: 上下・横のはみ出し0`, JSON.stringify(m.page))
  const out = m.taps.filter(t => !t.inSheetBody && (t.r.x < -0.5 || t.r.y < -0.5 || t.r.x + t.r.w > m.W + 0.5 || t.r.y + t.r.h > m.H + 0.5))
  ok(!out.length, `${tag}: ボタンが画面内`, out.map(t => t.id + JSON.stringify(t.r)).join(' '))
  const small = m.taps.filter(t => t.r.w < 43.5 || t.r.h < 43.5).filter(t => !(opt.skipSmall || []).some(s => String(t.id).includes(s)))
  ok(!small.length, `${tag}: タッチ領域44px以上`, small.map(t => t.id + ' ' + t.r.w + 'x' + t.r.h).join(' '))
  if (opt.hud) {
    const ov = []
    for (let i = 0; i < m.hud.length; i++) for (let j = i + 1; j < m.hud.length; j++) if (inter(m.hud[i].r, m.hud[j].r)) ov.push(m.hud[i].id + '×' + m.hud[j].id)
    ok(!ov.length, `${tag}: 操作とHUDの重なり0（${m.hud.length}個）`, ov.join(' '))
  }
  if (opt.noScroll) for (const s of m.scrollers) ok(s.sh <= s.ch + 1, `${tag}: ${s.id} が中でスクロールしない`, `${s.sh}/${s.ch}`)
  ok(!m.rotate, `${tag}: 「横にして」の案内が出ない`)
  if (SHOTS) await page.screenshot({ path: join(OUT, `${engine}-${size}-${scr}.png`) })
  return m
}

async function boot(size, query = '') {
  const [W, H] = size.split('x').map(Number)
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: engine === 'chromium' ? true : true, hasTouch: true, deviceScaleFactor: 2 })
  await muteContext(ctx)
  const page = await ctx.newPage()
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push(e.message))
  page.on('requestfailed', r => errs.push('requestfailed ' + r.url()))
  await page.goto(`http://localhost:${PORT}/${query}`)
  await page.waitForFunction(() => window.__tsReady, null, { timeout: 30000 })
  await page.waitForTimeout(300)
  return { ctx, page, errs }
}
// 試合中に見える物を全部出す: 実況・撃破の流れ・補助ボタン3つ（ブリンク込み）
const FILL_HUD = () => {
  const c = document.getElementById('call'); c.innerHTML = '<b>実況</b>自隊のアタッカーが強制帰還。敵隊に1点、2対3'; c.classList.add('show')
  const f = document.getElementById('feed'); f.innerHTML = '<div class="feed plate"><span class="t0">あなた</span>強制帰還<span class="by">切り込み</span></div><div class="feed plate"><span class="t1">押し込み</span>強制帰還<span class="by">あなた</span></div>'
  for (const el of f.children) el.style.animation = 'none'
  // EN の板の一番長い形（重りの2行）
  const lk = document.getElementById('leak'); if (lk) lk.innerHTML = '<svg><use href="#i-drop"/></svg>重り 59個　足とジャンプ −45%　あと59秒'
}

for (const size of SIZES) {
  const portrait = PORTRAIT.includes(size)
  const { ctx, page, errs } = await boot(size)
  // ホーム
  await check(page, size, 'home')
  for (const sh of ['loadout', 'stage', 'howto', 'coop']) {
    await page.evaluate(k => document.querySelector(`[data-open="${k}"]`).click(), sh)
    await page.waitForTimeout(350)
    if (sh === 'loadout') for (const tab of ['gear', 'ammo', 'stats', 'sense', 'look']) {
      await page.evaluate(t => document.querySelector(`.tabs [data-tab="${t}"]`).click(), tab)
      await check(page, size, `sheet-loadout-${tab}`, { noScroll: portrait })
    } else await check(page, size, `sheet-${sh}`, { noScroll: portrait })
    await page.evaluate(() => { for (const b of document.querySelectorAll('.sheet:not([hidden]) .sh-back')) b.click() })
  }
  // 試合（全部組んだ形: 武器3つ＋補助3つ）
  await page.evaluate(() => { ts.pause(true); ts.start({ triggers: ['blade', 'handgun', 'snipe', 'pad'] }); ts.run(40) })
  await page.evaluate(FILL_HUD)
  const mPlay = await check(page, size, 'play', { hud: true })
  // 補助ギア3つの組み方（持ち替えボタンの代わりに補助のボタンが3つ出る）
  await page.evaluate(() => { document.getElementById('titleBtn').click(); ts.start({ triggers: ['blade', 'pad', 'bag', 'teleport'] }); ts.run(40) })
  await page.evaluate(FILL_HUD)
  await check(page, size, 'play-sup3', { hud: true })
  await page.evaluate(() => { document.getElementById('titleBtn').click(); ts.start({ triggers: ['blade', 'handgun', 'snipe', 'pad'] }); ts.run(40) })
  await page.evaluate(FILL_HUD)
  ok(Math.abs(mPlay.cam - mPlay.W / mPlay.H) < 0.01, `${engine} ${size} play: カメラの縦横比が画面と同じ`, `${mPlay.cam?.toFixed(3)}`)
  const cov = await page.evaluate(() => ts.coverage())
  ok(cov.std > 8, `${engine} ${size} play: 3Dが描けている`, JSON.stringify(cov))
  // 狙撃のスコープ
  await page.evaluate(() => { const s = ts.raw(); s.units[0].en = 100; s.units[0].snipeCd = 0; for (const u of s.units) if (u.team === 1) { u.alive = false; u.outT = 99 } ts.run(30, { snipe: true }) })
  await page.evaluate(() => { document.getElementById('call').classList.remove('show') })
  await check(page, size, 'scope', { hud: true })
  await page.evaluate(() => ts.run(30))
  // 全体地図
  await page.evaluate(() => { dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); ts.run(2) })
  const mMap = await check(page, size, 'bigmap')
  await page.evaluate(() => { dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM' })); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); ts.run(2); dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM' })) })
  // 強制帰還中
  await page.evaluate(() => { const s = ts.raw(); for (const u of s.units) if (u.team === 1) u.outT = 0.01; s.units[0].en = 0.001; s.units[0].wounds.push({ rate: 1, t: 5 }); ts.run(2); ts.run(90) })
  await check(page, size, 'spectate', { hud: true })
  // 結果
  await page.evaluate(() => { const s = ts.raw(); s.score[0] = 3; s.score[1] = 2; s.timeLeft = 0.05; ts.run(2); ts.run(60 * 6) })
  await page.waitForFunction(() => ts.mode === 'result', null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(300)
  await check(page, size, 'result', { noScroll: true })
  // 協力（大型の敵・防衛）と、その結果
  for (const pm of ['boss', 'defense']) {
    await page.evaluate(m => { document.getElementById('titleBtn').click(); ts.pause(true); ts.start({ mode: m, triggers: ['blade', 'handgun', 'snipe', 'pad'] }); ts.run(60 * 12) }, pm)
    await page.evaluate(FILL_HUD)
    await check(page, size, `pve-${pm}`, { hud: true })
    await page.evaluate(() => { const s = ts.raw(); s.timeLeft = 0.01; if (s.def) for (const u of s.units) { u.alive = false; u.outT = 99 }; ts.run(5); ts.run(60 * 6) })
    await page.waitForFunction(() => ts.mode === 'result', null, { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(300)
    await check(page, size, `pve-${pm}-result`, { noScroll: true })
  }
  ok(!errs.length, `${engine} ${size}: コンソールのエラー0`, errs.slice(0, 3).join(' | '))
  const muted = await page.evaluate(() => window.__muteOk())
  ok(muted, `${engine} ${size}: 音が出ていない`)
  await ctx.close()
}

// 回転: 縦→横→縦を試合中に。配置とカメラが追従し、試合が進み続ける
if (!only || only.includes('rotate')) {
  const { ctx, page, errs } = await boot('390x844')
  await page.evaluate(() => { ts.pause(true); ts.start({ triggers: ['blade', 'handgun', 'snipe', 'pad'] }); ts.run(40) })
  ts: for (const size of ['844x390', '390x844', '932x430', '430x932']) {
    const [W, H] = size.split('x').map(Number)
    await page.setViewportSize({ width: W, height: H })
    await page.waitForTimeout(400)
    const t0 = await page.evaluate(() => ts.run(60).t)
    await page.evaluate(FILL_HUD)
    const m = await check(page, 'rotate→' + size, 'play', { hud: true })
    ok(Math.abs(m.cam - W / H) < 0.01, `${engine} 回転→${size}: カメラが追従`, m.cam?.toFixed(3))
    const t1 = await page.evaluate(() => ts.run(60).t)
    ok(t1 > t0 && await page.evaluate(() => ts.mode === 'play'), `${engine} 回転→${size}: 試合が進み続ける`, `${t0}→${t1}`)
  }
  // 本物の時間でも回す（一時停止を解いて、回転の直後のコマで落ちないか）
  await page.evaluate(() => ts.pause(false))
  for (const [W, H] of [[844, 390], [390, 844]]) { await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(700) }
  ok(!errs.length, `${engine} 回転: コンソールのエラー0`, errs.slice(0, 3).join(' | '))
  await ctx.close()
}

// X のアプリ内ブラウザ: 下に貼り付く操作が --inapp-bot だけ上がる
if (!only || only.includes('inapp')) {
  const { ctx, page } = await boot('390x844', '?inapp=x')
  const r = await page.evaluate(() => {
    ts.pause(true); ts.start({ triggers: ['blade', 'handgun', 'snipe', 'pad'] }); ts.run(10)
    const v = getComputedStyle(document.documentElement).getPropertyValue('--inapp-bot').trim()
    const bot = id => innerHeight - document.getElementById(id).getBoundingClientRect().bottom
    return { v, stick: bot('stick'), blade: bot('tBlade'), cls: document.documentElement.className }
  })
  await ctx.close()
  const { ctx: c2, page: p2 } = await boot('390x844', '?inapp=0')
  const r0 = await p2.evaluate(() => { ts.pause(true); ts.start({}); ts.run(10); const bot = id => innerHeight - document.getElementById(id).getBoundingClientRect().bottom; return { stick: bot('stick'), blade: bot('tBlade') } })
  await c2.close()
  ok(r.v === '52px' && Math.abs(r.stick - r0.stick - 52) < 1 && Math.abs(r.blade - r0.blade - 52) < 1, `${engine} Xのアプリ内: 下の操作が52px上がる`, JSON.stringify({ r, r0 }))
}

console.log(`\n${pass} OK / ${fail} FAIL`)
await browser.close(); server.kill()
process.exit(fail ? 1 : 0)
