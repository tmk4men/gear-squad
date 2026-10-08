// 市街地の見た目。当たり判定は game.js の BLOCKS だけで、ここで足す物はすべて飾り。
// 人が歩ける場所に飾りを置くとすり抜けて嘘っぽく見えるので、壁から UNIT_R（45cm）以内か、
// 建物の上か、場外（フェンスの外）にだけ置く。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const PPM = 40 // 壁の絵の解像度（1mあたりの画素）

function rng(seed) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}
function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(4, Math.round(w)); c.height = Math.max(4, Math.round(h))
  return c
}
function texFrom(c, srgb = true) {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}
// 細かいざらつき（何度も使うので1枚作って模様として敷く）
let grainCache = null
function grain(ctx) {
  if (!grainCache) {
    const c = canvas(128, 128), x = c.getContext('2d')
    const img = x.createImageData(128, 128)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    x.putImageData(img, 0, 0)
    grainCache = c
  }
  return ctx.createPattern(grainCache, 'repeat')
}

// ================================================================ 壁の絵
// 建物の種類: office=横長の窓とガラス / apart=ベランダ付きの集合住宅 / tile=タイル張りの雑居ビル
const STYLES = ['office', 'apart', 'tile']
const WALLS = {
  office: ['#cfd3d6', '#b9c0c6', '#d9d6cf'],
  apart: ['#e3ddd0', '#d6d0c4', '#e8e4dc'],
  tile: ['#b9a58e', '#a8927a', '#c7b8a2', '#9aa3a6'],
}
const SHOPS = [
  { name: 'カフェ', bg: '#2f4a3a', fg: '#f3efe2' }, { name: 'くすり', bg: '#e8eef5', fg: '#1f4e9a' },
  { name: '不動産', bg: '#f2c230', fg: '#2a2a2a' }, { name: 'ラーメン', bg: '#b3261e', fg: '#fff4e0' },
  { name: 'クリーニング', bg: '#ffffff', fg: '#1b6b9e' }, { name: '歯科', bg: '#e9f4f1', fg: '#16725d' },
  { name: '書店', bg: '#3a3f4b', fg: '#f5d77a' }, { name: '花', bg: '#f7e9ef', fg: '#a43c63' },
  { name: '理容', bg: '#ffffff', fg: '#c0272d' }, { name: 'コンビニ', bg: '#1c8a4d', fg: '#ffffff' },
]
// 1面ぶんの絵（色と、粗さ・金属感の2枚）
function facade(W, H, style, wall, r, shop, ppm = PPM, door = false) {
  const PPM_ = ppm
  const w = Math.round(W * PPM_), h = Math.round(H * PPM_)
  const c = canvas(w, h), x = c.getContext('2d')
  const o = canvas(w, h), y = o.getContext('2d') // 緑=粗さ 青=金属感
  const P = v => v * PPM_
  // 下地
  x.fillStyle = wall; x.fillRect(0, 0, w, h)
  y.fillStyle = 'rgb(0,235,0)'; y.fillRect(0, 0, w, h)
  if (style === 'tile') {
    // 小口タイル: 横長の目地
    x.strokeStyle = 'rgba(0,0,0,.10)'; x.lineWidth = 1
    for (let ty = 0; ty < h; ty += 3) { x.beginPath(); x.moveTo(0, ty + 0.5); x.lineTo(w, ty + 0.5); x.stroke() }
    for (let ty = 0; ty < h; ty += 3) for (let tx = (ty / 3) % 2 ? 0 : 4; tx < w; tx += 9) { x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(tx, ty, 1, 3) }
    for (let i = 0; i < w * h / 90; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.05})`; x.fillRect(Math.floor(r() * w / 9) * 9, Math.floor(r() * h / 3) * 3, 9, 3) }
  }
  x.globalAlpha = 0.06; x.fillStyle = grain(x); x.fillRect(0, 0, w, h); x.globalAlpha = 1

  const floors = H < 4.5 ? 1 : 1 + Math.max(1, Math.round((H - 3.6) / 3))
  const fh = floors === 1 ? H : (H - 3.6) / (floors - 1) // 2階から上の階の高さ
  const g1 = floors === 1 ? H : 3.6                         // 1階の高さ
  const hasShop = !!shop
  const baseOf = f => f === 0 ? 0 : g1 + (f - 1) * fh  // その階の床の高さ
  const hOf = f => f === 0 ? g1 : fh
  // 階の境目の帯
  for (let f = 1; f < floors; f++) {
    const fy = h - P(baseOf(f))
    x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(0, fy - P(0.1), w, P(0.1))
    x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(0, fy, w, P(0.06))
  }
  // 窓1枚
  const glass = (gx, gy, gw, gh, kind) => {
    // 枠の影（窓は壁より奥にある）
    x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(gx - 2, gy - 3, gw + 4, gh + 4)
    const g = x.createLinearGradient(0, gy, 0, gy + gh)
    g.addColorStop(0, '#a9bccb'); g.addColorStop(0.45, '#6f8496'); g.addColorStop(1, '#3d4c5a')
    x.fillStyle = g; x.fillRect(gx, gy, gw, gh)
    // 空の映り込みの斜めの筋
    x.save(); x.beginPath(); x.rect(gx, gy, gw, gh); x.clip()
    x.fillStyle = 'rgba(255,255,255,.12)'
    x.beginPath(); x.moveTo(gx + gw * 0.15, gy); x.lineTo(gx + gw * 0.45, gy); x.lineTo(gx + gw * 0.1, gy + gh); x.lineTo(gx - gw * 0.2, gy + gh); x.fill()
    // 中の様子
    if (kind === 'curtain') { x.fillStyle = r() < 0.5 ? 'rgba(236,226,206,.85)' : 'rgba(214,224,230,.8)'; const cw = gw * (0.3 + r() * 0.4); x.fillRect(r() < 0.5 ? gx : gx + gw - cw, gy, cw, gh) }
    if (kind === 'blind') { x.fillStyle = 'rgba(230,232,232,.8)'; const bh = gh * (0.3 + r() * 0.6); for (let by = gy; by < gy + bh; by += 3) x.fillRect(gx, by, gw, 2) }
    if (kind === 'dark') { x.fillStyle = 'rgba(25,32,40,.55)'; x.fillRect(gx, gy, gw, gh) }
    if (kind === 'lit') { x.fillStyle = 'rgba(255,226,170,.55)'; x.fillRect(gx, gy, gw, gh) }
    x.restore()
    // アルミの枠と中桟
    x.strokeStyle = '#c9ced3'; x.lineWidth = 2; x.strokeRect(gx + 1, gy + 1, gw - 2, gh - 2)
    x.fillStyle = '#c9ced3'; x.fillRect(gx + gw / 2 - 1, gy, 2, gh)
    // 窓台と、その下の雨だれ
    x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(gx - 3, gy + gh, gw + 6, 2)
    x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(gx - 3, gy + gh + 2, gw + 6, 2)
    for (let i = 0; i < 2; i++) {
      const sx = gx + (i ? gw - 4 - r() * 6 : 2 + r() * 6), sl = P(0.4 + r() * 0.9)
      const sg = x.createLinearGradient(0, gy + gh, 0, gy + gh + sl)
      sg.addColorStop(0, 'rgba(40,40,40,.16)'); sg.addColorStop(1, 'rgba(40,40,40,0)')
      x.fillStyle = sg; x.fillRect(sx, gy + gh + 2, 3 + r() * 3, sl)
    }
    // 粗さ: ガラスはつるつる、枠は金属
    y.fillStyle = 'rgb(0,40,0)'; y.fillRect(gx, gy, gw, gh)
    y.strokeStyle = 'rgb(0,110,200)'; y.lineWidth = 2; y.strokeRect(gx + 1, gy + 1, gw - 2, gh - 2)
  }
  const pickKind = () => { const v = r(); return v < 0.28 ? 'curtain' : v < 0.48 ? 'blind' : v < 0.62 ? 'dark' : v < 0.66 ? 'lit' : 'clear' }
  for (let f = hasShop ? 1 : 0; f < floors; f++) {
    const base = h - P(baseOf(f))
    const fh = hOf(f)
    if (style === 'office') {
      // 横に連なる窓
      const n = Math.max(1, Math.round(W / 1.8)), bw = W / n
      for (let i = 0; i < n; i++) glass(P(i * bw + bw * 0.08), base - P(fh * 0.86), P(bw * 0.84), P(fh * 0.6), pickKind())
    } else if (style === 'apart') {
      // 掃き出し窓と、手前の手すり壁
      const n = Math.max(1, Math.round(W / 2.6)), bw = W / n
      for (let i = 0; i < n; i++) {
        glass(P(i * bw + bw * 0.12), base - P(fh * 0.82), P(bw * 0.76), P(fh * 0.72), pickKind())
        // ベランダの手すり壁（すりガラス風）と仕切り
        x.fillStyle = 'rgba(232,234,236,.92)'; x.fillRect(P(i * bw), base - P(1.0), P(bw), P(0.92))
        x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(P(i * bw), base - P(0.12), P(bw), P(0.12))
        x.fillStyle = 'rgba(0,0,0,.14)'; x.fillRect(P(i * bw), base - P(1.0), 2, P(0.92))
        // 室外機
        if (r() < 0.5) { x.fillStyle = '#eceeef'; x.fillRect(P(i * bw + bw * 0.62), base - P(0.62), P(0.7), P(0.5)); x.strokeStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.arc(P(i * bw + bw * 0.62 + 0.24), base - P(0.37), P(0.17), 0, 7); x.stroke() }
        y.fillStyle = 'rgb(0,200,0)'; y.fillRect(P(i * bw), base - P(1.0), P(bw), P(0.92))
      }
    } else {
      const n = Math.max(1, Math.round(W / 1.6)), bw = W / n
      for (let i = 0; i < n; i++) glass(P(i * bw + bw * 0.2), base - P(fh * 0.8), P(bw * 0.6), P(fh * 0.5), pickKind())
    }
  }
  if (hasShop) {
    // 1階の店: 暗いガラス面、扉、看板
    const sh = floors === 1 ? Math.min(H - 0.35, 3.2) : g1 - 0.1
    x.fillStyle = '#2a3038'; x.fillRect(P(0.15), h - P(sh * 0.82), w - P(0.3), P(sh * 0.82))
    const g = x.createLinearGradient(0, h - P(sh * 0.82), 0, h)
    g.addColorStop(0, 'rgba(160,180,195,.45)'); g.addColorStop(1, 'rgba(40,50,60,.1)')
    x.fillStyle = g; x.fillRect(P(0.15), h - P(sh * 0.82), w - P(0.3), P(sh * 0.82))
    // 店内の明かり
    x.fillStyle = 'rgba(255,236,200,.18)'; x.fillRect(P(0.15), h - P(sh * 0.5), w - P(0.3), P(sh * 0.5))
    for (let mx = P(0.15); mx < w - P(0.2); mx += P(1.2)) { x.fillStyle = '#9aa2aa'; x.fillRect(mx, h - P(sh * 0.82), 3, P(sh * 0.82)) }
    x.fillStyle = '#9aa2aa'; x.fillRect(P(0.15), h - P(sh * 0.82), w - P(0.3), 3)
    // 看板の帯
    const by = h - P(sh), bh = P(sh * 0.17)
    x.fillStyle = shop.bg; x.fillRect(P(0.1), by, w - P(0.2), bh)
    x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(P(0.1), by + bh - 3, w - P(0.2), 3)
    x.fillStyle = shop.fg; x.font = `900 ${Math.round(bh * 0.62)}px "Hiragino Sans","Noto Sans JP",sans-serif`
    x.textAlign = 'center'; x.textBaseline = 'middle'
    x.fillText(shop.name, w / 2, by + bh / 2 + 1)
    y.fillStyle = 'rgb(0,60,0)'; y.fillRect(P(0.15), h - P(sh * 0.82), w - P(0.3), P(sh * 0.82))
  } else if (H < 3.2) {
    // 平屋: 腰の高さまで化粧ブロック
    x.fillStyle = 'rgba(0,0,0,.06)'; x.fillRect(0, h - P(0.9), w, P(0.9))
  }
  // 出入口: 幅1.8m・高さ2.3mのガラスの両開き扉と庇。人の背丈（キャラ1.9m）と並べて建物の大きさが分かる目印
  if (door && !hasShop && W >= 6) {
    const dw = 1.8, dh = 2.3, dx = P(W / 2 - dw / 2)
    x.fillStyle = '#d9dcdf'; x.fillRect(dx - P(0.25), h - P(dh + 0.25), P(dw + 0.5), P(dh + 0.25)) // 枠まわりの石張り
    const g = x.createLinearGradient(0, h - P(dh), 0, h)
    g.addColorStop(0, '#58697a'); g.addColorStop(1, '#2b3540')
    x.fillStyle = g; x.fillRect(dx, h - P(dh), P(dw), P(dh))
    x.fillStyle = 'rgba(255,236,200,.22)'; x.fillRect(dx, h - P(dh * 0.6), P(dw), P(dh * 0.6)) // 中の明かり
    x.strokeStyle = '#b9c0c6'; x.lineWidth = 3; x.strokeRect(dx + 1.5, h - P(dh) + 1.5, P(dw) - 3, P(dh) - 1.5)
    x.fillStyle = '#b9c0c6'; x.fillRect(dx + P(dw / 2) - 1.5, h - P(dh), 3, P(dh))
    x.fillStyle = '#e6e8ea'; x.fillRect(dx + P(dw / 2) - P(0.12), h - P(1.2), 2, P(0.3)); x.fillRect(dx + P(dw / 2) + P(0.12) - 2, h - P(1.2), 2, P(0.3)) // 取っ手
    x.fillStyle = '#3a4048'; x.fillRect(dx - P(0.6), h - P(dh + 0.45), P(dw + 1.2), P(0.18)) // 庇
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(dx - P(0.6), h - P(dh + 0.27), P(dw + 1.2), 3)
    y.fillStyle = 'rgb(0,40,0)'; y.fillRect(dx, h - P(dh), P(dw), P(dh))
  }
  // 上から垂れた汚れ（屋上の縁から）
  for (let i = 0; i < W * 1.4; i++) {
    const sx = r() * w, sl = P(0.3 + r() * Math.min(2.5, H * 0.5))
    const sg = x.createLinearGradient(0, 0, 0, sl)
    sg.addColorStop(0, `rgba(50,50,45,${0.08 + r() * 0.1})`); sg.addColorStop(1, 'rgba(50,50,45,0)')
    x.fillStyle = sg; x.fillRect(sx, 0, 2 + r() * 8, sl)
  }
  // 足元の泥はね
  const bg = x.createLinearGradient(0, h - P(0.7), 0, h)
  bg.addColorStop(0, 'rgba(40,36,30,0)'); bg.addColorStop(1, 'rgba(40,36,30,.28)')
  x.fillStyle = bg; x.fillRect(0, h - P(0.7), w, P(0.7))
  // 屋上の笠木の影
  x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(0, 0, w, 3)
  return { map: texFrom(c), orm: texFrom(o, false) }
}

// 屋上: 防水シートの継ぎ目と、排水口のまわりの汚れ
function roofTex(W, D, r) {
  const w = Math.round(W * 24), h = Math.round(D * 24)
  const c = canvas(w, h), x = c.getContext('2d')
  x.fillStyle = '#8f9690'; x.fillRect(0, 0, w, h)
  x.globalAlpha = 0.12; x.fillStyle = grain(x); x.fillRect(0, 0, w, h); x.globalAlpha = 1
  x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 1
  for (let i = 24; i < w; i += 24) { x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, h); x.stroke() }
  for (let i = 0; i < 6; i++) {
    const g = x.createRadialGradient(r() * w, r() * h, 0, r() * w, r() * h, 20 + r() * 40)
    g.addColorStop(0, 'rgba(40,45,40,.25)'); g.addColorStop(1, 'rgba(40,45,40,0)')
    x.fillStyle = g; x.fillRect(0, 0, w, h)
  }
  return texFrom(c)
}

// ================================================================ 小物の部品（色は頂点色、絵が要る面だけアトラスを貼る）
const ATLAS = 512
function makeAtlas() {
  const c = canvas(ATLAS, ATLAS), x = c.getContext('2d')
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 32, 32)
  // 自販機の正面 (32,0)-(160,256)
  x.fillStyle = '#f2f4f5'; x.fillRect(32, 0, 128, 256)
  x.fillStyle = '#1d2733'; x.fillRect(40, 10, 112, 140)
  const cols = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#ffffff']
  for (let row = 0; row < 4; row++) for (let i = 0; i < 6; i++) {
    x.fillStyle = cols[(row * 3 + i * 5) % cols.length]
    x.fillRect(46 + i * 17, 18 + row * 33, 11, 22)
    x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(46 + i * 17, 18 + row * 33, 3, 22)
    x.fillStyle = '#e8e8e8'; x.fillRect(46 + i * 17, 42 + row * 33, 11, 4)
  }
  x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(40, 10, 112, 40)
  x.fillStyle = '#d0d4d8'; x.fillRect(46, 160, 100, 30)
  x.fillStyle = '#2b2f36'; x.fillRect(60, 210, 72, 30)
  x.fillStyle = '#c62828'; x.fillRect(32, 0, 128, 8)
  // 室外機の正面 (160,0)-(288,96)
  x.fillStyle = '#e9ebec'; x.fillRect(160, 0, 128, 96)
  x.fillStyle = '#5d6369'; x.beginPath(); x.arc(204, 48, 38, 0, 7); x.fill()
  x.strokeStyle = '#e9ebec'; x.lineWidth = 3
  for (let a = 0; a < 12; a++) { x.beginPath(); x.moveTo(204, 48); x.lineTo(204 + Math.cos(a / 12 * 6.28) * 38, 48 + Math.sin(a / 12 * 6.28) * 38); x.stroke() }
  for (let i = 0; i < 9; i++) { x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(250, 12 + i * 8, 30, 3) }
  // 袖看板 8種 (0,256)-(512,512): 64x256 ずつ
  SHOPS.slice(0, 8).forEach((sp, i) => {
    const sx = i * 64
    x.fillStyle = sp.bg; x.fillRect(sx, 256, 64, 256)
    x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 4; x.strokeRect(sx + 2, 258, 60, 252)
    x.fillStyle = sp.fg; x.font = '900 40px "Hiragino Sans","Noto Sans JP",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
    const chars = [...sp.name].slice(0, 5)
    chars.forEach((ch, k) => x.fillText(ch, sx + 32, 256 + 128 + (k - (chars.length - 1) / 2) * 46))
  })
  // 給水タンクのパネル (288,0)-(416,96)
  x.fillStyle = '#dfe6ea'; x.fillRect(288, 0, 128, 96)
  x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = 2
  for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(288 + i * 32, 0); x.lineTo(288 + i * 32, 96); x.stroke() }
  for (let i = 0; i <= 3; i++) { x.beginPath(); x.moveTo(288, i * 32); x.lineTo(416, i * 32); x.stroke() }
  // 遠景のビルの窓 (416,0)-(512,128): 色だけでなく窓の有無も
  x.fillStyle = '#ffffff'; x.fillRect(416, 0, 96, 128)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = '#7d8c99'; x.fillRect(420 + i * 23, 6 + j * 31, 15, 18) }
  // 屋上の防水シート (416,128)-(512,224)
  x.fillStyle = '#8f9690'; x.fillRect(416, 128, 96, 96)
  x.strokeStyle = 'rgba(0,0,0,.14)'; x.lineWidth = 1
  for (let i = 0; i < 96; i += 16) { x.beginPath(); x.moveTo(416 + i + 0.5, 128); x.lineTo(416 + i + 0.5, 224); x.stroke() }
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},.06)`; x.fillRect(416 + Math.random() * 96, 128 + Math.random() * 96, 2, 2) }
  return texFrom(c)
}
const R_ROOF = [418, 130, 510, 222]
const R_WHITE = [4, 4, 28, 28], R_VEND = [32, 0, 160, 256], R_AC = [160, 0, 288, 96], R_TANK = [288, 0, 416, 96]
const R_SIGN = i => [i * 64, 256, i * 64 + 64, 512]

// 箱を1つ作り、指定の面だけアトラスの領域を貼る。faces: { pz: 領域, nz: 領域 ... }
const FACE_INDEX = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 }
function setUV(geo, faceRegions) {
  const uv = geo.attributes.uv
  const toU = v => v / ATLAS, toV = v => 1 - v / ATLAS
  const cw = [(R_WHITE[0] + R_WHITE[2]) / 2, (R_WHITE[1] + R_WHITE[3]) / 2]
  // 既定は全部白
  for (let i = 0; i < uv.count; i++) uv.setXY(i, toU(cw[0]), toV(cw[1]))
  if (geo.groups.length) {
    for (const [face, reg] of Object.entries(faceRegions || {})) {
      const g = geo.groups[FACE_INDEX[face]]
      if (!g) continue
      const idx = geo.index.array
      const verts = new Set()
      for (let k = g.start; k < g.start + g.count; k++) verts.add(idx[k])
      const orig = geo.userData.uv0
      for (const vi of verts) {
        const u0 = orig[vi * 2], v0 = orig[vi * 2 + 1]
        uv.setXY(vi, toU(reg[0] + (reg[2] - reg[0]) * u0), toV(reg[3]) + (toV(reg[1]) - toV(reg[3])) * v0)
      }
    }
  }
  uv.needsUpdate = true
}
function box(w, h, d, color, faceRegions) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.userData.uv0 = g.attributes.uv.array.slice()
  setUV(g, faceRegions)
  return paint(g, color)
}
function cyl(rt, rb, h, seg, color) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); setUV(g); return paint(g, color) }
function sphere(r, color, detail = 0) { const g = new THREE.IcosahedronGeometry(r, detail); setUV(g); return paint(g, color) }
function paint(g, color) {
  const c = new THREE.Color(color)
  const n = g.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}
// 位置と向きを決めて部品の配列に入れる
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), Pv = new THREE.Vector3(), E = new THREE.Euler()
function put(list, geo, x, y, z, ry = 0, rx = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) { g.setAttribute('color', geo.attributes.color.clone().constructor === THREE.BufferAttribute ? g.attributes.color : g.attributes.color) }
  g.applyMatrix4(M.compose(Pv.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S))
  list.push(g)
}
function merged(list, mat, shadow = true) {
  if (!list.length) return null
  const g = mergeGeometries(list.map(x => { for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) x.deleteAttribute(k); return x }), false)
  const m = new THREE.Mesh(g, mat)
  m.castShadow = shadow; m.receiveShadow = true
  return m
}
// 壁の外向きの向き: 箱の +Z 面を外へ向ける回転
const FACE_ROT = { pz: 0, px: Math.PI / 2, nz: Math.PI, nx: -Math.PI / 2 }

// ================================================================ 本体
// ================================================================ 港の建物（コンテナ・倉庫・クレーン塔・低い遮蔽物）
const CONT_COLORS = ['#b8432f', '#2f6aa8', '#3f8a4a', '#d0882a', '#7d8790']
let contTex = null, wareTex = null, craneTex = null
function corrugated(w, h, base, ribs, ribW, shade) {
  const c = canvas(w, h), x = c.getContext('2d')
  x.fillStyle = base; x.fillRect(0, 0, w, h)
  for (let i = 0; i < w; i += ribs) { x.fillStyle = `rgba(0,0,0,${shade})`; x.fillRect(i, 0, ribW, h); x.fillStyle = `rgba(255,255,255,${shade * 0.6})`; x.fillRect(i + ribW, 0, 1, h) }
  x.globalAlpha = 0.1; x.fillStyle = grain(x); x.fillRect(0, 0, w, h); x.globalAlpha = 1
  return c
}
function industrialTextures() {
  if (contTex) return
  // コンテナ: 白地の波板（色は頂点色で掛ける）、上下に縁、さびの筋
  { const c = corrugated(256, 128, '#e9e9e9', 10, 4, 0.18), x = c.getContext('2d')
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 0, 256, 6); x.fillRect(0, 122, 256, 6)
    for (let i = 0; i < 14; i++) { const g = x.createLinearGradient(0, 0, 0, 60); g.addColorStop(0, 'rgba(120,60,30,.35)'); g.addColorStop(1, 'rgba(120,60,30,0)'); x.fillStyle = g; x.fillRect(Math.random() * 256, 6, 3, 40 + Math.random() * 40) }
    contTex = texFrom(c); contTex.wrapS = contTex.wrapT = THREE.RepeatWrapping }
  // 倉庫: 薄い青灰の波板、腰の帯
  { const c = corrugated(256, 256, '#b9c3c9', 12, 5, 0.14), x = c.getContext('2d')
    x.fillStyle = 'rgba(30,60,90,.35)'; x.fillRect(0, 200, 256, 56)
    wareTex = texFrom(c); wareTex.wrapS = wareTex.wrapT = THREE.RepeatWrapping }
  // クレーン塔: 黄色の鉄骨の格子
  { const c = canvas(128, 128), x = c.getContext('2d')
    x.fillStyle = '#2b2f34'; x.fillRect(0, 0, 128, 128)
    x.strokeStyle = '#e2b52a'; x.lineWidth = 10; x.strokeRect(5, 5, 118, 118)
    x.lineWidth = 7; x.beginPath(); x.moveTo(5, 5); x.lineTo(123, 123); x.moveTo(123, 5); x.lineTo(5, 123); x.stroke()
    craneTex = texFrom(c); craneTex.wrapS = craneTex.wrapT = THREE.RepeatWrapping }
}
function boxUV(w, h, d, uScale, vScale) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv
  for (let v = 0; v < uv.count; v++) {
    const f = Math.floor(v / 4), fw = f < 2 ? d : w, fh = f === 2 || f === 3 ? d : h
    uv.setXY(v, uv.getX(v) * fw / uScale, uv.getY(v) * fh / vScale)
  }
  return g
}
function industrial(scene, b, roofTile) {
  industrialTextures()
  const objs = [], mats = []
  const addMesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); objs.push(m); if (!mats.includes(mat)) mats.push(mat); return m }
  if (b.cont) {
    // 段ごとに色の違うコンテナを積む（扉の面は短い辺）
    // 1つの山を1つの形にまとめる（色は頂点ごと）。描く回数を山の数だけに抑える
    const lv = Math.round(b.h / 2.6), geos = []
    for (let i = 0; i < lv; i++) {
      const col = new THREE.Color(CONT_COLORS[(b.tint + i * 2 + Math.abs(Math.round(b.x * 3))) % CONT_COLORS.length])
      const g = boxUV(b.w - 0.04, 2.56, b.d - 0.04, 2.4, 2.6); g.translate(0, i * 2.6 + 1.28, 0)
      const c = new Float32Array(g.attributes.position.count * 3); for (let j = 0; j < c.length; j += 3) { c[j] = col.r; c[j + 1] = col.g; c[j + 2] = col.b }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); geos.push(g)
    }
    const mat = new THREE.MeshStandardMaterial({ map: contTex, vertexColors: true, roughness: 0.6, metalness: 0.35, transparent: true })
    addMesh(mergeGeometries(geos, false), mat, b.x, 0, b.z)
  } else if (b.car) {
    // 車: 車体・窓まわり・タイヤ
    const col = CONT_COLORS[b.tint] || '#7d8790'
    const body = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.5, transparent: true })
    const glass = new THREE.MeshStandardMaterial({ color: '#1c2633', roughness: 0.1, metalness: 0.6, transparent: true })
    const long = b.d > b.w
    addMesh(new THREE.BoxGeometry(b.w, 0.8, b.d), body, b.x, 0.55, b.z)
    addMesh(new THREE.BoxGeometry(long ? b.w * 0.9 : b.w * 0.55, 0.6, long ? b.d * 0.55 : b.d * 0.9), glass, b.x, 1.2, b.z)
    const tire = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.9, transparent: true })
    for (const [a, c] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addMesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12).rotateZ(long ? Math.PI / 2 : 0).rotateX(long ? 0 : Math.PI / 2), tire, b.x + a * (b.w / 2 - (long ? 0.1 : 0.9)), 0.33, b.z + c * (b.d / 2 - (long ? 0.9 : 0.1)))
  } else if (b.low) {
    const mat = new THREE.MeshStandardMaterial({ color: '#a39f97', roughness: 0.95, transparent: true })
    addMesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat, b.x, b.h / 2, b.z)
  } else if (b.ware) {
    const mat = new THREE.MeshStandardMaterial({ map: wareTex, roughness: 0.55, metalness: 0.4, transparent: true })
    addMesh(boxUV(b.w, b.h, b.d, 6, Math.max(6, b.h / 2)), mat, b.x, b.h / 2, b.z)
    // 長い面のシャッター（濃い灰の帯）と、屋上の防水シート
    const door = new THREE.MeshStandardMaterial({ color: '#4c545c', roughness: 0.7, metalness: 0.5, transparent: true })
    for (const sz of [1, -1]) for (let k = -1; k <= 1; k += 2) addMesh(new THREE.BoxGeometry(5, 4.5, 0.12), door, b.x + k * b.w / 4, 2.25, b.z + sz * (b.d / 2 + 0.06))
    const rg = new THREE.PlaneGeometry(b.w - 0.02, b.d - 0.02).rotateX(-Math.PI / 2), ruv = rg.attributes.uv
    for (let v = 0; v < ruv.count; v++) ruv.setXY(v, ruv.getX(v) * b.w / 6, ruv.getY(v) * b.d / 6)
    addMesh(rg, new THREE.MeshStandardMaterial({ map: roofTile, roughness: 0.95, transparent: true }), b.x, b.h + 0.012, b.z)
  } else if (b.crane) {
    const mat = new THREE.MeshStandardMaterial({ map: craneTex, roughness: 0.6, metalness: 0.5, transparent: true })
    addMesh(boxUV(b.w, b.h, b.d, 4.5, 4.5), mat, b.x, b.h / 2, b.z)
    // 上の腕（海の方へ張り出す。見た目だけで高すぎて届かない）
    const arm = new THREE.MeshStandardMaterial({ color: '#e2b52a', roughness: 0.6, metalness: 0.4, transparent: true })
    addMesh(new THREE.BoxGeometry(2.4, 2.4, 46), arm, b.x, b.h + 1.2, b.z - Math.sign(b.z) * 14)
    addMesh(new THREE.BoxGeometry(4, 3, 4), new THREE.MeshStandardMaterial({ color: '#d8dde2', roughness: 0.5, transparent: true }), b.x, b.h + 3.9, b.z)
  }
  return { b, id: b.id, objs, mats, fade: 1, mesh: objs[0], box: new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, 0, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, b.h, b.z + b.d / 2)) }
}

// ================================================================ ショッピングモール
// 外壁はガラス張り、中は白い壁とタイルの床。店先の上に看板、吹き抜けに手すり。中は日が届きにくいので床と壁を少し自発光させる
const MALL_SIGN = ['#e5484d', '#2f6bff', '#2fbf71', '#f0a020', '#8b5cf6', '#ec4899', '#0ea5e9', '#14b8a6']
function mallTile(kind) {
  const c = canvas(256, 256), x = c.getContext('2d')
  if (kind === 'ceil') {
    x.fillStyle = '#f3f2ee'; x.fillRect(0, 0, 256, 256)
    x.strokeStyle = 'rgba(0,0,0,.08)'; x.lineWidth = 2; for (let t = 0; t <= 256; t += 128) { x.beginPath(); x.moveTo(t, 0); x.lineTo(t, 256); x.stroke(); x.beginPath(); x.moveTo(0, t); x.lineTo(256, t); x.stroke() }
    x.fillStyle = '#fffbe8'; x.fillRect(40, 118, 176, 20) // 照明
  } else if (kind === 'floor') {
    x.fillStyle = '#e8e2d6'; x.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.06)'; x.fillRect(i * 64, j * 64, 64, 64) }
    x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 2; for (let t = 0; t <= 256; t += 64) { x.beginPath(); x.moveTo(t, 0); x.lineTo(t, 256); x.stroke(); x.beginPath(); x.moveTo(0, t); x.lineTo(256, t); x.stroke() }
  } else {
    // ガラスの外壁: 縦の方立と、階ごとの帯
    const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#a9c1d3'); g.addColorStop(1, '#6f8ba1')
    x.fillStyle = g; x.fillRect(0, 0, 256, 256)
    x.fillStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.moveTo(40, 0); x.lineTo(120, 0); x.lineTo(20, 256); x.lineTo(-60, 256); x.fill()
    x.fillStyle = '#d7dde2'; for (let t = 0; t <= 256; t += 64) x.fillRect(t - 3, 0, 6, 256)
    x.fillRect(0, 0, 256, 10); x.fillRect(0, 246, 256, 10)
  }
  const t = texFrom(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t
}
function buildMall(scene, G, buildings) {
  const floorTex = mallTile('floor'), glassTex = mallTile('glass')
  const lit = (o) => Object.assign(o, { emissiveIntensity: o.emissiveIntensity ?? 0.22 })
  const mats = {
    ext: new THREE.MeshStandardMaterial({ map: glassTex, roughness: 0.15, metalness: 0.55 }),
    wall: lit(new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.8, emissive: '#ffffff', emissiveIntensity: 0.12 })),
    floor: lit(new THREE.MeshStandardMaterial({ map: floorTex, color: '#c9b9a0', roughness: 0.35, metalness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.06 })),
    floor2: lit(new THREE.MeshStandardMaterial({ map: floorTex, color: '#a7b6c4', roughness: 0.35, metalness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.06 })),
    floor3: lit(new THREE.MeshStandardMaterial({ map: floorTex, color: '#b9c7a9', roughness: 0.35, metalness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.06 })),
    edge: new THREE.MeshStandardMaterial({ color: '#2b3039', roughness: 0.5, metalness: 0.3 }),
    nose: new THREE.MeshStandardMaterial({ color: '#e8b23a', roughness: 0.5 }),
    ad: new THREE.MeshStandardMaterial({ color: '#2b3039', roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.05 }),
    plant: new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: '#8f9690', roughness: 0.95 }),
    step: new THREE.MeshStandardMaterial({ color: '#cfc9bd', roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.08 }),
    rail: new THREE.MeshStandardMaterial({ color: '#cfe3ee', transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.3, depthWrite: false }),
    railTop: new THREE.MeshStandardMaterial({ color: '#9aa1a8', roughness: 0.3, metalness: 0.7 }),
    ceil: new THREE.MeshStandardMaterial({ map: mallTile('ceil'), color: '#8f949b', roughness: 0.9, emissive: '#fff4dd', emissiveIntensity: 0.12 }),
    counter: new THREE.MeshStandardMaterial({ color: '#b98a5c', roughness: 0.55, emissive: '#ffffff', emissiveIntensity: 0.06 }),
  }
  const boxUVw = (b, rep) => { const g = new THREE.BoxGeometry(b.w, b.h - (b.y0 || 0), b.d), uv = g.attributes.uv
    for (let v = 0; v < uv.count; v++) { const f = Math.floor(v / 4), fw = f < 2 ? b.d : b.w, fh = f === 2 || f === 3 ? b.d : b.h - (b.y0 || 0); uv.setXY(v, uv.getX(v) * fw / rep, uv.getY(v) * fh / rep) } return g }
  for (const b of SB) {
    if (!b.kind || b.kind[0] !== 'm') continue
    const y0 = b.y0 || 0, hh = b.h - y0
    let mesh
    if (b.kind === 'mwall') {
      if (b.ad) mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, hh, b.d), mats.ad)
      else if (b.sign) { mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, hh, b.d), new THREE.MeshStandardMaterial({ color: MALL_SIGN[b.shop % MALL_SIGN.length], roughness: 0.5, emissive: MALL_SIGN[b.shop % MALL_SIGN.length], emissiveIntensity: 0.35 })) }
      else mesh = new THREE.Mesh(b.ext ? boxUVw(b, 6) : new THREE.BoxGeometry(b.w, hh, b.d), b.ext ? mats.ext : mats.wall)
    } else if (b.kind === 'mfloor') mesh = new THREE.Mesh(boxUVw(b, 4), b.roof ? [mats.wall, mats.wall, mats.roof, mats.ceil, mats.wall, mats.wall] : [mats.edge, mats.edge, b.h < 10 ? mats.floor2 : mats.floor3, mats.ceil, mats.edge, mats.edge]) // 上面は床（階ごとに色）、下面は天井板、縁は濃い帯
    else if (b.kind === 'mstep') { mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, hh, b.d), mats.step); const nose = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.04, 0.12), mats.nose); nose.position.set(b.x, b.h + 0.02, b.z - Math.sign(b.z || 1) * 0); scene.add(nose) } // 段の先に色の帯
    else if (b.kind === 'mrail') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, hh, b.d), b.planter ? mats.plant : b.counter ? mats.counter : mats.rail)
      if (y0 && !b.counter) { const top = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.04, 0.06, b.d + 0.04), mats.railTop); top.position.set(b.x, b.h, b.z); scene.add(top) }
    }
    if (!mesh) continue
    mesh.position.set(b.x, y0 + hh / 2, b.z)
    mesh.castShadow = b.kind !== 'mrail'; mesh.receiveShadow = true
    scene.add(mesh)
    // カメラが壁や床を突き抜けないよう、当たりの箱だけ登録する（透かしはしない）
    if (b.kind !== 'mrail') buildings.push({ b, id: b.id, objs: [mesh], mats: [], fade: 1, mesh, box: new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y0, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, b.h, b.z + b.d / 2)) })
  }
  // 1階の中の明かり（吹き抜けの真上から）
  // 各階の天井の明かり（数を絞って、吹き抜けと東西の通路に）
  for (const fl of [0, 6.8, 13.6]) for (const lx of [-80, 0, 80]) { const lamp = new THREE.PointLight('#fff4e0', 28, 60, 1.6); lamp.position.set(lx, fl + 5.6, 0); scene.add(lamp) }
}

// いま描いているステージの建物・道路・公園（buildCity が決める）
let SB = [], SR = [], SP = [], STAGE = 'city'
export function buildCity(scene, G, stageKey = 'city') {
  const stg = G.STAGES[stageKey] || G.STAGES.city
  SB = stg.blocks; SR = stg.roads; SP = stg.parks; STAGE = stageKey
  const r = rng(20261007)
  const atlas = makeAtlas()
  const buildings = []
  const half = SB.length / 2
  const shared = [] // 点対称の相方と絵を共有する
  // 屋上の防水シート: 6m 角の絵を繰り返す（建物の大きさに合わせて引き伸ばさない）
  const roofTile = (() => { let n = 7; const rr = () => (n = (n * 16807) % 2147483647) / 2147483647; const t = roofTex(6, 6, rr); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t })()

  // 2階から上の絵: スタイルごとに3種類。1枚 = 幅6m（窓2区画）x 2階分(6m)。
  // 5階建ての壁を描いて中ほどの2階分を切り出す（屋上の汚れと足元の泥はねが入らない範囲）
  const tiles = {}
  for (const style of STYLES) tiles[style] = WALLS[style].slice(0, 3).map(wall => {
    const f = facade(6, 15.6, style, wall, r, null, 48)
    const crop = (img, srgb) => { const c = canvas(6 * 48, 6 * 48); c.getContext('2d').drawImage(img, 0, -3 * 48); const t = texFrom(c, srgb); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t }
    return { wall, map: crop(f.map.image, true), orm: crop(f.orm.image, false) }
  })
  // 道路に面した面（店や電柱を置く）: 面の外側 6m 以内に道路の端があるか
  const streetFace = (b, face) => {
    const out = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] }[face]
    const plane = out[0] ? b.x + out[0] * b.w / 2 : b.z + out[1] * b.d / 2
    return SR.some(rd => { const edge = rd.c - Math.sign(out[0] || out[1]) * rd.w / 2; const gap = (edge - plane) * (out[0] || out[1]); return gap > 0 && gap < 6 })
  }
  const PPM_G = 24
  const kindParts = {} // 屋上の物・足場の部品を、持ち主の建物ごとに分けて持つ（建物が崩れたら一緒に消す）
  const ledgeGlass = [] // ベランダの手すりのガラス（位置と大きさ）
  SB.forEach((b, i) => {
    const nestParts = b.kind ? (kindParts[b.parent] ||= []) : null
    // 狙撃場所の手すり壁と塔屋: 当たり判定のある壁。屋上の上だけ描く
    if (b.kind && b.kind[0] === 'm' && b.kind !== 'mirror') return // モールの部品は buildMall でまとめて描く
    if (b.kind === 'ledge') {
      // ベランダの足場: コンクリートの床板と、縁の低い立ち上がり（30cm）。裏は暗く
      const t = b.h - b.y0
      put(nestParts, box(b.w, t, b.d, '#c9c6bf'), b.x, b.y0 + t / 2, b.z)
      put(nestParts, box(b.w - 0.1, 0.03, b.d - 0.1, '#b4b1aa'), b.x, b.y0 - 0.015, b.z)
      const out = SB.find(p => !p.kind && Math.abs(b.x - p.x) <= p.w / 2 + b.w && Math.abs(b.z - p.z) <= p.d / 2 + b.d && b.h < p.h)
      if (out) {
        const ox = Math.abs(b.x - out.x) > out.w / 2 ? Math.sign(b.x - out.x) : 0, oz = ox ? 0 : Math.sign(b.z - out.z)
        // 手すり: 外側3辺に支柱と笠木（ガラス面は ledgeGlass にまとめて半透明で描く）
        const ex = ox ? b.x + ox * (b.w / 2 - 0.05) : null, ez = oz ? b.z + oz * (b.d / 2 - 0.05) : null
        const sides = ox ? [[ex, b.z, 0.06, b.d], [b.x, b.z - b.d / 2 + 0.05, b.w, 0.06], [b.x, b.z + b.d / 2 - 0.05, b.w, 0.06]]
                         : [[b.x, ez, b.w, 0.06], [b.x - b.w / 2 + 0.05, b.z, 0.06, b.d], [b.x + b.w / 2 - 0.05, b.z, 0.06, b.d]]
        for (const [sx, sz, sw, sd] of sides) {
          put(nestParts, box(sw + 0.04, 0.05, sd + 0.04, '#9aa1a8'), sx, b.h + 1.0, sz)
          ledgeGlass.push([sx, b.h + 0.5, sz, sw, sd])
        }
        // 足場ごとの窓の明かり（部屋の掃き出し窓）
        put(nestParts, box(ox ? 0.04 : Math.min(3, b.w - 1), 2.2, ox ? Math.min(3, b.d - 1) : 0.04, '#3e4c5a'), b.x - ox * (b.w / 2 - 0.02), b.h + 1.1, b.z - oz * (b.d / 2 - 0.02))
      }
      return
    }
    if (b.kind === 'tank') {
      const parent = SB.find(p => !p.kind && Math.abs(b.x - p.x) <= p.w / 2 && Math.abs(b.z - p.z) <= p.d / 2)
      const base = parent ? parent.h : 0
      for (const [lx, lz] of [[-0.6, -0.5], [0.6, -0.5], [-0.6, 0.5], [0.6, 0.5]]) put(nestParts, box(0.08, 0.6, 0.08, '#7b8086'), b.x + lx, base + 0.3, b.z + lz)
      put(nestParts, box(b.w, b.h - base - 0.6, b.d, '#dfe6ea', { pz: R_TANK, nz: R_TANK, px: R_TANK, nx: R_TANK }), b.x, (base + 0.6 + b.h) / 2, b.z)
      return
    }
    if (b.kind) {
      const parent = SB.find(p => !p.kind && Math.abs(b.x - p.x) <= p.w / 2 && Math.abs(b.z - p.z) <= p.d / 2)
      const base = parent ? parent.h : 0, hh = b.h - base
      if (b.kind === 'parapet') {
        put(nestParts, box(b.w, hh, b.d, '#cfccc4'), b.x, base + hh / 2, b.z)
        put(nestParts, box(b.w + 0.06, 0.06, b.d + 0.06, '#9ea4a9'), b.x, b.h + 0.03, b.z) // 笠木
      } else {
        put(nestParts, box(b.w, hh, b.d, '#bdbab2'), b.x, base + hh / 2, b.z)
        put(nestParts, box(b.w + 0.2, 0.12, b.d + 0.2, '#9ea4a9'), b.x, b.h + 0.06, b.z)
        // 出入口の扉（屋上の内側を向く）
        const sx = parent ? Math.sign(parent.x - b.x) || 1 : 1
        put(nestParts, box(0.04, 2.0, 0.9, '#5d6670'), b.x + sx * (b.w / 2 + 0.02), base + 1.0, b.z)
      }
      return
    }
    if (b.cont || b.low || b.ware || b.crane || b.car) { buildings.push(industrial(scene, b, roofTile)); return }
    const k = i % half
    const flip = i >= half
    if (!shared[k]) {
      const style = STYLES[(k * 7 + 3) % STYLES.length]
      const tile = tiles[style][k % 3]
      const faces = ['px', 'nx', 'pz', 'nz']
      // 道路に面した面に店（建物ごとに1面）。点対称の相方は面が反転するので、相方を基準に決める
      const fb = flip ? { ...b, x: -b.x, z: -b.z } : b
      const st = faces.filter(f => streetFace(fb, f))
      const shopFace = st.length && k % 5 !== 4 ? st[k % st.length] : null
      const shop = shopFace ? SHOPS[k % SHOPS.length] : null
      const g1 = b.h < 4.5 ? b.h : 3.6
      // 1階: 4面の絵を横に並べた1枚（+x, -x, +z, -z の順）
      const widths = [b.d, b.d, b.w, b.w]
      const total = widths.reduce((a, v) => a + v, 0)
      const gc = canvas(total * PPM_G, g1 * PPM_G), go = canvas(total * PPM_G, g1 * PPM_G)
      let ox = 0
      const doorFace = st.find(f => f !== shopFace) || faces[0]
      faces.forEach((f, fi) => {
        const fc = facade(widths[fi], g1, style, tile.wall, r, f === shopFace ? shop : null, PPM_G, f === doorFace && g1 >= 3)
        gc.getContext('2d').drawImage(fc.map.image, ox, 0); go.getContext('2d').drawImage(fc.orm.image, ox, 0)
        ox += widths[fi] * PPM_G
      })
      shared[k] = { style, tile, wall: tile.wall, g1, widths, total, gmap: texFrom(gc), gorm: texFrom(go, false), shop, shopFace }
    }
    const sh = shared[k]
    // 点対称の相方は +x と -x、+z と -z の絵が入れ替わる
    const order = flip ? [1, 0, 3, 2] : [0, 1, 2, 3]
    // 1階の箱: 側面それぞれに1階の絵の該当区間を貼る
    const gGeo = new THREE.BoxGeometry(b.w, sh.g1, b.d)
    {
      const uv = gGeo.attributes.uv
      const starts = []; let acc = 0; for (const w of sh.widths) { starts.push(acc); acc += w }
      const faceOf = [0, 1, -1, -1, 2, 3] // BoxGeometry の面順 → 絵の区間
      for (let v = 0; v < uv.count; v++) {
        const f = Math.floor(v / 4), seg = faceOf[f]
        if (seg < 0) { uv.setXY(v, 0.002, 0.5); continue }
        const sgi = order[seg]
        uv.setXY(v, (starts[sgi] + uv.getX(v) * sh.widths[sgi]) / sh.total, uv.getY(v))
      }
    }
    const gMat = new THREE.MeshStandardMaterial({ map: sh.gmap, roughnessMap: sh.gorm, metalnessMap: sh.gorm, roughness: 1, metalness: 1, transparent: true })
    const gMesh = new THREE.Mesh(gGeo, gMat)
    gMesh.position.set(b.x, sh.g1 / 2, b.z)
    gMesh.castShadow = true; gMesh.receiveShadow = true
    scene.add(gMesh)
    const objs = [gMesh]
    const mats = [gMat]
    // 2階から上の箱: 使い回しの絵を繰り返す。上下の面は絵の左下（壁の色）を指す
    const uh = b.h - sh.g1
    let uMesh = null
    if (uh > 0.5) {
      const uGeo = new THREE.BoxGeometry(b.w, uh, b.d)
      const uv = uGeo.attributes.uv
      for (let v = 0; v < uv.count; v++) {
        const f = Math.floor(v / 4)
        if (f === 2 || f === 3) { uv.setXY(v, 0.01, 0.01); continue }
        const fw = f < 2 ? b.d : b.w
        uv.setXY(v, uv.getX(v) * Math.max(1, Math.round(fw / 6)), uv.getY(v) * (uh / 6))
      }
      const uMat = new THREE.MeshStandardMaterial({ map: sh.tile.map, roughnessMap: sh.tile.orm, metalnessMap: sh.tile.orm, roughness: 1, metalness: 1, transparent: true })
      uMesh = new THREE.Mesh(uGeo, uMat)
      uMesh.position.set(b.x, sh.g1 + uh / 2, b.z)
      uMesh.castShadow = true; uMesh.receiveShadow = true
      scene.add(uMesh); objs.push(uMesh)
      mats.push(uMat)
    }
    const mesh = gMesh
    // 店のある面（点対称の相方は反対の面）
    const shopFaceHere = sh.shopFace && (flip ? { px: 'nx', nx: 'px', pz: 'nz', nz: 'pz' }[sh.shopFace] : sh.shopFace)

    // 建物に付く飾り（建物と一緒に透かすので建物ごとに1つにまとめる）
    const parts = []
    const wallC = new THREE.Color(sh.wall).multiplyScalar(0.92)
    {
      const rg = new THREE.PlaneGeometry(b.w - 0.02, b.d - 0.02).rotateX(-Math.PI / 2)
      const ruv = rg.attributes.uv
      for (let v = 0; v < ruv.count; v++) ruv.setXY(v, ruv.getX(v) * b.w / 6, ruv.getY(v) * b.d / 6)
      const rMat = new THREE.MeshStandardMaterial({ map: roofTile, roughness: 0.95, metalness: 0, transparent: true })
      const roof = new THREE.Mesh(rg, rMat)
      roof.position.set(b.x, b.h + 0.012, b.z); roof.receiveShadow = true
      scene.add(roof); mats.push(rMat); objs.push(roof)
    }
    // 屋上の手すり壁と笠木
    // 乗れる低い屋上は手すり壁を低くし、室外機などは置かない（すり抜けて見えるため）
    const tall = b.h >= 17 // 乗れない高さ（6階建て以上）だけ屋上に物を置く
    const nest = !!b.nest
    const pH = 0, pT = 0.16 // 屋上の縁（手すり壁）は付けない
    if (pH > 0) {
    put(parts, box(b.w, pH, pT, wallC), b.x, b.h + pH / 2, b.z + b.d / 2 - pT / 2)
    put(parts, box(b.w, pH, pT, wallC), b.x, b.h + pH / 2, b.z - b.d / 2 + pT / 2)
    put(parts, box(pT, pH, b.d - pT * 2, wallC), b.x + b.w / 2 - pT / 2, b.h + pH / 2, b.z)
    put(parts, box(pT, pH, b.d - pT * 2, wallC), b.x - b.w / 2 + pT / 2, b.h + pH / 2, b.z)
    put(parts, box(b.w + 0.04, 0.05, pT + 0.04, '#c5c9cc'), b.x, b.h + pH, b.z + b.d / 2 - pT / 2)
    put(parts, box(b.w + 0.04, 0.05, pT + 0.04, '#c5c9cc'), b.x, b.h + pH, b.z - b.d / 2 + pT / 2)
    put(parts, box(pT + 0.04, 0.05, b.d, '#c5c9cc'), b.x + b.w / 2 - pT / 2, b.h + pH, b.z)
    put(parts, box(pT + 0.04, 0.05, b.d, '#c5c9cc'), b.x - b.w / 2 + pT / 2, b.h + pH, b.z)
    }
    // 屋上の室外機（縁に寄せて並べる）
    const acN = tall ? Math.max(1, Math.floor(b.w / 2.4)) : 0
    for (let a = 0; a < acN; a++) {
      const ax = b.x - b.w / 2 + 0.9 + a * 1.0, az = b.z - b.d / 2 + 0.55
      if (ax > b.x + b.w / 2 - 0.6) break
      put(parts, box(0.8, 0.62, 0.32, '#e6e8e9', { pz: R_AC }), ax, b.h + 0.31, az)
    }
    // 背の高い建物には給水タンクとアンテナ
    if (tall) {
      const tx = b.x + b.w / 2 - 1.1, tz = b.z + b.d / 2 - 1.1
      // 給水タンクは当たり判定のある足場として game.js で置く（kind: 'tank'）
      put(parts, cyl(0.03, 0.03, 2.4, 6, '#6c7177'), b.x - b.w / 2 + 0.6, b.h + 1.2, b.z + b.d / 2 - 0.6)
      put(parts, box(1.0, 0.03, 0.03, '#6c7177'), b.x - b.w / 2 + 0.6, b.h + 2.0, b.z + b.d / 2 - 0.6)
      put(parts, box(0.7, 0.03, 0.03, '#6c7177'), b.x - b.w / 2 + 0.6, b.h + 2.25, b.z + b.d / 2 - 0.6)
    }
    // 壁の雨どい（角の近く、壁から10cmだけ出す）
    put(parts, cyl(0.055, 0.055, b.h, 8, '#9aa0a6'), b.x + b.w / 2 - 0.25, b.h / 2, b.z + b.d / 2 + 0.08)
    put(parts, cyl(0.055, 0.055, b.h, 8, '#9aa0a6'), b.x - b.w / 2 + 0.08, b.h / 2, b.z - b.d / 2 + 0.3)
    // 壁付けの室外機（2階以上の高さ）と電気メーター
    if (b.h >= 4.5) {
      const fx = b.x - b.w / 2 - 0.17
      put(parts, box(0.75, 0.55, 0.3, '#e6e8e9', { pz: R_AC }), fx, 3.4, b.z + 0.5, FACE_ROT.nx)
      put(parts, box(0.5, 0.06, 0.4, '#8d9399'), fx + 0.02, 3.1, b.z + 0.5, FACE_ROT.nx)
    }
    put(parts, box(0.28, 0.4, 0.14, '#b9bec3'), b.x + b.w / 2 + 0.07, 1.5, b.z - 0.6, FACE_ROT.px)
    // 袖看板（店のある面の端。歩く高さより上、2.6m から）
    if (sh.shop && shopFaceHere && b.h >= 4.5) {
      const si = SHOPS.indexOf(sh.shop) % 8
      const o = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] }[shopFaceHere]
      const sx = o[0] ? b.x + o[0] * (b.w / 2 + 0.35) : b.x + b.w / 2 - 0.5
      const sz = o[1] ? b.z + o[1] * (b.d / 2 + 0.35) : b.z + b.d / 2 - 0.5
      const ry = o[0] ? Math.PI / 2 : 0
      put(parts, box(0.1, 2.0, 0.55, '#ffffff', { px: R_SIGN(si), nx: R_SIGN(si) }), sx, 3.7, sz, ry)
      put(parts, box(0.05, 0.05, 0.7, '#6c7177'), sx, 4.75, sz, ry)
      put(parts, box(0.05, 0.05, 0.7, '#6c7177'), sx, 2.65, sz, ry)
    }
    const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, roughness: 0.75, metalness: 0.05, transparent: true })
    const detail = merged(parts, detailMat)
    scene.add(detail); objs.push(detail)
    // カメラ用の箱は屋上の手すり壁まで含める（手すり壁の中にカメラが入らないように）
    buildings.push({ b, id: b.id, objs, mats: [...mats, detailMat], fade: 1, mesh, box: new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, 0, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, b.h + pH, b.z + b.d / 2)) })
  })

  const kindMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, roughness: 0.85 })
  for (const [pid, parts] of Object.entries(kindParts)) {
    const m = merged(parts, kindMat)
    if (!m) continue
    scene.add(m)
    const bd = buildings.find(x => x.id === +pid)
    if (bd) bd.objs.push(m)
  }
  const glassParts = []
  for (const [x, y, z, w, d] of ledgeGlass) put(glassParts, box(Math.max(w, 0.02), 0.9, Math.max(d, 0.02), '#cfe3ee'), x, y, z)
  if (glassParts.length) scene.add(merged(glassParts, new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.2, depthWrite: false })))
  if (STAGE === 'mall') buildMall(scene, G, buildings)
  buildGround(scene, G)
  const perimeter = buildStreet(scene, G, atlas, r)
  buildSkyline(scene, atlas, r, G)
  return { buildings, perimeter }
}

// ================================================================ 路面
function buildGround(scene, G) {
  // 外側の広い地面（遠くまで続くアスファルト）
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial(STAGE === 'harbor' ? { color: '#3b5866', roughness: 0.25, metalness: 0.3 } : { color: '#6e7277', roughness: 1 })) // 港は外が海
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true
  scene.add(outer)

  // 戦える範囲＋外周10mずつを1枚に描く。スマホは画像を小さくする
  const touch = matchMedia('(pointer: coarse)').matches
  const PX = touch ? 2048 : 4096
  const S = G.MAP_HALF * 2 + 20, K = PX / S
  const c = canvas(PX, PX), x = c.getContext('2d')
  const X = v => (v + S / 2) * K, Z = v => (v + S / 2) * K, L = v => v * K
  const r = rng(77)
  const speck = (n, a0, a1, col) => { for (let i = 0; i < n; i++) { x.fillStyle = `rgba(${r() < 0.5 ? col[0] : col[1]},${a0 + r() * a1})`; x.fillRect(r() * PX, r() * PX, 1 + r() * 2, 1 + r() * 2) } }
  // 街区の中（敷地・路地）: 明るいコンクリート舗装
  x.fillStyle = '#a19e97'; x.fillRect(0, 0, PX, PX)
  x.globalAlpha = 0.12; x.fillStyle = grain(x); x.fillRect(0, 0, PX, PX); x.globalAlpha = 1
  // 舗装の目地（2m ごと）
  x.strokeStyle = 'rgba(0,0,0,.07)'; x.lineWidth = 1
  for (let t = -S / 2; t < S / 2; t += 2) { x.beginPath(); x.moveTo(X(t), 0); x.lineTo(X(t), PX); x.stroke(); x.beginPath(); x.moveTo(0, Z(t)); x.lineTo(PX, Z(t)); x.stroke() }
  // モール: 駐車場のアスファルトと白線、建物のまわりはタイルの歩道
  if (STAGE === 'mall') {
    const M = G.MALL
    x.fillStyle = '#5f6267'; x.fillRect(X(-G.MAP_HALF), Z(-G.MAP_HALF), L(G.MAP_HALF * 2), L(G.MAP_HALF * 2))
    x.globalAlpha = 0.14; x.fillStyle = grain(x); x.fillRect(0, 0, PX, PX); x.globalAlpha = 1
    x.strokeStyle = 'rgba(240,240,235,.75)'; x.lineWidth = L(0.15)
    for (const b of SB) if (b.car) { const long = b.d > b.w; const w = long ? 2.8 : 5.4, d = long ? 5.4 : 2.8; x.strokeRect(X(b.x - w / 2), Z(b.z - d / 2), L(w), L(d)) }
    x.fillStyle = '#b9b3a6'; x.fillRect(X(-M.x - 8), Z(-M.z - 8), L(M.x * 2 + 16), L(M.z * 2 + 16))
    x.fillStyle = 'rgba(0,0,0,.08)'; for (let t = -M.x - 8; t < M.x + 8; t += 2) x.fillRect(X(t), Z(-M.z - 8), 1, L(M.z * 2 + 16))
    x.fillStyle = '#cdbfa8'; x.fillRect(X(-M.x), Z(-M.z), L(M.x * 2), L(M.z * 2)) // 1階の床（暖色）
    x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 1; for (let t = -M.x; t < M.x; t += 4) { x.beginPath(); x.moveTo(X(t), Z(-M.z)); x.lineTo(X(t), Z(M.z)); x.stroke() } for (let t = -M.z; t < M.z; t += 4) { x.beginPath(); x.moveTo(X(-M.x), Z(t)); x.lineTo(X(M.x), Z(t)); x.stroke() }
    x.fillStyle = '#2b3039'; x.fillRect(X(-G.MALL.hole.x - 0.6), Z(-G.MALL.hole.z - 0.6), L(G.MALL.hole.x * 2 + 1.2), L(0.6)); x.fillRect(X(-G.MALL.hole.x - 0.6), Z(G.MALL.hole.z), L(G.MALL.hole.x * 2 + 1.2), L(0.6))
  }
  // 港: 暗いアスファルトのヤードに、黄色の区画線とコンテナ置き場の白線
  if (STAGE === 'harbor') {
    x.fillStyle = '#6a6c6f'; x.fillRect(X(-G.MAP_HALF), Z(-G.MAP_HALF), L(G.MAP_HALF * 2), L(G.MAP_HALF * 2))
    x.globalAlpha = 0.14; x.fillStyle = grain(x); x.fillRect(0, 0, PX, PX); x.globalAlpha = 1
    speck(PX * PX / 700, 0.06, 0.1, ['230,230,225', '20,20,20'])
    x.fillStyle = 'rgba(232,190,40,.75)'
    for (let t = -G.MAP_HALF + 10; t < G.MAP_HALF; t += 22) { x.fillRect(X(-G.MAP_HALF), Z(t), L(G.MAP_HALF * 2), L(0.3)); x.fillRect(X(t), Z(-G.MAP_HALF), L(0.3), L(G.MAP_HALF * 2)) }
    x.strokeStyle = 'rgba(240,240,235,.5)'; x.lineWidth = L(0.15)
    for (const b of SB) if (b.cont) x.strokeRect(X(b.x - b.w / 2 - 0.2), Z(b.z - b.d / 2 - 0.2), L(b.w + 0.4), L(b.d + 0.4))
    // 岸壁の縁（黄色と黒の縞）
    for (const zz of [-G.MAP_HALF + 1, G.MAP_HALF - 2]) for (let t = -G.MAP_HALF; t < G.MAP_HALF; t += 2) { x.fillStyle = (t / 2) % 2 ? '#e8be28' : '#222'; x.fillRect(X(t), Z(zz), L(2), L(1)) }
  }
  // 公園: 芝と砂利の小道
  for (const p of SP) {
    x.fillStyle = '#6f8d4c'; x.fillRect(X(p.x - p.w / 2), Z(p.z - p.d / 2), L(p.w), L(p.d))
    x.save(); x.beginPath(); x.rect(X(p.x - p.w / 2), Z(p.z - p.d / 2), L(p.w), L(p.d)); x.clip()
    for (let i = 0; i < p.w * p.d * 6; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '40,70,30' : '150,180,100'},.25)`; x.fillRect(X(p.x - p.w / 2 + r() * p.w), Z(p.z - p.d / 2 + r() * p.d), 2, 2) }
    x.fillStyle = '#c9bfa6'; x.fillRect(X(p.x - 1), Z(p.z - p.d / 2), L(2), L(p.d)); x.fillRect(X(p.x - p.w / 2), Z(p.z - 1), L(p.w), L(2))
    x.restore()
  }
  // 道路: アスファルト。外周（範囲の縁から3m）も道路にする
  const asphalt = (x0, z0, w, d) => { x.fillStyle = '#5c6066'; x.fillRect(X(x0), Z(z0), L(w), L(d)) }
  const E = G.MAP_HALF, ext = S / 2
  for (const rd of SR) { asphalt(-ext, rd.c - rd.w / 2, ext * 2, rd.w); asphalt(rd.c - rd.w / 2, -ext, rd.w, ext * 2) }
  asphalt(-ext, -E, ext * 2, 3); asphalt(-ext, E - 3, ext * 2, 3); asphalt(-E, -ext, 3, ext * 2); asphalt(E - 3, -ext, 3, ext * 2)
  // アスファルトの粒・補修跡・ひび（道路の部分だけに描く）
  x.save()
  x.beginPath()
  for (const rd of SR) { x.rect(X(-ext), Z(rd.c - rd.w / 2), L(ext * 2), L(rd.w)); x.rect(X(rd.c - rd.w / 2), Z(-ext), L(rd.w), L(ext * 2)) }
  x.rect(X(-ext), Z(-E), L(ext * 2), L(3)); x.rect(X(-ext), Z(E - 3), L(ext * 2), L(3)); x.rect(X(-E), Z(-ext), L(3), L(ext * 2)); x.rect(X(E - 3), Z(-ext), L(3), L(ext * 2))
  x.clip()
  x.globalAlpha = 0.16; x.fillStyle = grain(x); x.fillRect(0, 0, PX, PX); x.globalAlpha = 1
  speck(PX * PX / 900, 0.08, 0.1, ['230,230,225', '20,20,20'])
  for (let i = 0; i < 60; i++) { x.fillStyle = r() < 0.5 ? 'rgba(30,32,36,.25)' : 'rgba(150,152,150,.10)'; x.fillRect(r() * PX, r() * PX, L(1 + r() * 4), L(0.8 + r() * 3)) }
  x.strokeStyle = 'rgba(25,25,25,.35)'; x.lineWidth = 1.2
  for (let i = 0; i < 160; i++) { let px = r() * PX, pz = r() * PX; x.beginPath(); x.moveTo(px, pz); for (let k = 0; k < 6; k++) { px += (r() - 0.5) * L(1.5); pz += (r() - 0.5) * L(1.5); x.lineTo(px, pz) } x.stroke() }
  x.restore()
  // 歩道（道路の両側 1.5m）: タイルと縁石
  const walkway = (x0, z0, w, d) => {
    x.fillStyle = '#b4b1aa'; x.fillRect(X(x0), Z(z0), L(w), L(d))
    x.save(); x.beginPath(); x.rect(X(x0), Z(z0), L(w), L(d)); x.clip()
    x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 1
    for (let t = -ext; t < ext; t += 0.3) { x.beginPath(); x.moveTo(X(t), Z(z0)); x.lineTo(X(t), Z(z0 + d)); x.stroke(); x.beginPath(); x.moveTo(X(x0), Z(t)); x.lineTo(X(x0 + w), Z(t)); x.stroke() }
    x.restore()
  }
  const SW = G.SIDEWALK
  for (const rd of SR) {
    for (const sg of [-1, 1]) {
      const e = rd.c + sg * rd.w / 2, z0 = sg > 0 ? e : e - SW
      walkway(-ext, z0, ext * 2, SW); walkway(z0, -ext, SW, ext * 2)
    }
  }
  // 交差点は道路で上書きする（歩道を交差点に描かない）
  for (const a of SR) for (const b of SR) asphalt(a.c - a.w / 2, b.c - b.w / 2, a.w, b.w)
  // 縁石: 歩道と道路の境目の明るい線と影
  x.strokeStyle = '#d4d2cb'; x.lineWidth = L(0.15)
  for (const rd of SR) for (const sg of [-1, 1]) {
    const e = rd.c + sg * rd.w / 2
    for (const seg of [[-ext, SR[0].c - SR[0].w / 2], ...SR.slice(0, -1).map((q, i) => [q.c + q.w / 2, SR[i + 1].c - SR[i + 1].w / 2]), [SR[SR.length - 1].c + SR[SR.length - 1].w / 2, ext]]) {
      x.beginPath(); x.moveTo(X(seg[0]), Z(e)); x.lineTo(X(seg[1]), Z(e)); x.stroke()
      x.beginPath(); x.moveTo(X(e), Z(seg[0])); x.lineTo(X(e), Z(seg[1])); x.stroke()
    }
  }
  // 白線: 中央線（大通りは実線2本、路地は破線）、横断歩道、停止線
  x.save(); x.globalAlpha = 0.85; x.fillStyle = '#ebeae3'
  const isCross = (t, w0) => SR.some(q => Math.abs(t - q.c) < q.w / 2 + 4 + w0)
  for (const rd of SR) {
    for (let t = -ext; t < ext; t += 0.5) {
      if (isCross(t, 0)) continue
      if (rd.w > 8) { x.fillRect(X(t), Z(rd.c - 0.2), L(0.5), L(0.12)); x.fillRect(X(t), Z(rd.c + 0.08), L(0.5), L(0.12)); x.fillRect(X(rd.c - 0.2), Z(t), L(0.12), L(0.5)); x.fillRect(X(rd.c + 0.08), Z(t), L(0.12), L(0.5)) }
      else if (Math.floor(t / 2.5) % 2 === 0) { x.fillRect(X(t), Z(rd.c - 0.06), L(0.5), L(0.12)); x.fillRect(X(rd.c - 0.06), Z(t), L(0.12), L(0.5)) }
    }
    // 外側線
    for (const sg of [-1, 1]) { const e = rd.c + sg * (rd.w / 2 - 0.35); x.fillRect(X(-ext), Z(e - 0.05), L(ext * 2), L(0.1)); x.fillRect(X(e - 0.05), Z(-ext), L(0.1), L(ext * 2)) }
  }
  for (const a of SR) for (const b of SR) {
    // 交差点の4方向に横断歩道（縞は道路の向きに長い）と停止線
    for (const sg of [-1, 1]) {
      const zc = b.c + sg * (b.w / 2 + 1.6) // 南北の道路 a を横切る横断歩道
      for (let k = a.c - a.w / 2 + 0.3; k < a.c + a.w / 2 - 0.3; k += 0.9) x.fillRect(X(k), Z(zc - 1.2), L(0.45), L(2.4))
      x.fillRect(X(a.c - a.w / 2), Z(b.c + sg * (b.w / 2 + 3.3)) - L(0.15), L(a.w / 2), L(0.3))
      const xc = a.c + sg * (a.w / 2 + 1.6)
      for (let k = b.c - b.w / 2 + 0.3; k < b.c + b.w / 2 - 0.3; k += 0.9) x.fillRect(X(xc - 1.2), Z(k), L(2.4), L(0.45))
      x.fillRect(X(a.c + sg * (a.w / 2 + 3.3)) - L(0.15), Z(b.c - b.w / 2), L(0.3), L(b.w / 2))
    }
  }
  x.restore()
  // 建物の足元の陰
  for (const b of SB) {
    if (b.kind) continue
    x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = L(0.7); x.fillStyle = '#000'
    x.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), L(b.w), L(b.d)); x.restore()
  }
  // マンホール（道路の上にところどころ）
  for (const rd of SR) for (let t = -E + 8; t < E - 8; t += 17) {
    if (isCross(t, 2)) continue
    for (const [mx, mz] of [[t, rd.c + rd.w * 0.22], [rd.c - rd.w * 0.22, t]]) {
      x.fillStyle = '#4b4e52'; x.beginPath(); x.arc(X(mx), Z(mz), L(0.32), 0, 7); x.fill()
      x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 2; x.stroke()
    }
  }
  // 戦える範囲の外は歩道
  x.fillStyle = '#a3a19b'
  const O = E + 0.3
  x.fillRect(0, 0, PX, Z(-O)); x.fillRect(0, Z(O), PX, PX - Z(O)); x.fillRect(0, 0, X(-O), PX); x.fillRect(X(O), 0, PX - X(O), PX)

  const tex = texFrom(c)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
}

// ================================================================ 街の小物・外周
function buildStreet(scene, G, atlas, r) {
  const parts = []
  const B = SB
  // 電柱: 道路に面した壁の外 20cm（人の通れない隙間）に立てる。点対称に置く
  const poles = []
  const addPole = (x, z, tr, ry) => {
    put(parts, cyl(0.12, 0.16, 9, 10, '#a3a29d'), x, 4.5, z)
    put(parts, box(1.5, 0.1, 0.1, '#6d7074'), x, 8.1, z, ry)
    put(parts, box(1.1, 0.08, 0.08, '#6d7074'), x, 7.4, z, ry)
    for (const o of [-0.65, 0, 0.65]) put(parts, cyl(0.04, 0.05, 0.16, 6, '#e8e6e0'), x + Math.cos(ry) * o, 8.22, z - Math.sin(ry) * o)
    if (tr) put(parts, cyl(0.28, 0.28, 0.9, 10, '#8f9497'), x + Math.cos(ry) * 0.35, 6.4, z - Math.sin(ry) * 0.35)
    put(parts, box(0.04, 0.5, 0.2, '#1f4e9a'), x, 2.0, z, ry) // 住所の札
    for (let k = 0; k < 4; k++) put(parts, cyl(0.17, 0.17, 0.25, 10, k % 2 ? '#1b1b1b' : '#f2c230'), x, 0.25 + k * 0.25, z)
  }
  const half = B.length / 2
  const roadside = (b, face) => {
    const o = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] }[face]
    const plane = o[0] ? b.x + o[0] * b.w / 2 : b.z + o[1] * b.d / 2
    for (const rd of SR) { const edge = rd.c - Math.sign(o[0] || o[1]) * rd.w / 2; const gap = (edge - plane) * (o[0] || o[1]); if (gap > 0 && gap < 6) return rd }
    return null
  }
  for (let i = 0; i < half; i++) {
    const b = B[i]
    if (b.kind) continue
    for (const face of ['px', 'nx', 'pz', 'nz']) {
      const rd = roadside(b, face)
      if (!rd || r() < 0.45) continue
      const o = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] }[face]
      // 面の端寄りに1本（壁から 0.2m 外）
      const along = (r() < 0.5 ? -1 : 1) * ((o[0] ? b.d : b.w) / 2 - 0.6)
      const px = o[0] ? b.x + o[0] * (b.w / 2 + 0.2) : b.x + along
      const pz = o[1] ? b.z + o[1] * (b.d / 2 + 0.2) : b.z + along
      const ry = o[0] ? 0 : Math.PI / 2
      const tr = r() < 0.3
      for (const sg of [1, -1]) { addPole(px * sg, pz * sg, tr, ry); poles.push({ x: px * sg, z: pz * sg, rd: rd.c * sg, axis: o[0] ? 'z' : 'x', side: Math.sign(o[0] || o[1]) * sg }) }
      // 自販機: 店の無い道路側の面に、壁へ35cmだけ出して埋める
      if (r() < 0.35 && b.h >= 3.6) {
        const vx = o[0] ? b.x + o[0] * (b.w / 2 + 0.35 - 0.4) : b.x - along * 0.5
        const vz = o[1] ? b.z + o[1] * (b.d / 2 + 0.35 - 0.4) : b.z - along * 0.5
        for (const sg of [1, -1]) put(parts, box(0.95, 1.8, 0.8, '#f2f4f5', { pz: R_VEND }), vx * sg, 0.9, vz * sg, FACE_ROT[sg > 0 ? face : { px: 'nx', nx: 'px', pz: 'nz', nz: 'pz' }[face]])
      }
    }
  }
  // 電線: 同じ道路の同じ側にある柱を、近い順に結ぶ（たるみ付き）
  const wire = []
  const sag = (a, b, h0, h1, n = 12) => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n
      const p = t => [a[0] + (b[0] - a[0]) * t, h0 + (h1 - h0) * t - Math.sin(t * Math.PI) * Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.03, a[1] + (b[1] - a[1]) * t]
      wire.push(...p(t0), ...p(t1))
    }
  }
  const groups = {}
  for (const p of poles) { const key = p.axis + p.rd + ':' + p.side; (groups[key] = groups[key] || []).push(p) }
  for (const g of Object.values(groups)) {
    g.sort((a, b) => (a.axis === 'x' ? a.x - b.x : a.z - b.z))
    for (let i = 0; i < g.length - 1; i++) {
      const a = g[i], b = g[i + 1]
      if (Math.hypot(a.x - b.x, a.z - b.z) > 40) continue
      for (const h of [8.24, 7.45]) sag([a.x, a.z], [b.x, b.z], h, h)
    }
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3))
  scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#25282c' })))

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, roughness: 0.8, metalness: 0.05 })
  { const m = merged(parts, mat); if (m) scene.add(m) }
  parts.length = 0
  // 外周: 白いガードフェンス（戦える範囲の縁のすぐ外）。出撃直後などカメラが場外にあると手前を塞ぐので、
  // 外周だけ別にまとめて透かせるようにする
  const E = G.MAP_HALF + 0.35
  for (let t = -E; t <= E + 0.01; t += 2.5) {
    for (const [px, pz] of [[t, E], [t, -E], [E, t], [-E, t]]) put(parts, cyl(0.04, 0.04, 1.1, 6, '#d7dadd'), px, 0.55, pz)
  }
  for (const [y, h] of [[1.05, 0.06], [0.6, 0.05]]) {
    put(parts, box(E * 2, h, 0.05, '#e3e6e8'), 0, y, E); put(parts, box(E * 2, h, 0.05, '#e3e6e8'), 0, y, -E)
    put(parts, box(0.05, h, E * 2, '#e3e6e8'), E, y, 0); put(parts, box(0.05, h, E * 2, '#e3e6e8'), -E, y, 0)
  }
  // 外周の街灯と植え込み、街路樹
  const lamp = (x, z, ry) => {
    put(parts, cyl(0.06, 0.08, 6, 8, '#5b6066'), x, 3, z)
    put(parts, box(0.08, 0.08, 1.2, '#5b6066'), x, 6, z, ry)
    const ox = Math.sin(ry) * 1.1, oz = Math.cos(ry) * 1.1
    put(parts, box(0.3, 0.12, 0.5, '#e9ecef'), x + ox, 5.95, z + oz, ry)
  }
  const tree = (x, z, s) => {
    put(parts, cyl(0.12 * s, 0.16 * s, 2.2 * s, 7, '#5a4636'), x, 1.1 * s, z)
    const greens = ['#4f7a3c', '#5d8a45', '#466f36', '#6a9450']
    for (let k = 0; k < 4; k++) put(parts, sphere((0.9 + r() * 0.5) * s, greens[(((k + Math.floor(x)) % 4) + 4) % 4], 1), x + (r() - 0.5) * 1.1 * s, (2.6 + r() * 1.0) * s, z + (r() - 0.5) * 1.1 * s)
  }
  const hedge = (x, z, w, d) => put(parts, box(w, 0.8, d, '#4c6d3b'), x, 0.4, z)
  for (let t = -G.MAP_HALF + 5; t <= G.MAP_HALF - 5; t += 12) {
    lamp(t, E + 0.6, Math.PI); lamp(-t, -E - 0.6, 0); lamp(E + 0.6, t, -Math.PI / 2); lamp(-E - 0.6, -t, Math.PI / 2)
  }
  for (let t = -G.MAP_HALF + 2.5; t <= G.MAP_HALF - 2.5; t += 6) {
    for (const [px, pz] of [[t, E + 2.2], [t, -E - 2.2], [E + 2.2, t], [-E - 2.2, t]]) tree(px + (r() - 0.5), pz + (r() - 0.5), 0.9 + r() * 0.4)
  }
  hedge(0, E + 1.1, E * 2, 0.7); hedge(0, -E - 1.1, E * 2, 0.7); hedge(E + 1.1, 0, 0.7, E * 2); hedge(-E - 1.1, 0, 0.7, E * 2)

  const pmat = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, roughness: 0.8, metalness: 0.05, transparent: true })
  { const m = merged(parts, pmat); if (m) scene.add(m) }
  return pmat
}

// ================================================================ 遠景のビル
// 外壁は3種類。1区画（幅3m x 1階3.3m）の絵を、建物の大きさに合わせて繰り返して貼るので窓の大きさが実寸になる。
// 屋上の面は絵の左下（床の帯＝壁の色）を指すようにする
function skylineTile(kind) {
  const c = canvas(128, 128), x = c.getContext('2d')
  if (kind === 'glass') {
    const g = x.createLinearGradient(0, 0, 0, 128)
    g.addColorStop(0, '#9fb3c4'); g.addColorStop(1, '#5d7286')
    x.fillStyle = g; x.fillRect(0, 0, 128, 128)
    x.fillStyle = 'rgba(255,255,255,.10)'; x.fillRect(0, 0, 128, 40)
    x.fillStyle = '#d8dde2'; x.fillRect(0, 0, 4, 128); x.fillRect(62, 0, 3, 128)
    x.fillStyle = '#c3c9cf'; x.fillRect(0, 112, 128, 16)
  } else if (kind === 'band') {
    x.fillStyle = '#e6e6e2'; x.fillRect(0, 0, 128, 128)
    x.fillStyle = '#56687a'; x.fillRect(0, 30, 128, 52)
    x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(0, 30, 128, 14)
    x.fillStyle = '#cfd3d6'; for (let i = 0; i < 128; i += 32) x.fillRect(i, 30, 3, 52)
    x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(0, 82, 128, 4)
  } else {
    x.fillStyle = '#ece8df'; x.fillRect(0, 0, 128, 128)
    x.fillStyle = '#5f7182'; x.fillRect(14, 16, 100, 70)
    x.fillStyle = 'rgba(236,226,206,.8)'; x.fillRect(14, 16, 34, 70)
    x.fillStyle = '#f4f4f2'; x.fillRect(0, 74, 128, 40)
    x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(0, 110, 128, 4); x.fillRect(0, 74, 3, 40)
  }
  // 左下の数画素は壁の色（屋上の面がここを指す）
  x.fillStyle = kind === 'glass' ? '#c3c9cf' : kind === 'band' ? '#e6e6e2' : '#ece8df'
  x.fillRect(0, 120, 8, 8)
  const t = texFrom(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}
function skylineBox(w, h, d, tone) {
  const g = new THREE.BoxGeometry(w, h, d)
  const uv = g.attributes.uv
  for (let k = 0; k < uv.count; k++) {
    const face = Math.floor(k / 4)
    if (face === 2 || face === 3) { uv.setXY(k, 0.01, 0.01); continue }
    const fw = face < 2 ? d : w
    uv.setXY(k, uv.getX(k) * Math.max(1, Math.round(fw / 3)), uv.getY(k) * Math.max(1, Math.round(h / 3.3)))
  }
  return paint(g, tone)
}
function buildSkyline(scene, atlas, r, G) {
  const R0 = G.MAP_HALF + 17 // 一番手前の列
  const kinds = ['glass', 'band', 'resi']
  const lists = { glass: [], band: [], resi: [] }
  const plain = [] // 塔屋・タンク・アンテナ・電波塔
  const TONES = ['#ffffff', '#f1efe9', '#e4e9ee', '#ece4d8', '#dfe3e6']
  const n = 120
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + (r() - 0.5) * 0.05
    const ring = i % 3
    const d = ring === 0 ? R0 + r() * 10 : ring === 1 ? R0 + 15 + r() * 18 : R0 + 41 + r() * 40
    // 手前の列はところどころ空けて、奥の街と空が見えるようにする
    if (ring === 0 && r() < 0.35) continue
    const kind = kinds[(i * 7 + ring) % 3]
    // 遠いほど高いビルが多い（手前は低い街並み、奥に高層）
    const h = ring === 0 ? 7 + r() * 10 : kind === 'resi' ? 12 + r() * 22 : 16 + r() * (ring === 2 ? 60 : 34)
    const w = 7 + r() * 10, dd = 7 + r() * 10
    const x = Math.cos(a) * d, z = Math.sin(a) * d
    const ry = -a + (r() < 0.7 ? 0 : (r() - 0.5) * 0.6) // 大半は街の中心を向く
    const tone = TONES[i % TONES.length]
    put(lists[kind], skylineBox(w, h, dd, tone), x, h / 2, z, ry)
    // 段々のビル: 上に細い箱を重ねる
    if (h > 24 && r() < 0.45) {
      const h2 = h * (0.2 + r() * 0.3)
      put(lists[kind], skylineBox(w * 0.65, h2, dd * 0.65, tone), x, h + h2 / 2, z, ry)
      put(plain, box(1.2, 3, 1.2, '#9aa1a8'), x, h + h2 + 1.5, z, ry)
    } else {
      // 屋上の塔屋と給水タンク
      put(plain, box(w * 0.3, 2.6, dd * 0.3, '#a9afb5'), x + (r() - 0.5) * w * 0.3, h + 1.3, z + (r() - 0.5) * dd * 0.3, ry)
      if (r() < 0.5) put(plain, box(2, 1.5, 1.6, '#dfe6ea'), x + (r() - 0.5) * w * 0.4, h + 0.75, z + (r() - 0.5) * dd * 0.4, ry)
    }
    if (h > 40 && r() < 0.5) put(plain, cyl(0.15, 0.25, 8, 6, '#8a9096'), x, h + 4, z)
    // 屋上の縁の明るい笠木
    put(plain, box(w + 0.3, 0.3, dd + 0.3, '#cfd4d8'), x, h + 0.15, z, ry)
  }
  // 目印の電波塔（赤と白の帯）。遠くに1本
  {
    const tx = Math.cos(2.35) * (R0 + 100), tz = Math.sin(2.35) * (R0 + 100)
    for (let k = 0; k < 12; k++) {
      const y0 = k * 10, rb = 6 - k * 0.45, rt = 6 - (k + 1) * 0.45
      put(plain, cyl(Math.max(0.4, rt), Math.max(0.5, rb), 10, 8, k % 2 ? '#f2f2f0' : '#d8473a'), tx, y0 + 5, tz)
    }
    put(plain, cyl(4.5, 4.5, 4, 16, '#c9d0d6'), tx, 78, tz)
    put(plain, cyl(0.3, 0.6, 22, 6, '#d8473a'), tx, 131, tz)
  }
  for (const k of kinds) {
    const m = merged(lists[k], new THREE.MeshStandardMaterial({ vertexColors: true, map: skylineTile(k), roughness: k === 'glass' ? 0.35 : 0.9, metalness: k === 'glass' ? 0.3 : 0 }), false)
    if (m) { m.receiveShadow = false; scene.add(m) }
  }
  const pm = merged(plain, new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, roughness: 0.85 }), false)
  pm.receiveShadow = false
  scene.add(pm)
}
