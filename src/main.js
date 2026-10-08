// 描画・アニメーション・入力・HUD。ロジックは game.js。
// 時間で進むものは全部固定60Hzステップの中で進める（draw では状態を描くだけ）。
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { buildCity } from './city.js?v=202610080751'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import * as G from './game.js?v=202610080751'

const $ = id => document.getElementById(id)
const clamp01 = v => Math.max(0, Math.min(1, v))
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t) }
const TEAM_COLOR = ['#3d8bff', '#ff5a47']
const TEAM_LIGHT = ['#bfdcff', '#ffd3cc']

// ================================================================ 描画の土台
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.9
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.prepend(renderer.domElement)

const scene = new THREE.Scene()
const HORIZON = new THREE.Color('#cdd8e1')
scene.fog = new THREE.Fog(HORIZON, 60, 420) // 遠い街ほど空気で霞む
// 映り込み用の空: 上は青、地平は白っぽく、下は地面の灰色、太陽の方向が明るい。窓ガラスと金属に映る
{
  const env = new THREE.Scene()
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'varying vec3 vP; void main(){ vec3 sky = mix(vec3(0.80,0.85,0.90), vec3(0.36,0.55,0.78), smoothstep(0.0,0.6,vP.y)); vec3 gr = vec3(0.33,0.34,0.35); vec3 c = vP.y > 0. ? sky : mix(vec3(0.62,0.64,0.66), gr, smoothstep(0.,-0.3,vP.y)); float sun = pow(max(dot(vP, normalize(vec3(0.55,0.62,0.35))),0.),64.); gl_FragColor = vec4(c + sun*vec3(6.,5.5,4.8), 1.); }',
  })))
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(env, 0.02).texture
  scene.environmentIntensity = 0.6
}
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 700)

// 空: 上ほど濃い青、地平は霞んだ白。太陽のまわりが明るく、雲がゆっくり流れる
const SUN_DIR = new THREE.Vector3(22, 26, 14).normalize()
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color('#4f86c0') }, bottom: { value: HORIZON }, sunDir: { value: SUN_DIR }, time: { value: 0 }, overcast: { value: 0 } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: [
    'uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform float time; uniform float overcast; varying vec3 vP;',
    'float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }',
    'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a*vn(p); p = p*2.03 + 17.1; a *= .5; } return v; }',
    'void main(){',
    '  float h = smoothstep(-0.02, 0.6, vP.y);',
    '  vec3 c = mix(bottom, top, pow(h, 0.8));',
    '  float sd = max(dot(vP, sunDir), 0.);',
    '  c += vec3(1.0,0.92,0.78) * (pow(sd, 8.) * 0.25 + pow(sd, 300.) * 2.5) * (1. - overcast);',
    // 雲: 空を平面に投影して重ねる。地平に近いほど薄く小さく
    '  if (vP.y > 0.0) {',
    '    vec2 uv = vP.xz / (vP.y + 0.18) * 1.6 + vec2(time * 0.012, time * 0.004);',
    '    float n = fbm(uv);',
    '    float cl = smoothstep(0.52 - overcast * 0.5, 0.78 - overcast * 0.3, n) * smoothstep(0.0, 0.25, vP.y);',
    '    vec3 cc = mix(vec3(0.80,0.83,0.87), vec3(1.0), smoothstep(0.5, 0.9, n)) * (1. - overcast * 0.38) + vec3(0.12,0.1,0.06) * pow(sd, 6.) * (1. - overcast);',
    '    c = mix(c, cc, cl * 0.85);',
    '  }',
    '  gl_FragColor = vec4(c, 1.);',
    '#include <colorspace_fragment>',
    '}'].join('\n'),
})
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 48, 24), skyMat)
  sky.renderOrder = -1
  scene.add(sky)
}
const hemi = new THREE.HemisphereLight('#dfe9f5', '#5f6166', 0.55)
scene.add(hemi)
const sun = new THREE.DirectionalLight('#ffeedd', 2.6)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 260 })
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 0.03
scene.add(sun, sun.target)

// ================================================================ 市街地
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.anisotropy = 4
  return t
}
// 建物・路面・小物・外周・遠景は city.js。建物はカメラとの間に入ったら透かす
// ステージを変えたら街ごと作り直す（街はひとまとまりの Group に入れ、古い方は捨てる）
let stageKey = 'city'
try { if (G.STAGES[localStorage.getItem('ts-stage')]) stageKey = localStorage.getItem('ts-stage') } catch {}
let cityGroup = null, buildings = [], perimeter = null
function buildStage(k) {
  if (cityGroup) {
    scene.remove(cityGroup)
    const seen = new Set()
    cityGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose()
      for (const m of [].concat(o.material || [])) { if (seen.has(m)) continue; seen.add(m); for (const key of ['map', 'roughnessMap', 'metalnessMap']) if (m[key] && !seen.has(m[key])) { seen.add(m[key]); m[key].dispose() } m.dispose() }
    })
  }
  stageKey = G.STAGES[k] ? k : 'city'
  try { localStorage.setItem('ts-stage', stageKey) } catch {}
  cityGroup = new THREE.Group(); scene.add(cityGroup)
  const c = buildCity(cityGroup, G, stageKey)
  buildings = c.buildings; perimeter = c.perimeter
  for (const bd of buildings) bd.boxPad = bd.box.clone().expandByScalar(0.25)
}
buildStage(stageKey)

// ================================================================ 粒子
const FX_MAX = 600
const fxMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 }), FX_MAX)
fxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
fxMesh.frustumCulled = false
scene.add(fxMesh)
const fx = []
const fxDummy = new THREE.Object3D()
const fxColor = new THREE.Color()
function burst(x, y, z, n, color, speed = 6, size = 0.14, up = 3, gravity = 10, life = 0.5) {
  for (let i = 0; i < n; i++) {
    if (fx.length >= FX_MAX) fx.shift()
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7)
    fx.push({ x, y, z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: up * (Math.random() * 1.2 - 0.2), life, max: life, size: size * (0.6 + Math.random() * 0.8), color, g: gravity, rot: Math.random() * 6 })
  }
}
function stepFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]
    f.life -= dt
    if (f.life <= 0) { fx.splice(i, 1); continue }
    f.vy -= f.g * dt
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt
    if (f.y < 0.04 && f.vy < 0) { f.y = 0.04; f.vy *= -0.3; f.vx *= 0.6; f.vz *= 0.6 }
    f.rot += dt * 6
  }
}
function drawFx() {
  for (let i = 0; i < FX_MAX; i++) {
    const f = fx[i]
    if (!f) { fxDummy.scale.setScalar(0); fxDummy.updateMatrix(); fxMesh.setMatrixAt(i, fxDummy.matrix); continue }
    const k = f.life / f.max
    fxDummy.position.set(f.x, f.y, f.z)
    fxDummy.rotation.set(f.rot, f.rot * 0.7, 0)
    fxDummy.scale.setScalar(f.size * (0.25 + 0.75 * k))
    fxDummy.updateMatrix()
    fxMesh.setMatrixAt(i, fxDummy.matrix)
    fxMesh.setColorAt(i, fxColor.set(f.color))
  }
  fxMesh.instanceMatrix.needsUpdate = true
  if (fxMesh.instanceColor) fxMesh.instanceColor.needsUpdate = true
}

// 弾: 光る小さな立方体
const BULLET_MAX = 400
const bulletMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ toneMapped: false }), BULLET_MAX)
bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
bulletMesh.frustumCulled = false
scene.add(bulletMesh)
const bulletCol = [new THREE.Color('#e6f3ff').multiplyScalar(1.6), new THREE.Color('#ffe4dc').multiplyScalar(1.6)]
// 攻撃の色: 弾は種類ごと、狙撃は銃ごと、刃は武器ごと（隊の見分けは体の装甲と足元の輪でつける）
const AMMO_COL = { normal: '#fff1b8', homing: '#5ef0ff', blast: '#ff9a3c', curve: '#c58bff', weight: '#8f9bb0' }
const ammoCol = {}; for (const k in AMMO_COL) ammoCol[k] = new THREE.Color(AMMO_COL[k]).multiplyScalar(1.7)
const shellCol = new THREE.Color('#ff6a2a').multiplyScalar(1.8)
const SNIPE_COL = { snipe: '#ffd75e', lightning: '#7ff6ff', ibis: '#ff4f9a' }
const BLADE_COL = { blade: ['#e2f5ff', '#5fb6ff'], scorpion: ['#f0ffc8', '#9be000'] }

// 分裂前の立方体（撃った瞬間だけ光る）
const cubeFlashes = []
const cubeGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42)

// 狙撃の光線（撃った瞬間に出て、細くなって消える）と、ためている間の照準線
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0)
const beams = []
const UP = new THREE.Vector3(0, 1, 0)
function spawnBeam(x, y, z, hx, hy, hz, team, charge, thick = 1, col = null) {
  const from = new THREE.Vector3(x, y, z), dir = new THREE.Vector3(hx - x, hy - y, hz - z)
  const len = dir.length()
  if (len < 0.01) return
  dir.normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir)
  const mk = (r, color, op, add) => {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, toneMapped: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }))
    m.position.copy(from); m.quaternion.copy(q); m.scale.set(r, len, r)
    m.userData = { r, op }
    scene.add(m)
    return m
  }
  const w = (0.6 + 0.6 * charge) * thick
  beams.push({ t: 0, life: 0.45, parts: [mk(0.035 * w, new THREE.Color('#ffffff').multiplyScalar(1.5), 1, false), mk(0.14 * w, col || TEAM_COLOR[team], 0.6, true)] })
}
function stepBeams(dt) {
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i]
    b.t += dt
    const k = 1 - b.t / b.life
    for (const m of b.parts) { m.material.opacity = m.userData.op * Math.max(0, k); m.scale.x = m.scale.z = m.userData.r * (0.3 + 0.7 * k) }
    if (b.t >= b.life) { for (const m of b.parts) { scene.remove(m); m.material.dispose() } beams.splice(i, 1) }
  }
}
const aimLines = []
function drawAimLines(st) {
  let n = 0
  for (const u of st.units) {
    // 線は敵のスナイパー（狙われている合図）と自分のぶんだけ出す
    if (!u.alive || u.role !== 'sniper' || u.snipeT < 0 || (u.team === 0 && !u.player)) continue
    const t = st.units[u.targetId]
    if (!t || !t.alive) continue
    let L = aimLines[n]
    if (!L) {
      L = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }))
      L.frustumCulled = false
      scene.add(L); aimLines[n] = L
    }
    const c = Math.min(1, u.snipeT / G.sniperSpec(u).charge)
    const p = L.geometry.attributes.position
    p.setXYZ(0, u.x + Math.sin(u.yaw) * 0.5, u.y + 1.55, u.z + Math.cos(u.yaw) * 0.5)
    p.setXYZ(1, t.x, t.y + 1.0, t.z)
    p.needsUpdate = true
    L.material.color.set(TEAM_COLOR[u.team])
    L.material.opacity = 0.15 + 0.6 * c
    L.visible = true
    n++
  }
  for (let i = n; i < aimLines.length; i++) aimLines[i].visible = false
}

// エアステップ
const padGeo = new THREE.BoxGeometry(1.3, 0.06, 0.9)
const padMeshes = []

// ================================================================ ユニット
const units = [] // 描画側の対応物
let robotGltf = null
// 頭身: 元のロボは頭が全身の3分の1ある。頭を外して小さなヘルメットに替え、体を BODY_K 倍に伸ばして身長1.9mに戻す
const BODY_K = 1.3
const WALK_NATURAL = 1.28 * BODY_K // ロボラッシュで実測した足が滑らない速さ（脚が長くなった分だけ速い）
const RUN_NATURAL = 2.51 * BODY_K
const OVERLAYS = ['Jump', 'Punch', 'Death', 'Dance', 'ThumbsUp', 'Wave', 'Yes', 'No']

async function loadRobot() {
  robotGltf = await new GLTFLoader().loadAsync('./models/RobotExpressive.glb?v=202610080751')
}

// 見た目（自機だけ）: ヘルメットの形・戦闘服の色・バイザーの光。装甲の色は隊の見分けなので変えない
const LOOK_HELMET = { std: '標準', mono: '一つ目', horn: '角' }
const LOOK_SUIT = { charcoal: ['チャコール', '#262c36'], white: ['ホワイト', '#c9ced6'], olive: ['オリーブ', '#3b4232'], navy: ['ネイビー', '#1d2a44'] }
const LOOK_GLOW = { team: ['隊の色', null], cyan: ['シアン', '#5ef0ff'], gold: ['ゴールド', '#ffd75e'], violet: ['バイオレット', '#c58bff'] }
let myLook = { helmet: 'std', suit: 'charcoal', glow: 'team' }
try { const l = JSON.parse(localStorage.getItem('ts-look') || 'null'); if (l && LOOK_HELMET[l.helmet] && LOOK_SUIT[l.suit] && LOOK_GLOW[l.glow]) myLook = l } catch {}
function makeUnitView(u) {
  const look = u.player ? myLook : { helmet: u.role === 'sniper' ? 'mono' : u.role === 'attacker' ? 'horn' : 'std', suit: 'charcoal', glow: 'team' }
  const model = SkeletonUtils.clone(robotGltf.scene)
  const mats = []
  model.traverse(o => {
    if (!o.isMesh) return
    o.castShadow = true
    o.frustumCulled = false
    // 塗装はつやのある樹脂、灰色の部品は金属、黒はゴム
    const src = o.material
    const m = new THREE.MeshPhysicalMaterial({ name: src.name, map: src.map, color: src.color.clone() })
    // 地は濃い色の戦闘服、隊の色は装甲だけに入れる
    if (m.name === 'Main') Object.assign(m, { roughness: 0.55, metalness: 0.25, clearcoat: 0.3, clearcoatRoughness: 0.5 }), m.color.set(u.player ? LOOK_SUIT[look.suit][1] : u.team === 0 ? '#262c36' : '#30282a')
    if (m.name === 'Grey') Object.assign(m, { roughness: 0.35, metalness: 0.7 }), m.color.set('#8d96a1')
    if (m.name === 'Black') Object.assign(m, { roughness: 0.65, metalness: 0.05 })
    m.userData.baseEmissive = m.emissive.clone()
    o.material = m
    mats.push(m)
    if (/^Head/.test(o.name)) o.visible = false // 元の大きな頭は使わない（ヘルメットを付ける）
  })
  const mixer = new THREE.AnimationMixer(model)
  const actions = {}
  for (const clip of robotGltf.animations) actions[clip.name] = mixer.clipAction(clip)
  actions.Idle.play(); mixer.update(0); model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model, true)
  const h = box.max.y - box.min.y
  model.scale.multiplyScalar(G.UNIT_H / h)
  model.position.y = -box.min.y * (G.UNIT_H / h)
  for (const name of ['Idle', 'Walking', 'Running']) { actions[name].play(); actions[name].setEffectiveWeight(name === 'Idle' ? 1 : 0) }
  for (const name of OVERLAYS) {
    if (!actions[name]) continue
    actions[name].setLoop(name === 'Dance' || name === 'Wave' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    actions[name].clampWhenFinished = true
  }
  const root = new THREE.Group(), tilt = new THREE.Group()
  root.add(tilt); tilt.add(model)
  scene.add(root)

  // 装備: 立ち姿勢のキャラ空間（正面 +Z、足元 y=0、身長1.9m）で位置を決めてから、その骨の子にする。
  // 骨はそれぞれ独自の倍率と向きを持つので、骨の行列の逆を掛けて打ち消す
  root.updateMatrixWorld(true)
  const boneOf = name => { let b = null; model.traverse(o => { if (o.isBone && o.name === name) b = o }); return b }
  const attach = (boneName, obj, pos, rot = [0, 0, 0]) => {
    const bone = boneOf(boneName)
    if (!bone) return obj
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1))
    bone.matrixWorld.clone().invert().multiply(m).decompose(obj.position, obj.quaternion, obj.scale)
    bone.add(obj)
    obj.traverse(c => { if (c.isMesh) { c.castShadow = true; c.frustumCulled = false } })
    return obj
  }
  const paintM = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(TEAM_COLOR[u.team]).multiplyScalar(0.8), roughness: 0.38, metalness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.25 })
  const metalM = new THREE.MeshStandardMaterial({ color: u.team === 0 ? '#d6dde6' : '#4a4f58', roughness: 0.32, metalness: 0.75 })
  const darkM = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.5, metalness: 0.4 })
  const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(LOOK_GLOW[look.glow][1] || TEAM_LIGHT[u.team]).multiplyScalar(1.4), toneMapped: false })
  mats.push(paintM, metalM, darkM)
  for (const mm of [paintM, metalM, darkM]) mm.userData.baseEmissive = mm.emissive.clone()
  const mesh = (geo, mat) => new THREE.Mesh(geo, mat)
  const grp = (...ms) => { const g = new THREE.Group(); for (const [m, x, y, z, rx = 0, ry = 0, rz = 0] of ms) { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m) } return g }
  // 胸の紋章（ENの残りで明るさが変わる）
  const core = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM_LIGHT[u.team]).multiplyScalar(1.5), toneMapped: false }))
  attach('Abdomen', grp([mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 6), metalM), 0, 0, -0.012], [core, 0, 0, 0.004]), [0, 0.93, 0.2], [Math.PI / 2, 0, 0])
  // ヘルメット: 濃い殻・横一文字のバイザー（隊の色に光る）・頭頂のとさか・頬当て。ここの座標は伸ばす前の体の寸法
  const suitM = new THREE.MeshPhysicalMaterial({ color: u.player ? new THREE.Color(LOOK_SUIT[look.suit][1]).multiplyScalar(1.12) : u.team === 0 ? '#2c333e' : '#382e30', roughness: 0.4, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 })
  const glassM = new THREE.MeshPhysicalMaterial({ color: '#0b0f15', roughness: 0.08, metalness: 0.6, clearcoat: 1 })
  mats.push(suitM, glassM); for (const mm of [suitM, glassM]) mm.userData.baseEmissive = mm.emissive.clone()
  {
    const shell = mesh(new THREE.SphereGeometry(0.135, 22, 16), suitM); shell.scale.set(1, 1.08, 1.12)
    // 標準: 横一文字のバイザー / 一つ目: 丸いレンズ1つ / 角: 横一文字＋額から2本の角
    const mono = look.helmet === 'mono', horn = look.helmet === 'horn'
    const visor = mono ? mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 18).rotateX(Math.PI / 2), glassM) : mesh(new THREE.BoxGeometry(0.24, 0.075, 0.08), glassM)
    const slit = mono ? mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 14).rotateX(Math.PI / 2), glowM) : mesh(new THREE.BoxGeometry(0.2, 0.014, 0.01), glowM)
    const crest = horn ? grp([mesh(new THREE.ConeGeometry(0.025, 0.2, 6), paintM), 0.07, 0.04, 0.02, -0.35, 0, -0.45], [mesh(new THREE.ConeGeometry(0.025, 0.2, 6), paintM), -0.07, 0.04, 0.02, -0.35, 0, 0.45]) : mesh(new THREE.BoxGeometry(0.035, 0.07, 0.2), paintM)
    const jawL = mesh(new THREE.BoxGeometry(0.05, 0.1, 0.13), metalM), jawR = jawL.clone()
    const chin = mesh(new THREE.BoxGeometry(0.15, 0.05, 0.06), metalM)
    attach('Head', grp([shell, 0, 0, 0], [visor, 0, 0.005, 0.115], [slit, 0, 0.005, mono ? 0.148 : 0.157], [crest, 0, 0.14, -0.01], [jawL, 0.12, -0.06, 0.03], [jawR, -0.12, -0.06, 0.03], [chin, 0, -0.11, 0.08],
      [mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.16, 5), darkM), 0.13, 0.11, -0.06, 0, 0, -0.35]), [0, 1.3, 0])
    // 首の覆い
    attach('Neck', mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.1, 12), darkM), [0, 1.17, -0.01])
  }
  // 腰のベルトと垂れ板（胴の下の台形を隠す）、背中の装甲板
  attach('Abdomen', grp([mesh(new THREE.BoxGeometry(0.5, 0.07, 0.4), metalM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03), glowM), 0, 0, 0.205],
    [mesh(new THREE.BoxGeometry(0.17, 0.16, 0.04), paintM), 0.14, -0.1, 0.19, -0.12, 0, 0], [mesh(new THREE.BoxGeometry(0.17, 0.16, 0.04), paintM), -0.14, -0.1, 0.19, -0.12, 0, 0],
    [mesh(new THREE.BoxGeometry(0.04, 0.16, 0.3), suitM), 0.25, -0.09, 0], [mesh(new THREE.BoxGeometry(0.04, 0.16, 0.3), suitM), -0.25, -0.09, 0]), [0, 0.74, 0])
  if (u.role === 'attacker') attach('Abdomen', grp([mesh(new THREE.BoxGeometry(0.4, 0.3, 0.06), suitM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.3, 0.02, 0.01), glowM), 0, 0.08, -0.035]), [0, 0.96, -0.19])
  // 胸当てと、腕・脚の装甲（隊の色）
  attach('Abdomen', grp([mesh(new THREE.BoxGeometry(0.44, 0.27, 0.07), paintM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.46, 0.03, 0.08), metalM), 0, -0.15, 0], [mesh(new THREE.BoxGeometry(0.3, 0.012, 0.01), glowM), 0, 0.1, 0.04]), [0, 0.97, 0.16])
  for (const [sx, bn] of [[1, 'L'], [-1, 'R']]) {
    attach('LowerArm' + bn, grp([mesh(new THREE.BoxGeometry(0.13, 0.2, 0.14), paintM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.135, 0.02, 0.145), metalM), 0, 0.09, 0]), [0.42 * sx, 0.66, 0.03])
    attach('UpperLeg' + bn, mesh(new THREE.BoxGeometry(0.17, 0.15, 0.07), metalM), [0.275 * sx, 0.53, 0.08])
    attach('LowerLeg' + bn, grp([mesh(new THREE.BoxGeometry(0.15, 0.27, 0.08), paintM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.02, 0.2, 0.01), glowM), 0, 0, 0.045]), [0.28 * sx, 0.23, 0.1])
  }
  {
    // 肩の装甲（角ばった板を外へ傾ける）
    for (const [sx, bn] of [[1, 'ShoulderL'], [-1, 'ShoulderR']]) attach(bn, grp([mesh(new THREE.BoxGeometry(0.24, 0.07, 0.3), paintM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.25, 0.025, 0.31), metalM), 0, -0.045, 0], [mesh(new THREE.BoxGeometry(0.02, 0.02, 0.26), glowM), 0.08 * sx, 0.04, 0]), [0.31 * sx, 1.12, 0], [0, 0, -0.4 * sx])
  }
  if (u.role === 'attacker') {
    // 背中の予備の刃（斜めに背負う）
    attach('Abdomen', grp([mesh(new THREE.BoxGeometry(0.07, 0.72, 0.1), darkM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.03, 0.6, 0.04), glowM), 0, 0.02, -0.04]), [0.05, 0.95, -0.24], [0, 0, 0.55])
  }
  if (u.role === 'allround') {
    // 背中の弾倉: スプリッターの立方体が2つ光る
    attach('Abdomen', grp([mesh(new THREE.BoxGeometry(0.34, 0.3, 0.14), suitM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.36, 0.04, 0.15), paintM), 0, 0.1, 0],
      [mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), glowM), 0.1, -0.09, -0.07], [mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), glowM), 0.03, -0.09, -0.07], [mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), glowM), -0.04, -0.09, -0.07]), [0, 0.96, -0.22])
  }
  if (u.role === 'sniper') {
    // ヘルメットの片目スコープと、長いアンテナ付きの背嚢
    attach('Head', grp([mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.08, 12), darkM), 0, 0, 0], [mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 12), glowM), 0, 0.042, 0]), [-0.07, 1.31, 0.16], [Math.PI / 2, 0, 0])
    attach('Abdomen', grp([mesh(new THREE.BoxGeometry(0.32, 0.36, 0.16), darkM), 0, 0, 0], [mesh(new THREE.BoxGeometry(0.3, 0.04, 0.17), paintM), 0, 0.1, 0], [mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.75, 5), darkM), 0.1, 0.5, 0], [mesh(new THREE.SphereGeometry(0.025, 6, 5), glowM), 0.1, 0.88, 0]), [0, 0.95, -0.24])
  }

  // ステルスマント（マント）: 肩から背中へ垂れる布とフード。着ている間だけ出す
  const capeM = new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.85, side: THREE.DoubleSide })
  const trimM = new THREE.MeshBasicMaterial({ color: TEAM_COLOR[u.team] })
  mats.push(capeM); capeM.userData.baseEmissive = capeM.emissive.clone()
  // 背中側だけの半円筒を、裾に向かって広げて垂らす（上が肩、下が膝の上）
  const clothGeo = new THREE.CylinderGeometry(0.27, 0.38, 0.85, 14, 1, true, Math.PI / 2, Math.PI)
  const hemGeo = new THREE.CylinderGeometry(0.385, 0.385, 0.05, 14, 1, true, Math.PI / 2, Math.PI)
  const collarGeo = new THREE.TorusGeometry(0.34, 0.05, 6, 16, Math.PI)
  const cape = attach('Abdomen', grp(
    [mesh(clothGeo, capeM), 0, -0.42, 0],
    [mesh(hemGeo, trimM), 0, -0.9, 0],
    [mesh(collarGeo, capeM), 0, 0.04, 0, Math.PI / 2, 0, Math.PI]), [0, 1.12, -0.02])
  cape.scale.z *= 0.8 // 骨の倍率を打ち消した値に掛ける（set で上書きすると打ち消しが消えて巨大になる）
  cape.visible = false

  // 足元の輪（隊の色）
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: TEAM_COLOR[u.team], transparent: true, opacity: u.player ? 0.95 : 0.6, depthWrite: false }))
  ring.position.y = 0.03
  root.add(ring)

  // ブレード: 右前腕の骨に付ける光の刃
  let blade = null
  const trig = u.trig || []
  if (u.melee) {
    let arm = null
    model.traverse(o => { if (o.isBone && (o.name === 'LowerArmR' || o.name === 'LowerArm.R')) arm = o }) // three は名前のドットを落とす
    const g = new THREE.Group()
    if (u.melee === 'scorpion') g.userData.short = true
    const bc = BLADE_COL[u.melee] || BLADE_COL.blade
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.5, 0.16), new THREE.MeshBasicMaterial({ color: new THREE.Color(bc[0]).multiplyScalar(1.4), toneMapped: false }))
    core.position.y = 0.75
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.3), new THREE.MeshBasicMaterial({ color: bc[1], transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    glow.position.y = 0.75
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.1), new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 0.5 }))
    hilt.position.y = -0.05
    g.add(core, glow, hilt)
    // 骨は独自の倍率を持っているので、実際のワールド倍率を測って打ち消し、刃をワールドで約1.3mにする
    if (arm) {
      model.updateMatrixWorld(true)
      const ws = arm.getWorldScale(new THREE.Vector3()).x
      g.scale.setScalar(1 / ws)
      // スティンガーは短く細い刃（腕から生える）
      if (u.melee === 'scorpion') g.scale.set(0.8 / ws, 0.55 / ws, 0.8 / ws)
      g.position.set(0, 0.42 / ws, 0)
      g.rotation.set(Math.PI / 2, 0, 0)
      arm.add(g)
    }
    blade = g
  }
  // 狙撃銃: 刃と同じく右前腕に沿わせる。銃口の光はために合わせて強くなる
  let rifle = null, muzzle = null
  if (u.sniper) {
    let arm = null
    const side = u.melee && !u.player ? 'L' : 'R' // CPU は近接も持つなら左腕。自機は持ち替えるので全部右腕
    model.traverse(o => { if (o.isBone && (o.name === 'LowerArm' + side || o.name === 'LowerArm.' + side)) arm = o })
    const g = new THREE.Group()
    const metal = new THREE.MeshStandardMaterial({ color: '#2b3039', roughness: 0.35, metalness: 0.7 })
    const trim = new THREE.MeshStandardMaterial({ color: u.team === 0 ? '#dfe5ec' : '#3e434c', roughness: 0.5, metalness: 0.2 })
    const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m }
    part(new THREE.BoxGeometry(0.13, 0.62, 0.17), trim, 0, 0.12, 0)                 // 機関部
    part(new THREE.BoxGeometry(0.1, 0.34, 0.2), metal, 0, -0.32, 0.02)              // 銃床
    part(new THREE.CylinderGeometry(0.032, 0.036, 1.05, 10), metal, 0, 0.95, 0)     // 銃身
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 12), metal, 0, 0.18, 0.13)    // スコープ
    part(new THREE.BoxGeometry(0.02, 0.86, 0.02), new THREE.MeshBasicMaterial({ color: TEAM_LIGHT[u.team], toneMapped: false }), 0.07, 0.55, 0)
    muzzle = part(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM_LIGHT[u.team]).multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 0, 1.5, 0)
    muzzle.castShadow = false
    if (arm) {
      model.updateMatrixWorld(true)
      const ws = arm.getWorldScale(new THREE.Vector3()).x
      g.scale.setScalar(1 / ws)
      g.position.set(0, 0.2 / ws, 0)
      g.rotation.set(Math.PI / 2, 0, 0)
      arm.add(g)
    }
    rifle = g
  }
  // 銃: 種類ごとに形を変える（ハンドガンは小さく、ライフルは長く、ショットガンは太く、グレネードは筒）
  let gunMesh = null
  if (u.gun) {
    let arm = null
    const side = (u.melee || u.sniper) && !u.player ? 'L' : 'R'
    model.traverse(o => { if (o.isBone && (o.name === 'LowerArm' + side || o.name === 'LowerArm.' + side)) arm = o })
    const g = new THREE.Group()
    const metal = new THREE.MeshStandardMaterial({ color: '#2b3039', roughness: 0.35, metalness: 0.7 })
    const trim = new THREE.MeshStandardMaterial({ color: u.team === 0 ? '#dfe5ec' : '#3e434c', roughness: 0.5, metalness: 0.2 })
    const lit = new THREE.MeshBasicMaterial({ color: TEAM_LIGHT[u.team], toneMapped: false })
    const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m }
    if (u.gun === 'handgun') { part(new THREE.BoxGeometry(0.1, 0.32, 0.14), trim, 0, 0.12, 0); part(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8), metal, 0, 0.36, 0.02) }
    else if (u.gun === 'rifle') { part(new THREE.BoxGeometry(0.12, 0.6, 0.16), trim, 0, 0.15, 0); part(new THREE.BoxGeometry(0.06, 0.16, 0.12), metal, 0, 0.1, -0.12); part(new THREE.CylinderGeometry(0.028, 0.03, 0.5, 8), metal, 0, 0.68, 0); part(new THREE.BoxGeometry(0.015, 0.5, 0.02), lit, 0.065, 0.2, 0) }
    else if (u.gun === 'shotgun') { part(new THREE.BoxGeometry(0.16, 0.55, 0.18), metal, 0, 0.15, 0); part(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 10), trim, 0, 0.6, 0.02); part(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 10), trim, 0, 0.6, -0.08) }
    else { part(new THREE.CylinderGeometry(0.11, 0.11, 0.8, 14), trim, 0, 0.3, 0); part(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 14), lit, 0, 0.7, 0); part(new THREE.BoxGeometry(0.08, 0.2, 0.12), metal, 0, -0.05, -0.1) }
    if (arm) {
      model.updateMatrixWorld(true)
      const ws = arm.getWorldScale(new THREE.Vector3()).x
      g.scale.setScalar(1.35 / ws); g.position.set(0, 0.2 / ws, 0); g.rotation.set(Math.PI / 2, 0, 0) // 後ろから見ても分かるよう一回り大きく
      arm.add(g)
    }
    gunMesh = g
  }

  // 斬撃の軌跡（扇の中心を正面 +Z に向ける）
  const slashGeo = new THREE.RingGeometry(0.8, 2.5, 28, 1, -Math.PI * 0.4, Math.PI * 0.8)
  slashGeo.rotateX(-Math.PI / 2)
  slashGeo.rotateY(-Math.PI / 2)
  const slash = new THREE.Mesh(slashGeo, new THREE.MeshBasicMaterial({ color: (BLADE_COL[u.melee] || BLADE_COL.blade)[1], transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }))
  slash.position.y = 1.05 * BODY_K
  root.add(slash)

  // 重り弾の重り: 黒い塊を体のあちこちに用意し、当たった数だけ見せる
  const weightM = new THREE.MeshStandardMaterial({ color: '#8e96a3', roughness: 0.3, metalness: 0.9, emissive: '#3d4452', emissiveIntensity: 0.6 }) // 鉛の灰色（暗い戦闘服と見分けがつく）
  const weightSpots = [['Abdomen', [0.12, 0.9, 0.2]], ['Abdomen', [-0.15, 0.82, 0.19]], ['Abdomen', [0.05, 1.0, -0.24]], ['ShoulderL', [0.32, 1.08, 0.05]], ['ShoulderR', [-0.32, 1.06, -0.04]],
    ['UpperLegL', [0.3, 0.5, 0.12]], ['UpperLegR', [-0.28, 0.46, 0.1]], ['LowerLegL', [0.29, 0.2, -0.1]], ['LowerLegR', [-0.3, 0.24, 0.12]], ['LowerArmL', [0.44, 0.7, 0.08]], ['LowerArmR', [-0.44, 0.66, -0.06]], ['Abdomen', [-0.1, 0.72, -0.22]]]
  const weightBlocks = weightSpots.map(([bn, pos], i) => { const m = attach(bn, mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), weightM), pos, [i * 0.7, i * 1.3, 0]); m.visible = false; return m })
  mats.push(weightM); weightM.userData.baseEmissive = weightM.emissive.clone()

  // 装備を付け終えてから体ごと伸ばす（骨に付けた装備も一緒に伸びる）
  model.scale.multiplyScalar(BODY_K); model.position.y *= BODY_K
  const v = { id: u.id, root, tilt, model, mixer, actions, mats, ring, blade, rifle, gunMesh, weightBlocks, muzzle, slash, core, cape,
    overlay: null, overlayW: 0, near: 1, lean: 0, prevVx: 0, prevVz: 0, land: 0, wasGrounded: true, leakAcc: 0, hidden: false }
  units[u.id] = v

  const tag = document.createElement('div')
  tag.className = 'tag t' + u.team
  tag.innerHTML = `<span>${u.name}</span><i><b></b></i>`
  $('tags').appendChild(tag)
  v.tag = tag
  v.tagBar = tag.querySelector('b')
  return v
}

function clearUnits() {
  for (const v of units) {
    if (!v) continue
    scene.remove(v.root)
    v.mats.forEach(m => m.dispose())
    v.tag.remove()
  }
  units.length = 0
}

function playOverlay(v, name, timeScale = 1, from = 0) {
  const a = v.actions[name]
  if (v.overlay && v.overlay !== a) v.overlay.stop()
  a.reset(); a.time = from; a.timeScale = timeScale; a.setEffectiveWeight(1); a.play()
  v.overlay = a
}

function stepUnitView(dt, u, v, frozen) {
  if (!u.alive) {
    if (!v.hidden) { v.root.visible = false; v.tag.hidden = true; v.hidden = true }
    return
  }
  if (v.hidden) { v.root.visible = true; v.hidden = false }
  // 重り弾の重り（当たった数だけ。12個まで）
  const wn = Math.min(v.weightBlocks.length, u.weights || 0)
  if (v.wn !== wn) { v.weightBlocks.forEach((m, i) => { m.visible = i < wn }); v.wn = wn }
  // 自機は、いま持っている武器だけを見せる（持ち替えで刃・銃・狙撃銃が入れ替わる）
  // 持ち替え: 持っていた武器が縮んで消え、新しい武器が回りながら大きく出てくる（0.25秒）
  if (u.player && state && !state.autoplay && weapons.length) {
    const cls = G.TRIGGER_CLASS[weapons[activeW]]
    const byCls = { melee: v.blade, gun: v.gunMesh, sniper: v.rifle }
    for (const m of [v.blade, v.gunMesh, v.rifle]) if (m && !m.userData.s0) m.userData.s0 = m.scale.clone()
    if (v.cls !== cls) {
      if (v.cls && byCls[v.cls]) v.outW = byCls[v.cls]
      v.cls = cls; v.swapT = v.cls0 === undefined ? 1 : 0; v.cls0 = cls
      const hand = byCls[cls]
      if (hand && v.swapT === 0) { const p = hand.getWorldPosition(tmpV); burst(p.x, p.y, p.z, 12, TEAM_LIGHT[u.team], 3, 0.08, 1, 0, 0.3) }
    }
    v.swapT = Math.min(1, (v.swapT ?? 1) + dt / 0.25)
    const k = v.swapT
    for (const [c, m] of Object.entries(byCls)) {
      if (!m) continue
      const s0 = m.userData.s0
      if (c === cls) {
        m.visible = true
        const pop = k < 1 ? Math.sin(k * Math.PI * 0.5) * (1 + 0.18 * Math.sin(k * Math.PI)) : 1 // 少し大きく出てから戻る
        m.scale.copy(s0).multiplyScalar(Math.max(0.01, pop))
        m.rotation.y = (1 - k) * Math.PI * 1.5
      } else if (m === v.outW && k < 0.5) {
        m.visible = true; m.scale.copy(s0).multiplyScalar(Math.max(0.01, 1 - k * 2))
      } else { m.visible = false; m.scale.copy(s0); m.rotation.y = 0 }
    }
  }
  // 再出撃直後の守られている間は点滅させる
  // ミラージュ中の敵は、体・武器・足元の輪・影まで全部見せない（PvP で完全に消える）
  const cloaked = u.cham && u.team !== 0 && !(u.revealT > 0) // 撃たれた・踏み出した瞬間だけゆらめいて見える
  // ミラージュ中は誰の目にも影を落とさない（地面の影で居場所が分からないように）
  if (v.shadowOff !== !!u.cham) { v.shadowOff = !!u.cham; v.root.traverse(o => { if (o.isMesh) { if (o.userData.cs === undefined) o.userData.cs = o.castShadow; o.castShadow = u.cham ? false : o.userData.cs } }) }
  v.root.visible = !cloaked && (!(u.shieldT > 0) || Math.floor(u.shieldT * 10) % 2 === 0)
  // 足音: 地面を走った距離が歩幅ぶんたまるたびに鳴らす（自機と近くの機体だけ）
  if (u.grounded && u.speed > 1 && mode === 'play' && !(u.cham && u.team !== 0)) {
    v.stepAcc = (v.stepAcc || 0) + u.speed * dt
    if (v.stepAcc > (u.speed > 4 ? 1.35 : 0.9)) {
      v.stepAcc = 0
      const k = vol(u.x, u.z)
      if (u.player || k > 0.6) { setAudioPos(u.x, u.z); SFX.step(u.player ? 1 : k * 0.6) }
    }
  }
  const A = v.actions
  const s = u.grounded ? u.speed : 0
  const wRun = smooth(2.2, 4.2, s)
  const wIdle = 1 - smooth(0.15, 1.2, s)
  const wWalk = Math.max(0, 1 - wRun - wIdle)
  A.Walking.timeScale = Math.max(0.5, s / WALK_NATURAL)
  A.Running.timeScale = Math.max(0.6, s / RUN_NATURAL)

  let want = null
  // タイトルと試合後は演出のアニメをそのまま流す
  const scripted = mode !== 'play'
  if (scripted) want = v.overlay
  else if (u.bladeT >= 0) want = A.Punch
  else if (!u.grounded) want = A.Jump
  else if (u.shootT >= 0 && u.shootT < 0.22) want = A.Yes // 撃つ瞬間に小さくうなずく
  if (!scripted) {
    if (want === A.Punch && v.overlay !== A.Punch) playOverlay(v, 'Punch', A.Punch.getClip().duration / (G.MELEE[u.melee] || G.MELEE.blade).time)
    else if (want === A.Jump && v.overlay !== A.Jump) playOverlay(v, 'Jump', 1.4, 0.12)
    else if (want === A.Yes && v.overlay !== A.Yes) playOverlay(v, 'Yes', 2.5, 0.2)
    else if (!want && v.overlay) v.overlay = null
  }
  const target = want ? (want === A.Yes ? 0.35 : 1) : 0
  v.overlayW += (target - v.overlayW) * Math.min(1, dt * (target ? 18 : 10))
  const loco = 1 - v.overlayW
  A.Idle.setEffectiveWeight(wIdle * loco)
  A.Walking.setEffectiveWeight(wWalk * loco)
  A.Running.setEffectiveWeight(wRun * loco)
  for (const name of OVERLAYS) {
    const a = A[name]
    if (!a) continue
    if (a === v.overlay) a.setEffectiveWeight(v.overlayW)
    else if (a.isRunning() || a.getEffectiveWeight() > 0) {
      const w = a.getEffectiveWeight() - dt * 10
      if (w <= 0) a.stop(); else a.setEffectiveWeight(w)
    }
  }
  if (!frozen) v.mixer.update(dt)

  v.root.position.set(u.x, u.y, u.z)
  v.root.rotation.y = u.yaw
  const ax = (u.vx - v.prevVx) / dt, az = (u.vz - v.prevVz) / dt
  v.prevVx = u.vx; v.prevVz = u.vz
  const fwdAcc = ax * Math.sin(u.yaw) + az * Math.cos(u.yaw)
  v.lean += (THREE.MathUtils.clamp(fwdAcc * 0.004 + u.speed * 0.012, -0.12, 0.16) - v.lean) * Math.min(1, dt * 8)
  if (u.grounded && !v.wasGrounded) v.land = 1
  v.wasGrounded = u.grounded
  v.land = Math.max(0, v.land - dt * 5)
  const sq = Math.sin(v.land * Math.PI) * 0.1
  v.tilt.rotation.x = v.lean
  if (u.hurtT >= 0) v.tilt.rotation.x -= Math.sin(clamp01(u.hurtT / 0.4) * Math.PI) * 0.3
  v.tilt.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6)
  const flash = u.hurtT >= 0 ? 1 - u.hurtT / 0.4 : 0
  for (const m of v.mats) m.emissive.copy(m.userData.baseEmissive).lerp(new THREE.Color('#ffffff'), flash * 0.6)

  // シールドの見た目: 耐久で濃さが変わる
  v.slash.material.opacity = Math.max(0, v.slash.material.opacity - dt * 5)
  if (v.cape) v.cape.visible = !!u.bag
  if (v.core) {
    const k = Math.max(0, u.en) / G.MAX_EN
    const blink = u.en < 30 ? (Math.sin(performance.now() / (60 + u.en * 4)) > 0 ? 1 : 0.35) : 1
    v.core.material.color.set(TEAM_LIGHT[u.team]).multiplyScalar((0.4 + 1.2 * k) * blink)
  }
  if (v.muzzle) {
    const c = u.snipeT >= 0 ? Math.min(1, u.snipeT / G.sniperSpec(u).charge) : 0
    v.muzzle.material.opacity = (c > 0 ? 0.35 + 0.65 * c : Math.max(0, v.muzzle.material.opacity - dt * 6)) * (v.near < 0.98 ? v.near * 0.5 : 1)
    v.muzzle.scale.setScalar(1 + c * 1.2 + (c >= 1 ? Math.sin(performance.now() / 40) * 0.25 : 0))
  }

  // 漏れ: 傷口から光の粒が立ちのぼる
  if (u.leak > 0) {
    v.leakAcc += dt * (4 + u.leak * 14)
    while (v.leakAcc >= 1) {
      v.leakAcc -= 1
      if (fx.length >= FX_MAX) fx.shift()
      fx.push({ x: u.x + (Math.random() - 0.5) * 0.5, y: u.y + 0.7 + Math.random() * 0.8, z: u.z + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 0.6, vy: 1.2 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 0.9, max: 0.9, size: 0.09, color: Math.random() < 0.6 ? '#3d9bff' : '#9fd4ff', g: -0.5, rot: 0 })
    }
  }
}

// 強制帰還: 光の柱が立ち、光の玉が自陣の空へ飛んでいく
const bailFx = []
// 強制帰還: 体にひびが走って光り、隊の色の装甲片になって弾け飛ぶ。足元に衝撃波、強い閃光、
// 中心の結晶が回りながら縮んで消える（光の柱で飛ばす演出にはしない）
const shardGeo = new THREE.BoxGeometry(1, 1, 1)
let slowmo = 0 // 自機が関わる強制帰還は一瞬だけ時間をゆっくりにする
function spawnBailout(x, y, z, team, big = false) {
  const col = new THREE.Color(TEAM_LIGHT[team])
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.3), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }))
  ring.position.set(x, y + 0.05, z)
  const wave = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }))
  wave.position.set(x, y + 0.08, z)
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.8), transparent: true, toneMapped: false }))
  orb.position.set(x, y + 1, z)
  const flash = new THREE.PointLight(col, 60, 22, 2)
  flash.position.set(x, y + 1.2, z)
  // 装甲片: 大小の板が回りながら飛んで落ちる（隊の色と黒）
  const shards = []
  const dark = new THREE.MeshStandardMaterial({ color: '#262c36', roughness: 0.5, metalness: 0.4 }), paint = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], emissive: col, emissiveIntensity: 0.6, roughness: 0.4 })
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(shardGeo, i % 3 ? paint : dark)
    const sz = 0.12 + Math.random() * 0.28
    m.scale.set(sz, sz * (0.3 + Math.random() * 0.5), sz * (0.6 + Math.random()))
    m.position.set(x + (Math.random() - 0.5) * 0.6, y + 0.4 + Math.random() * 1.4, z + (Math.random() - 0.5) * 0.6)
    const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6
    m.userData = { vx: Math.cos(a) * sp, vy: 4 + Math.random() * 6, vz: Math.sin(a) * sp, rx: (Math.random() - 0.5) * 18, ry: (Math.random() - 0.5) * 18 }
    m.castShadow = true
    shards.push(m)
  }
  scene.add(ring, wave, orb, flash, ...shards)
  bailFx.push({ ring, wave, orb, flash, shards, mats: [dark, paint], t: 0, x, y, z })
  burst(x, y + 1, z, 40, TEAM_LIGHT[team], 7, 0.16, 3, 6, 0.9)
  burst(x, y + 1, z, 24, '#ffffff', 5, 0.1, 2, 4, 0.45)
  if (big) slowmo = 0.45
}
function stepBailFx(dt) {
  for (let i = bailFx.length - 1; i >= 0; i--) {
    const b = bailFx[i]
    b.t += dt
    const open = smooth(0, 0.3, b.t), close = smooth(0.5, 1.2, b.t)
    const r = 0.2 + open * 2.4 * (1 - close)
    b.ring.scale.set(r, 1, r)
    b.ring.material.opacity = 0.95 * (1 - close)
    const w = 1 + b.t * 22 // 衝撃波は速く広がって消える
    b.wave.scale.set(w, 1, w); b.wave.material.opacity = Math.max(0, 0.8 * (1 - b.t / 0.6))
    b.orb.rotation.y += dt * 9
    b.orb.scale.setScalar(Math.max(0.01, (0.4 + open * 0.8) * (1 - close)))
    b.orb.position.y = b.y + 1 + open * 0.4
    b.flash.intensity = 60 * Math.max(0, 1 - b.t / 0.35)
    for (const m of b.shards) {
      const d = m.userData
      d.vy -= 18 * dt
      m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt
      if (m.position.y < 0.08) { m.position.y = 0.08; d.vy *= -0.3; d.vx *= 0.6; d.vz *= 0.6; d.rx *= 0.5; d.ry *= 0.5 }
      m.rotation.x += d.rx * dt; m.rotation.y += d.ry * dt
      if (b.t > 1.4) m.scale.multiplyScalar(0.9) // 最後は縮んで消える
    }
    if (b.t > 1.9) {
      scene.remove(b.ring, b.wave, b.orb, b.flash, ...b.shards)
      b.ring.material.dispose(); b.wave.material.dispose(); b.orb.material.dispose(); for (const m of b.mats) m.dispose()
      bailFx.splice(i, 1)
    }
  }
}

// ================================================================ 音（その場で合成）
// 出口: 音ごとの定位（左右）と距離のこもり → 素の音と街の残響へ → 圧縮 → スピーカー
let actx = null
let muted = false
try { muted = localStorage.getItem('ts-muted') === '1' } catch {}
let master = null, reverbIn = null, noiseBuf = null
const audioPos = { pan: 0, far: 0 } // 次に鳴らす音の位置（handleEvents が音源ごとに入れる）
function ensureAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return }
  try { actx = new (window.AudioContext || window.webkitAudioContext)() } catch { actx = null }
  if (!actx) return
  master = actx.createGain(); master.gain.value = muted ? 0 : 1
  const comp = actx.createDynamicsCompressor()
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2
  master.connect(comp).connect(actx.destination)
  // 街の残響: 建物に跳ね返る早い反射と、長く伸びる尾を作った応答で畳み込む
  const conv = actx.createConvolver()
  const len = Math.floor(actx.sampleRate * 2.4), ir = actx.createBuffer(2, len, actx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.6
    for (const t of [0.031, 0.047, 0.083, 0.12, 0.17]) { const j = Math.floor((t + ch * 0.006) * actx.sampleRate); d[j] += 0.7 * (1 - t * 3) } // 壁からの反射
  }
  conv.buffer = ir
  reverbIn = actx.createGain(); reverbIn.gain.value = 0.32
  reverbIn.connect(conv).connect(master)
  noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate)
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1 }
  startAmbient()
  setWeatherAudio(weather)
}
function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 1, actx.currentTime, 0.05) }
// 音源の位置から、左右の振り分けと遠さを決める（自機のいる所から見て、カメラの向きを正面に）
function setAudioPos(x, z) {
  const me = state && (state.units.find(u => u.player && u.alive) || followTarget(state))
  if (!me || x === undefined) { audioPos.pan = 0; audioPos.far = 0; return }
  const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz)
  if (d < 1) { audioPos.pan = 0; audioPos.far = 0; return }
  const rx = -Math.cos(camYaw), rz = Math.sin(camYaw) // カメラの右
  audioPos.pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * Math.min(1, d / 6) * 0.85
  audioPos.far = Math.min(1, d / 90)
}
// 1音ぶんの出口: 定位 → 遠いほど高音を削る → 素の音と残響へ（遠いほど残響が多い）
function voiceOut(wet = 0.25) {
  const p = actx.createStereoPanner ? actx.createStereoPanner() : null
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 18000 - audioPos.far * 15500
  const dry = actx.createGain(); dry.gain.value = 1 - audioPos.far * 0.35
  const send = actx.createGain(); send.gain.value = Math.min(1, wet + audioPos.far * 0.6)
  if (p) { p.pan.value = audioPos.pan; p.connect(lp) }
  lp.connect(dry).connect(master); lp.connect(send).connect(reverbIn)
  return p || lp
}
function tone(freq, dur, type = 'square', vol = 0.1, slideTo = null, delay = 0, wet = 0.2) {
  if (!actx || muted) return
  const t0 = actx.currentTime + delay
  const o = actx.createOscillator(), g = actx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006) // 立ち上がりを丸めてプチ音を消す
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(voiceOut(wet))
  o.start(t0); o.stop(t0 + dur + 0.02)
}
// 雑音の一打ち。freq から freqTo へ動く帯域で削る（風切り・爆発の尾など）
function noise(dur, vol = 0.2, freq = 1200, type = 'bandpass', delay = 0, freqTo = null, q = 1, wet = 0.25) {
  if (!actx || muted) return
  const t0 = actx.currentTime + delay
  const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain()
  src.buffer = noiseBuf
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t0)
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur * 0.2))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f).connect(g).connect(voiceOut(wet))
  src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.02)
}
// 遠くの音ほど小さく
function vol(x, z) {
  const me = state && (state.units.find(u => u.player && u.alive) || state.units[0])
  if (!me) return 1
  return Math.max(0.15, 1 - Math.hypot(x - me.x, z - me.z) / 40)
}
// 金属の響き: 倍音でない周波数を重ねる（刃が当たる・ガラス）
function ring(base, dur, vol, wet = 0.35, delay = 0) { for (const [r, v] of [[1, 1], [2.76, 0.6], [5.4, 0.35], [8.93, 0.2]]) if (base * r < 16000) tone(base * r, dur / (0.6 + r * 0.25), 'sine', vol * v, null, delay, wet) } // 聞こえる範囲を超える成分は鳴らさない

// 街の環境音: 低い街のざわめき、ときどき遠くを通る車、晴れの日は遠くの鳥
let ambGain = null
function loopNoise(filterType, freq, q, gain) {
  const src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true
  const f = actx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q
  const g = actx.createGain(); g.gain.value = gain
  src.connect(f).connect(g).connect(master); src.start(0, Math.random() * 1.5)
  return { f, g }
}
function startAmbient() {
  ambGain = loopNoise('lowpass', 380, 0.7, 0.05).g
  const car = () => {
    if (!muted && mode !== 'title') {
      audioPos.pan = Math.random() * 1.6 - 0.8; audioPos.far = 0.7
      const dur = 2.5 + Math.random() * 2
      noise(dur, 0.05, 240, 'bandpass', 0, 520, 1.2, 0.5)
    }
    setTimeout(car, 5000 + Math.random() * 9000)
  }
  setTimeout(car, 3000)
  const bird = () => {
    if (!muted && weather === 'clear' && mode !== 'loading') {
      audioPos.pan = Math.random() * 1.6 - 0.8; audioPos.far = 0.85
      const f0 = 2600 + Math.random() * 1500, n = 2 + Math.floor(Math.random() * 3)
      for (let i = 0; i < n; i++) tone(f0, 0.09, 'sine', 0.012, f0 * 1.35, i * 0.13, 0.5)
    }
    setTimeout(bird, 4000 + Math.random() * 8000)
  }
  setTimeout(bird, 2500)
}

// 天候の音: 雨は地の音（サー）・粒の音（パラパラ）・ときどき近くに落ちる大粒・うなる風・雷。雪はこもった風だけ
let wx = null, rainGain = null
function setWeatherAudio(w) {
  if (!actx) return
  if (!wx) {
    wx = {
      hiss: loopNoise('highpass', 900, 0.4, 0),
      patter: loopNoise('bandpass', 3200, 0.7, 0),
      wind: loopNoise('lowpass', 420, 2.5, 0),
    }
    rainGain = wx.hiss.g
    // 雨粒と風のうねりは時間で揺らす
    const tick = () => {
      if (actx && !muted) {
        const t = actx.currentTime, W = weather
        if (W === 'storm') {
          wx.patter.g.gain.setTargetAtTime(0.05 + Math.random() * 0.05, t, 0.08)
          for (let i = 0; i < 3; i++) if (Math.random() < 0.7) { audioPos.pan = Math.random() * 2 - 1; audioPos.far = 0.2 + Math.random() * 0.6; noise(0.02 + Math.random() * 0.03, 0.03 + Math.random() * 0.04, 2000 + Math.random() * 5000, 'bandpass', Math.random() * 0.1, null, 4, 0.15) }
        }
        if (W !== 'clear') { wx.wind.f.frequency.setTargetAtTime(260 + Math.random() * 520, t, 0.8); wx.wind.g.gain.setTargetAtTime((W === 'storm' ? 0.07 : 0.035) * (0.4 + Math.random()), t, 0.9) }
      }
      setTimeout(tick, 110)
    }
    tick()
    const thunder = () => {
      if (actx && !muted && weather === 'storm' && mode !== 'loading') {
        const near = Math.random() < 0.35
        lightningFlash(near ? 1 : 0.5)
        const delay = near ? 0.25 : 1 + Math.random() * 2
        audioPos.pan = Math.random() * 1.6 - 0.8; audioPos.far = near ? 0.1 : 0.6
        if (near) noise(0.25, 0.35, 3000, 'highpass', delay, 600, 0.7, 0.6) // 割れるような音
        noise(4.5, near ? 0.45 : 0.3, 220, 'lowpass', delay + 0.05, 60, 0.8, 0.7) // 長いゴロゴロ
        tone(48, 3.5, 'sine', near ? 0.2 : 0.12, 32, delay, 0.5)
      }
      setTimeout(thunder, 14000 + Math.random() * 20000)
    }
    setTimeout(thunder, 6000)
  }
  const t = actx.currentTime, W = WEATHER[w] || WEATHER.clear
  const rain = W.fall === 'rain', snow = W.fall === 'snow'
  wx.hiss.g.gain.setTargetAtTime(muted ? 0 : rain ? 0.09 : 0, t, 0.4)
  wx.patter.g.gain.setTargetAtTime(muted ? 0 : rain ? 0.06 : 0, t, 0.4)
  wx.wind.g.gain.setTargetAtTime(muted ? 0 : rain ? 0.06 : snow ? 0.03 : 0, t, 0.6)
  if (ambGain) ambGain.gain.setTargetAtTime(muted ? 0 : snow ? 0.03 : 0.05, t, 0.4) // 雪の日は街の音が吸われる
}
// 雷の光: 空と全体の明るさを一瞬上げる（2回ちらつく）
function lightningFlash(k) {
  const base = hemi.intensity
  const f = (v, ms) => setTimeout(() => { hemi.intensity = WEATHER[weather].hemi + v * 2.2 * k }, ms)
  f(1, 0); f(0.2, 70); f(0.8, 140); f(0, 320)
}

const SFX = {
  // 振る: 帯域が上へ抜ける風切り音。軽い刃は高く短く
  blade: (k, light) => { noise(light ? 0.12 : 0.2, 0.3 * k, light ? 1400 : 700, 'bandpass', 0, light ? 5000 : 3200, 1.4, 0.15); tone(light ? 240 : 150, 0.12, 'triangle', 0.04 * k, light ? 120 : 70) },
  // 斬った: 金属の響き＋鈍い衝撃＋はじける音
  hitBlade: k => { ring(1450 + Math.random() * 200, 0.6, 0.06 * k); tone(110, 0.22, 'sine', 0.22 * k, 45, 0, 0.1); noise(0.08, 0.3 * k, 4000, 'highpass') },
  hitBullet: k => { noise(0.04, 0.12 * k, 3500, 'bandpass', 0, null, 2); tone(700, 0.05, 'square', 0.025 * k, 300) },
  // 射撃: 種類ごとに音色を変える（スプリッターは鋭い連打、シーカーはうねる、バーストはこもった打ち出し）
  shoot: (k, gun) => {
    if (gun === 'launcher') { tone(140, 0.28, 'sine', 0.2 * k, 55); noise(0.22, 0.2 * k, 800, 'lowpass', 0, 160) } // ぽんっとこもった打ち出し
    else if (gun === 'shotgun') { noise(0.16, 0.38 * k, 2400, 'lowpass', 0, 400, 0.7, 0.35); tone(70, 0.18, 'sine', 0.22 * k, 40) } // 太く重い一発
    else if (gun === 'rifle') { noise(0.035, 0.16 * k, 3800, 'highpass'); tone(260, 0.05, 'square', 0.04 * k, 120) } // 短く乾いた連射音
    else { tone(1100, 0.08, 'square', 0.05 * k, 330); noise(0.05, 0.2 * k, 4200, 'highpass'); tone(100, 0.1, 'sine', 0.12 * k, 50) } // 鋭い単発
  },

  pad: k => { tone(200, 0.28, 'sine', 0.14 * k, 720); tone(400, 0.18, 'triangle', 0.04 * k, 1200, 0.02); noise(0.08, 0.06 * k, 1800) },
  bag: k => noise(0.4, 0.12 * k, 900, 'lowpass', 0, 250),
  dash: k => { noise(0.26, 0.26 * k, 500, 'bandpass', 0, 2400, 1.2, 0.15); tone(420, 0.2, 'sine', 0.04 * k, 160) },
  // 足音: 硬い路面のコツという音。雨の日は水を踏む音
  step: k => {
    if (weather === 'storm') { noise(0.07, 0.07 * k, 1800 + Math.random() * 800, 'bandpass', 0, 700, 1.5, 0.05); tone(80, 0.05, 'sine', 0.04 * k, 55, 0, 0.05) }
    else if (weather === 'snow') noise(0.09, 0.06 * k, 900 + Math.random() * 300, 'bandpass', 0, 500, 1, 0.03)
    else { noise(0.04, 0.06 * k, 1100 + Math.random() * 600, 'bandpass', 0, null, 1.5, 0.05); tone(90, 0.05, 'sine', 0.05 * k, 60, 0, 0.05) }
  },
  land: k => { tone(70, 0.2, 'sine', 0.2 * k, 40, 0, 0.15); noise(0.15, 0.12 * k, 600, 'lowpass', 0, 150) },
  // 狙撃: 乾いた破裂と街に響く長い尾。重い銃ほど低く、軽い銃ほど短い
  snipe: (k, gun) => {
    const heavy = gun === 'ibis' ? 1.6 : gun === 'lightning' ? 0.55 : 1
    noise(0.05, 0.5 * k, 5200, 'highpass', 0, null, 0.7, 0.6)
    tone(130 / heavy, 0.4 * heavy, 'sine', 0.24 * k * Math.min(1.3, heavy), 36, 0, 0.6)
    noise(1.3 * heavy, 0.12 * k, 700, 'lowpass', 0.03, 120, 0.7, 0.9)
  },
  charge: (k, sec = 0.9) => { tone(320, sec, 'sine', 0.035 * k, 1300); tone(640, sec, 'triangle', 0.012 * k, 2600) },
  // 崩落: 地鳴りが長く続き、砕ける音とガラスの割れる音が何度も重なる
  collapse: k => {
    tone(45, 3.2, 'sine', 0.24 * k, 25, 0, 0.6); noise(3.4, 0.3 * k, 300, 'lowpass', 0, 70, 0.7, 0.7)
    for (let i = 0; i < 9; i++) noise(0.25 + Math.random() * 0.4, (0.1 + Math.random() * 0.12) * k, 500 + Math.random() * 1500, 'bandpass', 0.1 + Math.random() * 2.2, 200, 0.8, 0.5)
    for (let i = 0; i < 5; i++) ring(2400 + Math.random() * 2400, 0.35, 0.025 * k, 0.5, 0.2 + Math.random() * 1.6)
  },
  // 爆発: 胸に来る低音・広がる轟音・はじけ
  boom: k => { tone(75, 0.9, 'sine', 0.3 * k, 28, 0, 0.5); noise(1.3, 0.32 * k, 1600, 'lowpass', 0, 150, 0.7, 0.6); noise(0.08, 0.3 * k, 3500, 'highpass') },
  tele: k => { tone(700, 0.2, 'triangle', 0.06 * k, 2800); noise(0.18, 0.1 * k, 6000, 'bandpass', 0, 1500, 3); tone(2800, 0.14, 'sine', 0.04 * k, 700, 0.1) },
  cham: k => { tone(900, 0.4, 'sine', 0.035 * k, 200); noise(0.4, 0.05 * k, 3000, 'bandpass', 0, 600, 2) },
  hitSnipe: k => { ring(900, 0.5, 0.05 * k); tone(160, 0.3, 'sine', 0.22 * k, 50); noise(0.12, 0.3 * k, 2500) },
  jump: k => noise(0.1, 0.05 * k, 900, 'bandpass', 0, 2000),
  swap: () => { audioPos.pan = 0; audioPos.far = 0; noise(0.12, 0.08, 1200, 'bandpass', 0, 4200, 1.2, 0.05); tone(380, 0.07, 'square', 0.03, 760, 0.05, 0.05); ring(2200, 0.25, 0.02, 0.2, 0.09) }, // 引き抜く音とカチッという噛み合い
  // 強制帰還: 体が砕けるガラスの音と、吸い込まれて消える音
  bailout: () => { for (let i = 0; i < 7; i++) ring(1800 + Math.random() * 2600, 0.5, 0.03, 0.5, Math.random() * 0.25); tone(900, 0.9, 'sine', 0.14, 90, 0.15, 0.5); noise(0.7, 0.12, 4000, 'bandpass', 0.1, 300, 1.5, 0.5) },
  win: () => { audioPos.pan = 0; audioPos.far = 0; [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'square', 0.06, null, i * 0.12, 0.3)) },
  lose: () => { audioPos.pan = 0; audioPos.far = 0; [392, 330, 262].forEach((f, i) => tone(f, 0.32, 'triangle', 0.1, null, i * 0.17, 0.3)) },
}
const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="#0f1722" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="#0f1722"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>'
const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="#0f1722" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="#0f1722"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'
function renderMute() { $('mute').innerHTML = muted ? ICON_SOUND_OFF : ICON_SOUND_ON }
$('mute').addEventListener('click', () => {
  setMuted(!muted)
  setWeatherAudio(weather)
  try { localStorage.setItem('ts-muted', muted ? '1' : '0') } catch {}
  ensureAudio(); renderMute()
})

// ================================================================ 入力
// 視点は肩越しの三人称。camYaw はユニットの yaw と同じ向きの約束（前 = (sin, cos)）
let camYaw = Math.PI
let camPitch = 0.16       // 正で見下ろす
const PITCH_MIN = -0.45, PITCH_MAX = 0.8
const keys = new Set()
const pressed = { jump: false, pad: false, blade: false, lock: false, dash: false, bag: false, cham: false, tele: false }
// 狙いの固定。外すとカメラは自動で動かず、攻撃は画面中央の照準の先へ飛ぶ
let lockOn = true
function setLockOn(v) { if (v && !lockOn) pressed.lock = true; lockOn = v; hud.lockOn = undefined } // 固定に戻したら向きに関係なく選び直す
// 狙撃は押している間ためるので、押した瞬間ではなく押しているかを持つ（押しているもの: Lキー以外のマウス・タッチ）
const snipeHolders = new Set()
// 組んだギアの割り当て（setTriggers で決まる）: マウスの左右、スマホの4つの枠（大きいボタンから順）
// 武器スロット: 組んだ攻撃用ギア（近接・銃・狙撃）を1つずつ持ち替えて使う。補助ギアは専用のボタン
const SUP_SLOTS = ['tPad', 'tBag', 'tSup3']
let weapons = [], supports = [], activeW = 0, touchBtn = {}
function selectWeapon(i) {
  if (!weapons.length) return
  i = ((i % weapons.length) + weapons.length) % weapons.length
  if (i === activeW) return
  activeW = i
  snipeHolders.clear(); shootHolders.clear() // 持ち替えたら、押しっぱなしの撃ち・ためは切る
  hud.weapon = undefined
  if (mode === 'play') {
    SFX.swap && SFX.swap()
    // 照準の下に、持ち替えた武器の名前を一瞬出す
    const w = weapons[activeW], el = $('wpnPop')
    el.innerHTML = `<svg><use href="#${TRIG_INFO[w].icon}"/></svg><b>${TRIG_INFO[w].name}</b><kbd>${activeW + 1}</kbd>`
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show')
  }
}
// ギアを押した: 狙撃は押している間ため、それ以外は押した瞬間に出す
// ギアの名前 → 出す動作（近接・射撃・狙撃はそれぞれ同じボタン）
const ACTION = { blade: 'blade', scorpion: 'blade', handgun: 'shoot', rifle: 'shoot', shotgun: 'shoot', launcher: 'shoot', snipe: 'snipe', lightning: 'snipe', ibis: 'snipe', pad: 'pad', bag: 'bag', chameleon: 'cham', teleport: 'tele', jump: 'jump', dash: 'dash' }
function actDown(t, who) {
  if (mode !== 'play') return
  if (t === 'attack') t = weapons[activeW] // 攻撃ボタンは、いま持っている武器を使う
  if (!t) return
  const a = ACTION[t] || t
  if (a === 'snipe') snipeHolders.add(who)
  else if (a === 'shoot') shootHolders.add(who) // 銃は押している間撃ち続ける
  else pressed[a] = true
}
function actUp(who) { snipeHolders.delete(who); shootHolders.delete(who) }
const shootHolders = new Set()
const stick = { x: 0, y: 0, id: null }
const look = { id: null, x: 0, y: 0 }
let pointerLocked = false
addEventListener('keydown', e => {
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault()
  if (e.repeat) return
  keys.add(e.code)
  if (mode === 'play') {
    if (e.code === 'Space') pressed.jump = true
    if (e.code === 'KeyJ') actDown('attack', 'kJ')
    if (/^Digit[1-3]$/.test(e.code)) selectWeapon(+e.code[5] - 1)
    if (e.code === 'KeyR') selectWeapon(activeW + 1)
    if (e.code === 'KeyE') pressed.pad = true
    if (e.code === 'Tab') { pressed.lock = true; setLockOn(true) }
    if (e.code === 'KeyQ') setLockOn(!lockOn)
    if (e.code === 'KeyC') pressed.bag = true
    if (e.code === 'KeyV') pressed.cham = true
    if (e.code === 'KeyM') toggleBigMap()
    if (e.code === 'KeyF') pressed.tele = true
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') pressed.dash = true
  }
  if ((e.code === 'Enter' || e.code === 'Space') && (mode === 'title' || mode === 'result')) startGame()
})
addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyJ') actUp('kJ') })
addEventListener('blur', () => { keys.clear(); stick.x = stick.y = 0; snipeHolders.clear(); shootHolders.clear() })

// マウス: 左で斬る・右で撃つ。視点はカメラが狙っている相手を自動で追うので、マウスで回さなくていい
const canvas = renderer.domElement
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'play') return
  if (e.pointerType === 'mouse') {
    // マウスを画面に固定して視点を回せるようにする。最初のクリックも攻撃として扱う（空振りさせない）
    // 固定できない環境（埋め込み・一部のブラウザ）では Promise が拒否されるので、失敗は無視して続ける
    if (!pointerLocked && !window.__tsNoHint) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}) } catch {} }
    if (e.button === 0) actDown('attack', 'm0') // 左: いまの武器で攻撃
    if (e.button === 2) selectWeapon(activeW + 1) // 右: 次の武器へ持ち替え
    return
  }
  // タッチ: ボタン以外の場所をなぞると視点が回る
  if (look.id === null) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; try { canvas.setPointerCapture(e.pointerId) } catch {} }
})
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== look.id) return
  const dx = e.clientX - look.x, dy = e.clientY - look.y
  look.x = e.clientX; look.y = e.clientY
  turnCamera(dx * 0.0065, dy * 0.0045)
})
const endLook = e => { if (e.pointerId === look.id) look.id = null }
canvas.addEventListener('pointerup', endLook)
addEventListener('pointerup', e => { if (e.pointerType === 'mouse') actUp('m' + e.button) })
canvas.addEventListener('wheel', e => { if (mode !== 'play') return; e.preventDefault(); selectWeapon(activeW + (e.deltaY > 0 ? 1 : -1)) }, { passive: false })
canvas.addEventListener('pointercancel', endLook)
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas })
addEventListener('mousemove', e => { if (pointerLocked && mode === 'play') turnCamera(e.movementX * 0.0024, e.movementY * 0.002) })
addEventListener('contextmenu', e => e.preventDefault())
// 自分で視点を回したら、少しの間は自動で追うのをやめる
let manualT = 99
function turnCamera(dx, dy) {
  manualT = 0
  camYaw -= dx
  camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, camPitch + dy))
}

// 画面中央の照準が指している点: カメラの向きの線を建物・地面・敵に当てる（当たらなければ120m先）
const aimRay = new THREE.Ray(), aimHit = new THREE.Vector3()
function aimPointFromCamera() {
  aimRay.origin.copy(camPos)
  aimRay.direction.copy(camLook).sub(camPos).normalize()
  let best = 120
  for (const bd of buildings) if (!bd.dead && aimRay.intersectBox(bd.box, aimHit)) best = Math.min(best, aimHit.distanceTo(camPos))
  if (aimRay.direction.y < -1e-4) best = Math.min(best, -camPos.y / aimRay.direction.y)
  if (state) for (const u of state.units) {
    if (!u.alive || u.team === 0) continue
    const c = tmpV.set(u.x, u.y + 1, u.z), t = c.clone().sub(camPos).dot(aimRay.direction)
    if (t > 0 && t < best && aimRay.distanceToPoint(c) < 0.8) best = t
  }
  const p = aimRay.at(best, aimHit)
  return { x: p.x, y: p.y, z: p.z }
}
function readInput() {
  let x = stick.x, z = stick.y
  if (keys.has('KeyA')) x -= 1
  if (keys.has('KeyD')) x += 1
  if (keys.has('KeyW')) z -= 1
  if (keys.has('KeyS')) z += 1
  // 矢印キーでも視点を回せる（マウスが無いとき）
  const kt = G.STEP * 2.4
  if (keys.has('ArrowLeft')) turnCamera(-kt, 0)
  if (keys.has('ArrowRight')) turnCamera(kt, 0)
  if (keys.has('ArrowUp')) turnCamera(0, -kt * 0.6)
  if (keys.has('ArrowDown')) turnCamera(0, kt * 0.6)
  // 画面の上（前）= カメラの向き
  const fwd = -z, rgt = x
  return {
    mx: Math.sin(camYaw) * fwd - Math.cos(camYaw) * rgt,
    mz: Math.cos(camYaw) * fwd + Math.sin(camYaw) * rgt,
    snipe: snipeHolders.size > 0,
    shoot: shootHolders.size > 0,
    lockOff: !lockOn,
    aimPoint: aimPointFromCamera(), // 狙撃はいつも照準の先へ（銃は固定中なら相手を狙う）
    aimYaw: camYaw,
    aimPitch: -camPitch * 0.85 + 0.06,
  }
}

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
if (isTouch) document.body.classList.add('touch')
{
  const el = $('stick'), knob = $('knob'), R = 52
  const set = e => {
    const r = el.getBoundingClientRect()
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
    const d = Math.hypot(dx, dy)
    if (d > R) { dx *= R / d; dy *= R / d }
    knob.style.transform = `translate(${dx}px,${dy}px)`
    const m = Math.min(1, d / R), dz = 0.15
    const k = m < dz ? 0 : (m - dz) / (1 - dz)
    stick.x = d > 0 ? dx / d * k : 0
    stick.y = d > 0 ? dy / d * k : 0
  }
  el.addEventListener('pointerdown', e => { stick.id = e.pointerId; try { el.setPointerCapture(e.pointerId) } catch {} set(e); ensureAudio() })
  el.addEventListener('pointermove', e => { if (e.pointerId === stick.id) set(e) })
  const end = e => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = '' }
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
  const tap = (b, getKey) => {
    b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId) } catch {} const k = getKey(); if (k) actDown(k, 't' + b.id); b.classList.add('on'); ensureAudio() })
    const up = () => { b.classList.remove('on'); actUp('t' + b.id) }
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up)
  }
  tap($('tBlade'), () => 'attack')
  $('tShoot').addEventListener('pointerdown', e => { e.preventDefault(); selectWeapon(activeW + 1); ensureAudio() })
  SUP_SLOTS.forEach((id, i) => tap($(id), () => supports[i]))
  tap($('tJump'), () => 'jump'); tap($('tDash'), () => 'dash')
  $('tLock').addEventListener('pointerdown', e => { e.preventDefault(); setLockOn(!lockOn) })
}

// ================================================================ HUD
let hud = {}
const ROLE_LABEL = { attacker: 'アタッカー', shooter: 'シューター', allround: 'オールラウンダー', sniper: 'スナイパー' }
function buildPips() {
  for (const team of [0, 1]) {
    const el = $('pips' + team)
    el.innerHTML = ''
    for (const u of state.units.filter(x => x.team === team)) {
      const d = document.createElement('div')
      d.className = 'pip' + (u.player ? ' me' : '')
      d.innerHTML = '<i></i>'
      el.appendChild(d)
      hud['p' + u.id] = { el: d, bar: d.firstChild, en: -1, alive: true }
    }
  }
}
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
// 照準の輪の弧。角度は上を0度として時計回り
function arcPath(r, a0, a1) {
  if (a1 - a0 < 0.5) return ''
  const p = a => { const t = (a - 90) * Math.PI / 180; return `${(Math.cos(t) * r).toFixed(2)} ${(Math.sin(t) * r).toFixed(2)}` }
  return `M${p(a0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`
}
const EN_ARC = [215, 325], CH_ARC = [40, 140]
const TICKS = { Blade: [152, 168], Shoot: [173, 187], Pad: [192, 208] }
$('tEn').setAttribute('d', arcPath(44, ...EN_ARC))
$('tCh').setAttribute('d', arcPath(44, ...CH_ARC))
// ミニマップ: 自機を中心に、カメラの向きを上にして回す。建物は高さで濃さを変える（乗れる低い建物は薄い）
const radar = $('radar'), rctx = radar.getContext('2d')
let radarN = 0
// 音の印: 見えていない敵が音を立てた場所を少しの間ミニマップに出す
const pings = [], PING_LIFE = 2.5, HEAR_RANGE = 120
const LOUD = { shoot: 1, snipe: 1, pad: 1, dash: 1, blade: 1 }
function hearEvent(st, ev) {
  if (!LOUD[ev.type] || ev.id === undefined) return
  const u = st.units[ev.id], f = followTarget(st)
  if (!u || u.team === 0 || !u.alive || u.cham || G.detectable(st, 0, u)) return // ミラージュ中の敵は音でも分からない
  if (Math.hypot(u.x - f.x, u.z - f.z) > HEAR_RANGE) return
  const old = pings.find(p => p.id === u.id)
  if (old) { old.x = u.x; old.z = u.z; old.t = 0 } else pings.push({ id: u.id, x: u.x, z: u.z, t: 0 })
}
function stepPings(dt) { const k = state && state.units.some(u => u.player && u.sense === 'hawk') ? 0.6 : 1; for (let i = pings.length - 1; i >= 0; i--) if ((pings[i].t += dt * k) > PING_LIFE) pings.splice(i, 1) } // 鷹の目は音の印が長く残る
function drawRadar(st) {
  if (++radarN % 2) return
  const dpr = Math.min(2, devicePixelRatio || 1)
  const W = radar.clientWidth, H = radar.clientHeight
  if (radar.width !== Math.round(W * dpr)) { radar.width = Math.round(W * dpr); radar.height = Math.round(H * dpr) }
  const x = rctx
  x.setTransform(dpr, 0, 0, dpr, 0, 0)
  x.clearRect(0, 0, W, H)
  const f = followTarget(st)
  const meR = st.units.find(u => u.player)
  const R = W / 2, sc = R / (meR && meR.sense === 'hawk' ? G.HAWK_RADAR : G.RADAR_RANGE) // ミニマップの半径 = レーダーの範囲（鷹の目は広い）
  x.save()
  x.beginPath(); x.arc(R, R, R - 1, 0, 7); x.clip()
  x.fillStyle = 'rgba(15,23,34,.62)'; x.fillRect(0, 0, W, H)
  x.translate(R, R)
  // カメラの前（sin yaw, cos yaw）が上、カメラの右（-cos yaw, sin yaw）が右に来る回転。yaw=π で恒等になる
  x.rotate(camYaw - Math.PI)
  x.scale(sc, sc)
  x.translate(-f.x, -f.z)
  // 戦える範囲
  x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1 / sc
  x.strokeRect(-G.MAP_HALF, -G.MAP_HALF, G.MAP_HALF * 2, G.MAP_HALF * 2)
  for (const b of st.blocks) {
    if (b.kind === 'mwall' || (b.kind === 'mfloor' && b.roof)) { x.fillStyle = b.kind === 'mwall' ? 'rgba(220,230,240,.75)' : 'rgba(200,212,224,.12)'; x.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d); continue } // モールの壁と屋根
    if (b.kind && b.kind !== 'rubble') continue
    x.fillStyle = b.kind === 'rubble' ? 'rgba(170,150,130,.35)' : b.nest ? 'rgba(255,214,90,.55)' : b.h > 17 ? 'rgba(200,212,224,.55)' : 'rgba(200,212,224,.28)'
    x.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d)
  }
  for (const u of st.units) {
    if (!u.alive) continue
    const blip = u.team === 1 && !G.detectable(st, 0, u) && G.radarBlip(st, 0, u) // ミラージュ中の敵はレーダーの点だけ
    if (u.team === 1 && !G.detectable(st, 0, u) && !blip) continue // マントを着て見えていない敵はレーダーに出ない
    if (blip) { x.strokeStyle = 'rgba(255,107,94,.85)'; x.lineWidth = 0.45; x.beginPath(); x.arc(u.x, u.z, 1.6, 0, 7); x.stroke(); continue }
    if (u.team === 0 && u.bag) { x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 0.35; x.beginPath(); x.arc(u.x, u.z, 2.4, 0, 7); x.stroke() }
    // モールで別の階にいる相手は ▲（上の階）／▼（下の階）
    const fdy = st.stage === 'mall' && !u.player ? u.y - f.y : 0
    if (Math.abs(fdy) > 3) {
      x.save(); x.translate(u.x, u.z); x.rotate(-(camYaw - Math.PI)); x.fillStyle = u.team === 0 ? '#6fa2ff' : '#ff6b5e'
      const s = 2.2, up = fdy > 0 ? -1 : 1
      x.beginPath(); x.moveTo(0, up * s); x.lineTo(s, -up * s * 0.8); x.lineTo(-s, -up * s * 0.8); x.closePath(); x.globalAlpha = 0.85; x.fill(); x.globalAlpha = 1; x.restore(); continue
    }
    x.save(); x.translate(u.x, u.z); x.rotate(-u.yaw)
    x.fillStyle = u.team === 0 ? (u.player ? '#ffffff' : '#6fa2ff') : '#ff6b5e'
    const s = u.player ? 2.4 : 1.6
    x.beginPath(); x.moveTo(0, s * 1.2); x.lineTo(s * 0.8, -s * 0.8); x.lineTo(-s * 0.8, -s * 0.8); x.closePath(); x.fill()
    x.restore()
  }
  x.restore()
  // 音のした場所（見えていない敵の発砲・エアステップ・ダッシュなど）。範囲の外なら縁に出す
  for (const p of pings) {
    const k = 1 - p.t / PING_LIFE
    let dx = p.x - f.x, dz = p.z - f.z
    // 世界の向きをミニマップの向きへ（上の rotate(camYaw - π) と同じ回転）
    const a = camYaw - Math.PI, c = Math.cos(a), s = Math.sin(a)
    let px = (dx * c - dz * s) * sc, py = (dx * s + dz * c) * sc
    const r = Math.hypot(px, py), lim = R - 7
    if (r > lim) { px *= lim / r; py *= lim / r }
    x.strokeStyle = `rgba(255,107,94,${(0.95 * k).toFixed(2)})`; x.lineWidth = 2
    x.beginPath(); x.arc(R + px, R + py, 3 + (1 - k) * 9, 0, 7); x.stroke()
    x.fillStyle = `rgba(255,107,94,${(0.9 * k).toFixed(2)})`
    x.beginPath(); x.arc(R + px, R + py, 2.6, 0, 7); x.fill()
  }
  // モールでは今いる階を出す
  if (st.stage === 'mall') { const fl = Math.round(f.y / 6.8) + 1; x.fillStyle = 'rgba(255,197,49,.95)'; x.font = '900 13px "Oxanium",sans-serif'; x.textAlign = 'center'; x.fillText(`${fl}F`, R, H - 12); x.textAlign = 'start' }
  // 縁と視野
  x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1.5
  x.beginPath(); x.arc(R, R, R - 1, 0, 7); x.stroke()
  x.fillStyle = 'rgba(255,255,255,.08)'
  x.beginPath(); x.moveTo(R, R); x.arc(R, R, R - 1, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); x.fill()
}
// 全体地図: M（スマホはミニマップをタップ）で開閉。北（-z）を上に固定し、街全体・味方・見えている敵・音の印を出す
let bigMap = false
const bigEl = $('bigmap'), bctx = bigEl.getContext('2d')
function toggleBigMap(v = !bigMap) { bigMap = v && mode === 'play'; bigEl.hidden = !bigMap }
radar.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleBigMap() })
bigEl.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleBigMap(false) })
function drawBigMap(st) {
  const dpr = Math.min(2, devicePixelRatio || 1)
  const S = Math.min(innerWidth * 0.86, innerHeight * 0.78)
  bigEl.style.width = bigEl.style.height = S + 'px'
  if (bigEl.width !== Math.round(S * dpr)) { bigEl.width = bigEl.height = Math.round(S * dpr) }
  const x = bctx
  x.setTransform(dpr, 0, 0, dpr, 0, 0)
  x.clearRect(0, 0, S, S)
  x.fillStyle = 'rgba(15,23,34,.93)'; x.fillRect(0, 0, S, S)
  const E = G.MAP_HALF + 6, sc = S / (E * 2)
  x.save(); x.translate(S / 2, S / 2); x.scale(sc, sc)
  // 道路の線
  x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 1 / sc
  for (const rd of G.STAGES[st.stage].roads) { x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect(-G.MAP_HALF, rd.c - rd.w / 2, G.MAP_HALF * 2, rd.w); x.fillRect(rd.c - rd.w / 2, -G.MAP_HALF, rd.w, G.MAP_HALF * 2) }
  x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = 1.5 / sc
  x.strokeRect(-G.MAP_HALF, -G.MAP_HALF, G.MAP_HALF * 2, G.MAP_HALF * 2)
  for (const b of st.blocks) {
    if (b.kind === 'mwall' || (b.kind === 'mfloor' && b.roof)) { x.fillStyle = b.kind === 'mwall' ? 'rgba(220,230,240,.8)' : 'rgba(200,212,224,.12)'; x.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d); continue }
    if (b.kind && b.kind !== 'rubble') continue
    x.fillStyle = b.kind === 'rubble' ? 'rgba(160,140,120,.35)' : b.nest ? 'rgba(230,196,96,.45)' : `rgba(200,212,224,${Math.min(0.75, 0.2 + b.h / 100).toFixed(2)})`
    x.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d)
  }
  // 見えている範囲（レーダー）
  const me = st.units.find(u => u.player)
  const f = followTarget(st)
  x.strokeStyle = 'rgba(111,162,255,.5)'; x.lineWidth = 1.5 / sc
  x.beginPath(); x.arc(f.x, f.z, G.RADAR_RANGE, 0, 7); x.stroke()
  for (const p of pings) { const k = 1 - p.t / PING_LIFE; x.strokeStyle = `rgba(255,107,94,${k.toFixed(2)})`; x.lineWidth = 2 / sc; x.beginPath(); x.arc(p.x, p.z, 3 + (1 - k) * 8, 0, 7); x.stroke() }
  for (const u of st.units) {
    if (!u.alive) continue
    if (u.team === 1 && !G.detectable(st, 0, u)) continue
    x.save(); x.translate(u.x, u.z); x.rotate(-u.yaw)
    x.fillStyle = u.team === 0 ? (u.player ? '#ffffff' : '#6fa2ff') : '#ff6b5e'
    const r = (u.player ? 9 : 7) / sc
    x.beginPath(); x.moveTo(0, r * 1.2); x.lineTo(r * 0.8, -r * 0.8); x.lineTo(-r * 0.8, -r * 0.8); x.closePath(); x.fill()
    x.restore()
  }
  // 自機の向いている方（カメラ）
  if (me.alive) { x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 1.5 / sc; x.beginPath(); x.moveTo(me.x, me.z); x.lineTo(me.x + Math.sin(camYaw) * 30, me.z + Math.cos(camYaw) * 30); x.stroke() }
  x.restore()
  x.fillStyle = 'rgba(255,255,255,.7)'; x.font = '800 12px "Hiragino Sans","Noto Sans JP",sans-serif'; x.textBaseline = 'top'
  x.fillText(isTouch ? '全体地図　タップで閉じる' : '全体地図　M で閉じる', 10, 10)
}
function drawHud(st) {
  drawRadar(st)
  if (bigMap) drawBigMap(st)
  const meU = st.units.find(u => u.player)
  const lowEn = meU && meU.alive && meU.en < 30
  if (hud.low !== lowEn) { hud.low = lowEn; $('lowEn').classList.toggle('on', lowEn) }
  const adv = G.adverse(meU)
  if (hud.adv !== adv) { hud.adv = adv; $('me').classList.toggle('adverse', adv); $('meRole').textContent = adv ? '逆境 発動' : ROLE_LABEL[meU.role] }
  if (hud.role !== meU.role) { hud.role = meU.role; $('meRole').textContent = ROLE_LABEL[meU.role] }
  if (!callState.min1 && !st.overtime && st.timeLeft <= 60 && mode === 'play') { callState.min1 = true; call(`残り1分、${st.score[0]}対${st.score[1]}`) }
  const tl = st.overtime ? '延長' : fmtTime(st.timeLeft)
  if (hud.t !== tl) { $('clock').textContent = tl; $('clock').classList.toggle('low', st.overtime || st.timeLeft <= 30); hud.t = tl }
  // 脱出中は再出撃までの秒読み
  const rs = !meU.alive && mode === 'play' ? Math.max(1, Math.ceil(G.respawnT(meU) - meU.outT)) : 0
  if (hud.rs !== rs) { hud.rs = rs; $('respawnT').textContent = rs }
  // 敵のスナイパーにためられている
  const aimed = meU.alive && st.units.some(e => e.alive && e.team !== meU.team && e.snipeT >= 0 && e.targetId === meU.id)
  if (hud.aimed !== aimed) { hud.aimed = aimed; $('snipeWarn').hidden = !aimed }
  if (hud.s0 !== st.score[0]) { $('sc0').textContent = st.score[0]; hud.s0 = st.score[0] }
  if (hud.s1 !== st.score[1]) { $('sc1').textContent = st.score[1]; hud.s1 = st.score[1] }
  for (const u of st.units) {
    const m = hud['p' + u.id]
    if (!m) continue
    const en = Math.max(0, Math.round(u.en))
    if (m.en !== en) { m.bar.style.transform = `scaleX(${en / 100})`; m.en = en }
    if (m.alive !== u.alive) { m.el.classList.toggle('out', !u.alive); m.alive = u.alive }
  }
  const me = st.units.find(u => u.player)
  const en = Math.max(0, Math.round(me.en))
  if (hud.en !== en) {
    $('enNum').textContent = en
    $('enNum').classList.toggle('low', en <= 30)
    $('enBar').firstElementChild.style.transform = `scaleX(${en / 100})`
    $('enBar').classList.toggle('low', en <= 30)
    $('rEn').setAttribute('d', arcPath(44, EN_ARC[0], EN_ARC[0] + (EN_ARC[1] - EN_ARC[0]) * en / 100))
    $('rEn').classList.toggle('low', en <= 30)
    $('rEnNum').textContent = en
    hud.en = en
  }
  const leakLeft = me.alive && me.leak > 0 ? Math.ceil(Math.max(...me.wounds.map(w => w.t))) : 0
  const leakTxt = (leakLeft ? `損傷　毎秒 ${Math.max(0.1, me.leak).toFixed(1)} 漏れている　あと${leakLeft}秒` : '') + (me.weights ? `${leakLeft ? '　' : ''}重り ${me.weights}個　足とジャンプ −${Math.round(me.slow * 100)}%　あと${Math.ceil(me.slowT)}秒` : '')
  if (hud.leak !== leakTxt) { $('leak').innerHTML = leakTxt ? `<svg><use href="#i-drop"/></svg>${leakTxt}` : ''; hud.leak = leakTxt }
  // ギアの待ち時間（0=使える 1=使えない）
  const sniper = !!me.sniper
  const cds = { pad: me.padCd / G.PAD_CD, dash: me.dashCd / G.DASH_CD }
  if (me.melee) cds[me.melee] = me.bladeT >= 0 ? 1 : me.bladeCd / G.MELEE[me.melee].cd
  if (me.gun) cds[me.gun] = me.shootCd / G.GUNS[me.gun].rate
  if (me.sniper) cds[me.sniper] = me.snipeT >= 0 ? 0 : me.snipeCd / G.sniperSpec(me).cd
  if (me.trig.includes('teleport')) cds.teleport = me.teleCd / G.TELEPORT_CD
  for (const [t, on] of [['bag', me.bag], ['chameleon', me.cham]]) {
    const c = $('s-' + t); if (c) c.classList.toggle('on', !!on)
    const b = touchBtn[t]; if (b) b.classList.toggle('on', !!on)
  }
  for (const k in cds) {
    const p = Math.round(clamp01(cds[k]) * 100)
    if (hud['cd' + k] === p) continue
    hud['cd' + k] = p
    const chip = $('s-' + k); if (chip) chip.querySelector('.cd').style.transform = `scaleY(${p / 100})`
    const btn = k === 'dash' ? $('tDash') : touchBtn[k]
    const c = btn && btn.querySelector('.cd')
    if (c) c.style.setProperty('--p', p + '%')
    const K = { blade: 'Blade', scorpion: 'Blade', shoot: 'Shoot', hound: 'Shoot', meteora: 'Shoot', pad: 'Pad' }[k]
    if (K && TICKS[K]) {
      const k = K
      const [a0, a1] = TICKS[k]
      const tick = $('k' + k)
      tick.setAttribute('d', arcPath(31, a0, a0 + (a1 - a0) * (1 - p / 100) + 0.6))
      tick.classList.toggle('cool', p > 0)
    }
  }
  if (hud.weapon !== activeW + ':' + weapons.join()) { hud.weapon = activeW + ':' + weapons.join(); showWeapon() }
  if (hud.lockOn !== lockOn) {
    hud.lockOn = lockOn
    // 切り替えた直後だけ出して消す（状態は照準の実線・点線でいつでも分かる）
    $('lockState').classList.remove('show'); void $('lockState').offsetWidth; $('lockState').classList.add('show')
    $('lockState').innerHTML = lockOn ? '<b>ロック</b>敵を自動で追う<kbd>Q</kbd>' : '<b class="off">フリー</b>照準の先を撃つ<kbd>Q</kbd>'
    $('lockState').classList.toggle('off', !lockOn)
    $('tLock').classList.toggle('on', lockOn)
    $('reticle').classList.toggle('free', !lockOn)
  }
  // 空中で出せるエアステップの残り。跳んでいる間だけ出す
  const padLeft = me.alive && !me.grounded ? Math.max(0, G.PAD_MAX - me.padAir) : -1
  if (hud.padLeft !== padLeft) {
    hud.padLeft = padLeft
    for (const id of ['padLeftS', 'padLeftT']) { const e = $(id); if (!e) continue; e.hidden = padLeft < 0; e.textContent = padLeft; e.classList.toggle('zero', padLeft === 0) }
  }
  // 狙撃のため: 照準の下の弧が満ちる
  const ch = sniper && me.alive && me.snipeT >= 0 ? Math.round(Math.min(1, me.snipeT / G.sniperSpec(me).charge) * 100) : -1
  if (hud.ch !== ch) {
    hud.ch = ch
    $('reticle').classList.toggle('charging', ch >= 0)
    if (ch >= 0) $('rCh').setAttribute('d', arcPath(44, CH_ARC[1] - (CH_ARC[1] - CH_ARC[0]) * ch / 100, CH_ARC[1]))
    $('rCh').classList.toggle('full', ch >= 100)
  }
  const t = st.units[me.targetId]
  $('reticle').classList.toggle('locked', !!(me.alive && t && t.alive))
  $('reticle').style.visibility = me.alive ? '' : 'hidden'
  $('hint').hidden = !(mode === 'play' && st.t > 3.2 && st.t < 11 && me.alive && !window.__tsNoHint) // 作戦開始の表示が消えてから出す
}

const tmpV = new THREE.Vector3()
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera)
  return { x: (tmpV.x + 1) / 2 * innerWidth, y: (1 - tmpV.y) / 2 * innerHeight, front: tmpV.z < 1 }
}
const arrowEls = []
// ダメージの数値: 自分が敵に当てたとき、当たった位置に浮かべる。同じ相手への0.25秒以内の命中は1つにまとめて足す
const dmgPops = []
function popDamage(ev) {
  const strong = ev.kind === 'blade' || ev.kind === 'snipe' || ev.kind === 'blast' || ev.kind === 'head'
  let p = dmgPops.find(q => q.target === ev.id && q.t < 0.25 && !q.strong && !strong)
  if (!p) {
    const el = document.createElement('div')
    el.className = 'pop' + (strong ? ' big' : '')
    $('tags').appendChild(el)
    p = { el, target: ev.id, x: ev.x, y: ev.y, z: ev.z, t: 0, amount: 0, strong, dx: (Math.random() - 0.5) * 30 }
    dmgPops.push(p)
  }
  p.amount += ev.amount
  p.t = Math.min(p.t, 0.05)
  p.el.textContent = p.amount < 10 ? p.amount.toFixed(1) : Math.round(p.amount)
  p.el.classList.remove('hit'); void p.el.offsetWidth; p.el.classList.add('hit')
}
function stepDamagePops(dt) {
  for (let i = dmgPops.length - 1; i >= 0; i--) {
    const p = dmgPops[i]
    p.t += dt
    if (p.t > 0.95) { p.el.remove(); dmgPops.splice(i, 1) }
  }
}
function drawDamagePops() {
  for (const p of dmgPops) {
    const q = toScreen(p.x, p.y + 0.4 + p.t * 1.1, p.z)
    p.el.hidden = !q.front
    p.el.style.left = q.x + p.dx + 'px'; p.el.style.top = q.y + 'px'
    p.el.style.opacity = p.t < 0.6 ? 1 : Math.max(0, 1 - (p.t - 0.6) / 0.35)
  }
}
function drawTags(st) {
  drawDamagePops()
  const me = st.units.find(u => u.player)
  const placed = []
  for (const u of st.units) {
    const v = units[u.id]
    if (!v || !u.alive || u.player) continue
    const p = toScreen(u.x, u.y + G.UNIT_H + 0.4, u.z)
    const d = camera.position.distanceTo(tmpV.set(u.x, u.y + 1, u.z))
    // 遠い相手は名前を出さず印だけにする（重なって読めなくなるため）
    v.tag.classList.toggle('far', d > 22 && u.id !== me.targetId)
    v.tag.hidden = !p.front || (u.team === 1 && !G.detectable(st, 0, u))
    v.tagBar.style.transform = `scaleX(${Math.max(0, u.en) / 100})`
    if (p.front) placed.push({ v, x: p.x, y: p.y, d, w: v.tag.offsetWidth, h: v.tag.offsetHeight })
  }
  // 近い順に置き、先に置いた名札と重なるものは上へずらす
  placed.sort((a, b) => a.d - b.d)
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i]
    for (let k = 0; k < 4; k++) {
      const hit = placed.slice(0, i).find(b => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2)
      if (!hit) break
      a.y = hit.y - (a.h + hit.h) / 2 - 2
    }
    a.v.tag.style.left = a.x + 'px'
    a.v.tag.style.top = a.y + 'px'
  }
  const lock = $('lock')
  const t = me && me.alive ? st.units[me.targetId] : null
  if (t && t.alive) {
    const p = toScreen(t.x, t.y + 1.0, t.z)
    lock.hidden = !p.front
    lock.style.left = p.x + 'px'; lock.style.top = p.y + 'px'
  } else lock.hidden = true
  // 画面の外にいる敵の方向
  const enemies = st.units.filter(u => u.team === 1 && u.alive && G.detectable(st, 0, u))
  const w = innerWidth, h = innerHeight
  enemies.forEach((u, i) => {
    let a = arrowEls[i]
    if (!a) {
      a = document.createElement('div')
      a.className = 'arrow'
      a.innerHTML = '<svg viewBox="0 0 22 22"><path d="M11 2l8 14H3z" fill="#ec3b33" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>'
      $('arrows').appendChild(a)
      arrowEls[i] = a
    }
    tmpV.set(u.x, u.y + 1, u.z).applyMatrix4(camera.matrixWorldInverse)
    const behind = tmpV.z > 0
    const p = toScreen(u.x, u.y + 1, u.z)
    const on = !behind && p.x > 30 && p.x < w - 30 && p.y > 30 && p.y < h - 30
    a.hidden = on || !me.alive
    if (on) return
    let ax = tmpV.x, ay = tmpV.y
    if (behind) { ax = tmpV.x || 0.001; ay = -Math.abs(tmpV.y) - 1 } // 後ろは下側に出す
    const ang = Math.atan2(ax, ay)
    const rx = w * 0.4, ry = h * 0.38
    a.style.left = (w / 2 + Math.sin(ang) * rx) + 'px'
    a.style.top = (h / 2 - Math.cos(ang) * ry) + 'px'
    a.style.transform = `rotate(${ang}rad)`
  })
  for (let i = enemies.length; i < arrowEls.length; i++) arrowEls[i].hidden = true
}
// 撃たれた方向を照準の周りに赤い弧で出す
function damageIndicator(src) {
  const me = state.units.find(u => u.player)
  let d = Math.atan2(src.x - me.x, src.z - me.z) - camYaw
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  const el = document.createElement('div')
  el.className = 'dmg'
  el.innerHTML = `<svg viewBox="-80 -80 160 160" style="transform:rotate(${-d}rad)"><path d="${arcPath(70, -22, 22)}" fill="none" stroke="#ec3b33" stroke-width="7" stroke-linecap="round"/></svg>`
  $('dmg').appendChild(el)
  setTimeout(() => el.remove(), 900)
}
function feed(html) {
  const d = document.createElement('div')
  d.className = 'feed plate'
  d.innerHTML = html
  $('feed').prepend(d)
  setTimeout(() => d.remove(), 4200)
  while ($('feed').children.length > 4) $('feed').lastElementChild.remove()
}
function banner(text, sub = '', accent = null) {
  const b = $('banner')
  $('bannerText').textContent = text
  $('bannerSub').textContent = sub
  b.style.setProperty('--accent', accent || 'var(--signal)')
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show')
}
const nameOf = u => (u.player ? 'あなた' : u.name)

// ================================================================ カメラ
const CAM_DIST = 5.8, CAM_HEIGHT = 2.2, CAM_SHOULDER = 1.45
let zoom = 0 // 0..1 狙撃のスコープ
let fovKick = 0
let portrait = false
const camPos = new THREE.Vector3(0, 3, 30)
let camFollowId = -1
const camLook = new THREE.Vector3()
const pivot = new THREE.Vector3(0, 1.5, 26)
let shake = 0
let titleAngle = 0
const ray = new THREE.Ray()
const hitTmp = new THREE.Vector3()
const fwd3 = new THREE.Vector3(), right3 = new THREE.Vector3(), want3 = new THREE.Vector3()
function followTarget(st) {
  const me = st.units.find(u => u.player)
  if (me.alive) return me
  // 退場後は生きている味方を映す
  return st.units.find(u => u.team === 0 && u.alive) || me
}
const angleLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t }
// 狙っている相手が画面の中央に来るように、カメラを自動で回す。
// W で相手に向かい、A・D で相手の周りを回れるので、マウスやスティックで視点を回さずに戦える
function autoAim(dt, st) {
  manualT += dt
  if (mode !== 'play' || manualT < 1.2 || window.__tsNoAuto || !lockOn) return
  const me = st.units.find(u => u.player)
  const t = me && me.alive ? st.units[me.targetId] : null
  if (!t || !t.alive) return
  const d = Math.hypot(t.x - me.x, t.z - me.z)
  if (d > 90 || d < 0.8) return
  camYaw = angleLerp(camYaw, Math.atan2(t.x - me.x, t.z - me.z), Math.min(1, dt * 3.2))
  // 高い所の相手は少し見上げ、低い所の相手は少し見下ろす
  const want = THREE.MathUtils.clamp(0.16 - (t.y - me.y) / Math.max(4, d) * 0.9, PITCH_MIN, 0.6)
  camPitch += (want - camPitch) * Math.min(1, dt * 2)
}
function stepCamera(dt, st) {
  if (mode === 'title') {
    titleAngle += dt * 0.12
    // 大通りの交差点の真ん中で回り込む（四隅の建物まで6m以上ある）
    camPos.set(Math.sin(titleAngle) * 6, 2.4, Math.cos(titleAngle) * 6)
    camLook.set(0, 1.2, 0)
  } else if (st) {
    const f = followTarget(st)
    if (mode === 'over') camYaw += dt * 0.35 // 決着後はゆっくり回り込む
    autoAim(dt, st)
    // 映す相手が替わった（脱出・再出撃）か大きく離れた（ブリンク）ときは寄せずに移す。寄せると途中で建物を通り抜ける
    tmpV.set(f.x, f.y + CAM_HEIGHT, f.z)
    if (f.id !== camFollowId || pivot.distanceTo(tmpV) > 8) { pivot.copy(tmpV); camFollowId = f.id }
    else pivot.lerp(tmpV, Math.min(1, dt * 14))
    const me = st.units.find(u => u.player)
    const zoomWant = mode === 'play' && me.alive && me.snipeT >= 0 ? Math.min(1, me.snipeT / G.sniperSpec(me).charge * 1.6) : 0
    aimAt = me.alive && st.units[me.targetId] && st.units[me.targetId].alive ? st.units[me.targetId] : null
    zoom += (zoomWant - zoom) * Math.min(1, dt * (zoomWant > zoom ? 9 : 14))
    const dist = (portrait ? CAM_DIST + 1.4 : CAM_DIST) * (1 - 0.45 * zoom)
    const shoulder = (portrait ? 0.45 : CAM_SHOULDER) + 0.5 * zoom
    fwd3.set(Math.sin(camYaw) * Math.cos(camPitch), -Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch))
    right3.set(-Math.cos(camYaw), 0, Math.sin(camYaw))
    const origin = tmpV.copy(pivot).addScaledVector(right3, shoulder)
    want3.copy(origin).addScaledVector(fwd3, -dist)
    // 建物に入り込まないように、自機の中心から目標位置へ線を引き、当たる手前で止める。
    // 起点を肩の上にすると、壁際で起点自体が壁に埋まって止まる位置を見失う
    ray.origin.copy(pivot)
    ray.direction.copy(want3).sub(pivot)
    const full = ray.direction.length()
    ray.direction.normalize()
    let maxD = full
    for (const bd of buildings) {
      if (bd.dead) continue
      // 壁際では自機の中心が余白の内側に入るので、そのときは余白なしの箱で測る
      const box = bd.boxPad.containsPoint(pivot) ? bd.box : bd.boxPad
      if (box.containsPoint(pivot)) continue
      if (ray.intersectBox(box, hitTmp)) {
        const dd = hitTmp.distanceTo(pivot)
        if (dd < maxD) maxD = Math.max(0.05, dd - 0.2)
      }
    }
    camPos.copy(pivot).addScaledVector(ray.direction, maxD)
    fadeFollowed(f, maxD, dt)
    // 壁にぴったり背を付けたときは、寄った分だけ上から見下ろして自機の頭に埋まらないようにする
    if (maxD < 1.6) camPos.y += (1.6 - maxD) * 0.9
    camPos.y = Math.max(0.35, camPos.y)
    // まだ箱（入口の梁・階段の段など）の中にいたら、自機の方へ少しずつ寄せて外に出す
    for (let n = 0; n < 24 && buildings.some(bd => !bd.dead && bd.box.containsPoint(camPos)); n++) camPos.lerp(pivot, 0.15)
    // 床や屋上の薄い板の中にカメラが入ったら、板の上に出す（モールの屋上で見下ろすとき）
    for (const bd of buildings) if (!bd.dead && bd.box.max.y - bd.box.min.y < 1 && bd.box.containsPoint(camPos)) camPos.y = bd.box.max.y + 0.3
    camLook.copy(origin).addScaledVector(fwd3, 12)
  }
  shake = Math.max(0, shake - dt * 3)
  // カメラが場外（フェンスの外）にいるときは、外周のフェンスと植え込みを透かす
  const outside = Math.max(Math.abs(camPos.x), Math.abs(camPos.z)) > G.MAP_HALF - 0.5 && mode !== 'title'
  perimeter.opacity += ((outside ? 0.2 : 1) - perimeter.opacity) * Math.min(1, dt * 10)
  perimeter.depthWrite = perimeter.opacity > 0.95
  // カメラと自機の間の建物を透かす
  ray.origin.copy(camPos)
  ray.direction.copy(pivot).sub(camPos)
  const len = ray.direction.length()
  ray.direction.normalize()
  for (const bd of buildings) {
    if (bd.dead) continue
    const hit = mode !== 'title' && ray.intersectBox(bd.box, hitTmp) && hitTmp.distanceTo(camPos) < len - 0.3
    const want = hit ? 0.15 : 1
    bd.fade += (want - bd.fade) * Math.min(1, dt * 12)
    for (const m of bd.mats) { m.opacity = bd.fade; m.depthWrite = bd.fade > 0.95 }
  }
}
// 壁際でカメラが寄ったら、映している機体を透かして画面が機体で埋まらないようにする
const seg = new THREE.Line3(), segPt = new THREE.Vector3()
let aimAt = null // スコープで狙っている相手
function fadeFollowed(f, d, dt) {
  for (const v of units) {
    if (!v) continue
    // 映している機体はカメラとの距離、それ以外はカメラと映している機体の間に割り込んだときに透かす
    let want
    // スコープで寄っている間は自機を薄くして、狙う先を塞がない
    if (v.id === f.id) want = Math.min(THREE.MathUtils.clamp((d - 0.9) / 1.6, 0.18, 1), 1 - 0.82 * zoom)
    else {
      seg.set(camPos, tmpV.set(f.x, f.y + 1, f.z))
      const c = hitTmp.copy(v.root.position).setY(v.root.position.y + 1)
      const t = seg.closestPointToPointParameter(c, true)
      const off = seg.at(t, segPt).distanceTo(c)
      want = (t > 0 && t < 0.92 && off < 1.3) || camPos.distanceTo(c) < 2 ? 0.28 : 1
      // スコープ中は、狙っている敵との間に立つ機体も透かす
      if (want === 1 && zoom > 0.05 && aimAt && v.id !== aimAt.id) {
        seg.set(camPos, tmpV.set(aimAt.x, aimAt.y + 1, aimAt.z))
        const t2 = seg.closestPointToPointParameter(c, true)
        if (t2 > 0 && t2 < 0.97 && seg.at(t2, segPt).distanceTo(c) < 1.2) want = 1 - 0.75 * zoom
      }
    }
    // ミラージュ: 味方には薄く、見つかっていない敵は見えない
    const cu = state && state.units[v.id]
    if (cu && cu.cham) want = Math.min(want, cu.team === 0 ? 0.3 : cu.revealT > 0 ? 0.12 + Math.random() * 0.1 : 0)
    v.near += (want - v.near) * Math.min(1, dt * 12)
    const see = v.near > 0.98
    for (const m of v.mats) {
      if (m.transparent === see) { m.transparent = !see; m.needsUpdate = true }
      m.opacity = see ? 1 : v.near
      m.depthWrite = see
    }
    // 腕の武器・重り・マントも一緒に薄くする（ミラージュで体だけ消えて武器が浮かないように）
    if (!v.gearMats) {
      v.gearMats = []
      for (const g of [v.blade, v.gunMesh, v.rifle, v.cape, ...(v.weightBlocks || [])]) if (g) g.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (!v.gearMats.includes(m)) { m.userData.op0 = m.opacity; m.userData.tr0 = m.transparent; v.gearMats.push(m) } })
    }
    for (const m of v.gearMats) {
      const tr = see ? m.userData.tr0 : true
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true }
      m.opacity = m.userData.op0 * (see ? 1 : v.near)
    }
  }
}
function applyCamera() {
  const w = innerWidth, h = innerHeight
  if (mode === 'title') {
    if (w / h >= 1) camera.setViewOffset(w, h, -w * 0.22, 0, w, h)
    else camera.setViewOffset(w, h, 0, h * 0.2, w, h)
  } else if (camera.view && camera.view.enabled) camera.clearViewOffset()
  // エアステップや踏み込みの瞬間だけ画角を広げて速さを出す
  fovKick = Math.max(0, fovKick - 0.04)
  const fov = baseFov * (1 - 0.55 * zoom) + 9 * Math.sin(Math.min(1, fovKick) * Math.PI / 2)
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }
  $('scope').style.opacity = (zoom * 0.95).toFixed(3)
  camera.position.copy(camPos)
  if (window.__tsCam) { const c = window.__tsCam; camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); return }
  if (shake > 0) {
    const k = shake * shake * 0.12
    camera.position.x += (Math.random() - 0.5) * k
    camera.position.y += (Math.random() - 0.5) * k
  }
  camera.lookAt(camLook)
  const f = state && mode !== 'title' ? followTarget(state) : { x: 0, z: 0 }
  sun.target.position.set(f.x, 0, f.z)
  // 少し傾いた日差しにして影を長くする（高い建物の影が通りに落ちる）
  sun.position.set(f.x + 66, 78, f.z + 42) // 高層ビルの屋上より遠くに置く（手前にあると上の方が影を落とさない）
  skyMat.uniforms.time.value = performance.now() / 1000
}

// ================================================================ 天候（リーグ戦のステージ条件）。見た目と音だけで、ルールは変えない
const WEATHER = {
  clear: { name: '晴れ', top: '#4f86c0', bottom: '#cdd8e1', fog: [60, 420], over: 0, sun: 2.6, hemi: 0.55, exp: 0.9, fall: null },
  storm: { name: '暴風雨', top: '#59626d', bottom: '#8d969e', fog: [25, 230], over: 1, sun: 0.55, hemi: 0.95, exp: 0.82, fall: 'rain' },
  snow: { name: '雪', top: '#8f9cab', bottom: '#dde3e8', fog: [35, 260], over: 0.8, sun: 1.1, hemi: 0.9, exp: 0.95, fall: 'snow' },
}
let weather = 'clear'
try { if (WEATHER[localStorage.getItem('ts-weather')]) weather = localStorage.getItem('ts-weather') } catch {}
const FALL_N = 2600, FALL_BOX = [70, 36, 70]
const fallGeo = new THREE.BufferGeometry()
fallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FALL_N * 2 * 3), 3))
const fallPts = new Float32Array(FALL_N * 3) // 粒の位置（カメラの周りの箱の中を回す）
for (let i = 0; i < FALL_N; i++) { fallPts[i * 3] = (Math.random() - 0.5) * FALL_BOX[0]; fallPts[i * 3 + 1] = Math.random() * FALL_BOX[1]; fallPts[i * 3 + 2] = (Math.random() - 0.5) * FALL_BOX[2] }
const rainMesh = new THREE.LineSegments(fallGeo, new THREE.LineBasicMaterial({ color: '#b4c2d0', transparent: true, opacity: 0.62, depthWrite: false }))
const snowMesh = new THREE.Points(fallGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.22, transparent: true, opacity: 0.9, depthWrite: false }))
rainMesh.frustumCulled = snowMesh.frustumCulled = false
rainMesh.visible = snowMesh.visible = false
scene.add(rainMesh, snowMesh)
function applyWeather(w) {
  weather = WEATHER[w] ? w : 'clear'
  try { localStorage.setItem('ts-weather', weather) } catch {}
  const W = WEATHER[weather]
  skyMat.uniforms.top.value.set(W.top)
  HORIZON.set(W.bottom); scene.fog.color.copy(HORIZON)
  scene.fog.near = W.fog[0]; scene.fog.far = W.fog[1]
  skyMat.uniforms.overcast.value = W.over
  sun.intensity = W.sun; hemi.intensity = W.hemi; renderer.toneMappingExposure = W.exp
  scene.environmentIntensity = 0.6 * (1 - W.over * 0.5)
  rainMesh.visible = W.fall === 'rain'; snowMesh.visible = W.fall === 'snow'
  setWeatherAudio(weather)
  for (const b of document.querySelectorAll('.wx')) b.setAttribute('aria-pressed', String(b.dataset.w === weather))
}
function stepWeather(dt) {
  const W = WEATHER[weather]
  if (!W.fall) return
  const rain = W.fall === 'rain', p = fallGeo.attributes.position.array
  const cx = camPos.x, cy = camPos.y - 8, cz = camPos.z, t = performance.now() / 1000
  const vy = rain ? 32 : 1.6, wind = rain ? 7 : 0.6
  for (let i = 0; i < FALL_N; i++) {
    const k = i * 3
    fallPts[k + 1] -= vy * dt * (0.8 + (i % 5) * 0.08)
    fallPts[k] += wind * dt + (rain ? 0 : Math.sin(t * 1.3 + i) * 0.4 * dt)
    if (fallPts[k + 1] < 0) fallPts[k + 1] += FALL_BOX[1]
    for (const a of [0, 2]) { const h = FALL_BOX[a] / 2; if (fallPts[k + a] > h) fallPts[k + a] -= FALL_BOX[a]; if (fallPts[k + a] < -h) fallPts[k + a] += FALL_BOX[a] }
    // カメラについて回る箱の中の位置（箱の端で折り返す）
    const x = cx + fallPts[k], y = cy + fallPts[k + 1], z = cz + fallPts[k + 2]
    const j = i * 6
    p[j] = x; p[j + 1] = y; p[j + 2] = z
    if (rain) { p[j + 3] = x - wind * 0.035; p[j + 4] = y + 0.9; p[j + 5] = z } else { p[j + 3] = x; p[j + 4] = y; p[j + 5] = z }
  }
  fallGeo.attributes.position.needsUpdate = true
}

// 実況: 試合の節目を短い一言で流す（リーグ戦の実況席の代わり）
let callTimer = 0
function call(text) {
  const el = $('call')
  el.innerHTML = `<b>実況</b>${text}`
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show')
  clearTimeout(callTimer); callTimer = setTimeout(() => el.classList.remove('show'), 3200)
}
let callState = {}

// ================================================================ 建物の破壊
// 削られるほど壁が暗く煤ける。崩れたら沈みながら土煙を上げ、がれきの山に置き換わる
const collapsing = [], rubbleMeshes = []
const rubbleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
function tintBuilding(bd, ratio) {
  const k = 0.5 + 0.5 * ratio
  for (const m of bd.mats) { if (!m.userData.col0) m.userData.col0 = m.color.clone(); m.color.copy(m.userData.col0).multiplyScalar(k) } // 元の色を暗くする（白で上書きしない）
}
function startCollapse(ev) {
  const bd = buildings.find(x => x.id === ev.id)
  if (!bd || bd.dead) return
  bd.dead = true
  collapsing.push({ bd, t: 0, ev })
  SFX.collapse(Math.max(0.35, vol(ev.x, ev.z)))
  const me = state.units.find(u => u.player)
  const d = Math.hypot(me.x - ev.x, me.z - ev.z)
  if (d < 70) shake = Math.max(shake, 1.2 * (1 - d / 70) + 0.3)
  // がれき: 壁の色に近い大小の塊をばらまく（当たり判定は game.js の高さ1.2mの箱）
  const geos = [], col = new THREE.Color()
  const n = Math.min(70, Math.round(ev.w * ev.d / 5))
  for (let i = 0; i < n; i++) {
    const s = 0.5 + Math.random() * 1.6
    const g = new THREE.BoxGeometry(s, s * (0.4 + Math.random() * 0.6), s * (0.6 + Math.random() * 0.8))
    g.rotateX(Math.random() * 0.8); g.rotateY(Math.random() * 3); g.rotateZ(Math.random() * 0.8)
    g.translate(ev.x + (Math.random() - 0.5) * (ev.w - 1.4), Math.random() * 0.9, ev.z + (Math.random() - 0.5) * (ev.d - 1.4))
    col.setHSL(0.08, 0.05, 0.34 + Math.random() * 0.22)
    const c = new Float32Array(g.attributes.position.count * 3); for (let j = 0; j < c.length; j += 3) { c[j] = col.r; c[j + 1] = col.g; c[j + 2] = col.b }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv')
    geos.push(g)
  }
  const m = new THREE.Mesh(mergeGeometries(geos, false), rubbleMat)
  m.castShadow = m.receiveShadow = true
  m.position.y = -1.6 // 建物が沈むのに合わせて下からせり上がる
  m.userData.rise = true
  scene.add(m); rubbleMeshes.push(m)
  bd.rubble = m
  // 跡地の地面（建物の下は路面の絵が無いので、砕けたコンクリートの床を敷く）
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ev.w, ev.d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#77736d', roughness: 1 }))
  floor.position.set(ev.x, 0.025, ev.z); floor.receiveShadow = true
  scene.add(floor); rubbleMeshes.push(floor)
}
function stepCollapse(dt) {
  for (let i = collapsing.length - 1; i >= 0; i--) {
    const c = collapsing[i]
    c.t += dt
    const k = c.t * c.t * 6 // 加速しながら沈む
    for (const o of c.bd.objs) { o.position.y = (o.userData.y0 ??= o.position.y) - k; o.rotation.z = Math.sin(c.t * 30) * 0.004 }
    if (c.bd.rubble) c.bd.rubble.position.y = Math.min(0, -1.6 + c.t * 1.4)
    // 土煙: 足元の周りから
    if (Math.random() < 0.9) { const e = c.ev; burst(e.x + (Math.random() - 0.5) * e.w, 0.5, e.z + (Math.random() - 0.5) * e.d, 5, '#cbbfae', 4, 0.5, 3, -0.5, 1.6) }
    if (k > c.ev.h + 2) { for (const o of c.bd.objs) o.visible = false; collapsing.splice(i, 1) }
  }
}
// 新しい試合: 建物を元に戻す
function resetCity() {
  collapsing.length = 0
  for (const m of rubbleMeshes) { scene.remove(m); m.geometry.dispose(); if (m.material !== rubbleMat) m.material.dispose() }
  rubbleMeshes.length = 0
  for (const bd of buildings) {
    bd.dead = false; bd.rubble = null
    for (const o of bd.objs) { if (o.userData.y0 !== undefined) o.position.y = o.userData.y0; o.rotation.z = 0; o.visible = true }
    tintBuilding(bd, 1)
  }
}

// ================================================================ 進行
let mode = 'loading' // loading | title | play | over | result
let state = null
let hitstop = 0
let overT = 0
let titleUnits = null

function setupTitle() {
  // タイトル: 自隊の3人が並ぶ
  state = G.createState(1, { triggers: myTrig, stage: stageKey })
  clearUnits()
  for (const u of state.units) makeUnitView(u)
  for (const u of state.units) {
    const v = units[u.id]
    v.tag.hidden = true
    if (u.team === 1) v.root.visible = false
  }
  const pose = [{ x: 0, z: 0, yaw: 0.25 }, { x: -2.2, z: -1, yaw: 0.6 }, { x: 2.2, z: -0.8, yaw: -0.3 }]
  state.units.filter(u => u.team === 0).forEach((u, i) => { u.x = pose[i].x; u.z = pose[i].z; u.yaw = pose[i].yaw })
  titleUnits = state.units.filter(u => u.team === 0)
  const v0 = units[0]
  playOverlay(v0, 'Wave', 1)
  v0.overlayW = 1
}

// スマホ: 試合中に縦持ちなら横にするよう促す。Android は全画面にして横向きに固定する（iPhone のブラウザは固定できない）
const portraitQ = matchMedia('(orientation: portrait)')
function updateRotate() { $('rotate').hidden = !(isTouch && portraitQ.matches && mode === 'play') }
portraitQ.addEventListener ? portraitQ.addEventListener('change', updateRotate) : portraitQ.addListener(updateRotate)
function lockLandscape() {
  if (!isTouch) return
  try {
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen
    const lock = () => { try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => {}) } catch {} }
    if (req && !document.fullscreenElement) { const p = req.call(el); if (p && p.then) p.then(lock).catch(() => {}); else lock() } else lock()
  } catch {}
}
function startGame() {
  ensureAudio()
  lockLandscape()
  if (mode === 'play') return
  clearUnits()
  for (const m of padMeshes) scene.remove(m)
  padMeshes.length = 0
  for (const c of cubeFlashes) scene.remove(c.mesh)
  cubeFlashes.length = 0
  for (const b of beams) for (const m of b.parts) scene.remove(m)
  for (const p of dmgPops) p.el.remove()
  dmgPops.length = 0
  pings.length = 0
  resetCity()
  toggleBigMap(false)
  beams.length = 0
  fx.length = 0
  state = G.createState(Date.now(), { triggers: myTrig, ammo: myAmmo, stats: myStats, statBonus: statBonus(), sense: mySense, stage: stageKey, ...(window.__tsOpts || {}) })
  for (const u of state.units) makeUnitView(u)
  hud = {}
  buildPips()
  for (const k in pressed) pressed[k] = false
  mode = 'play'
  overT = 0
  $('title').hidden = true
  $('result').hidden = true
  $('hud').hidden = false
  $('spectate').hidden = true
  $('dock').hidden = false
  $('me').hidden = false
  $('touch').hidden = !isTouch
  setTimeout(updateRotate, 0)
  const me = state.units.find(u => u.player)
  camYaw = me.yaw
  camPitch = 0.16
  pivot.set(me.x, me.y + CAM_HEIGHT, me.z)
  let round = 1
  try { round = (+localStorage.getItem('ts-round') || 0) + 1; localStorage.setItem('ts-round', round) } catch {}
  banner('作戦開始', `リーグ戦 ROUND ${round}　${G.STAGES[stageKey].name}　${WEATHER[weather].name}`, 'var(--blue)')
  callState = { first: false, min1: false }
  setTimeout(() => { if (mode === 'play') call(`ステージは${G.STAGES[stageKey].name}、天候は${WEATHER[weather].name}。各隊員、ばらばらの位置から出撃しました`) }, 1600)
}

function handleEvents(events) {
  const st = state
  for (const ev of events) {
    hearEvent(st, ev)
    const u = ev.id !== undefined ? st.units[ev.id] : null
    const v = u ? units[u.id] : null
    const k = ev.x !== undefined ? vol(ev.x, ev.z) : (u ? vol(u.x, u.z) : 1)
    setAudioPos(ev.x ?? (u && u.x), ev.z ?? (u && u.z))
    switch (ev.type) {
      case 'blade': if (v) v.slash.material.opacity = 0.85; SFX.blade(k, ev.melee === 'scorpion'); if (u.player) fovKick = Math.max(fovKick, 0.5); break
      case 'bag': if (u.player || u.team === 0) SFX.bag(k); break
      case 'dash': {
        SFX.dash(k)
        if (u.player) fovKick = Math.max(fovKick, 0.8)
        // 残像: 隊の色の粒を通り道に残す
        for (let i = 0; i < 14; i++) fx.push({ x: ev.x + (Math.random() - 0.5) * 0.5, y: ev.y + 0.3 + Math.random() * 1.4, z: ev.z + (Math.random() - 0.5) * 0.5, vx: -u.dashX * (2 + Math.random() * 3), vy: 0.3, vz: -u.dashZ * (2 + Math.random() * 3), life: 0.4, max: 0.4, size: 0.12, color: TEAM_LIGHT[u.team], g: 0, rot: 0 })
        break
      }
      case 'charge': if (u.player || u.team !== 0) SFX.charge(Math.max(0.5, k), G.sniperSpec(u).charge); break
      case 'explode': {
        burst(ev.x, ev.y, ev.z, Math.round(10 + ev.r * 6), '#ff9a3c', 3 + ev.r * 1.6, 0.1 + ev.r * 0.02, 3, 5, 0.45)
        burst(ev.x, ev.y, ev.z, 14, '#fff3d6', 6, 0.12, 2, 6, 0.3)
        SFX.boom(Math.max(0.3, k))
        const me = st.units.find(x => x.player)
        if (me && Math.hypot(me.x - ev.x, me.z - ev.z) < 12) shake = Math.max(shake, 0.6)
        break
      }
      case 'teleport': {
        burst(ev.x, ev.y + 1, ev.z, 14, TEAM_LIGHT[u.team], 4, 0.1, 2, 4, 0.35)
        burst(ev.tx, ev.ty + 1, ev.tz, 14, TEAM_LIGHT[u.team], 4, 0.1, 2, 4, 0.35)
        SFX.tele(k)
        if (u.player) { fovKick = Math.max(fovKick, 1); pivot.set(ev.tx, ev.ty + CAM_HEIGHT, ev.tz) }
        break
      }
      case 'cham': if (u.player || u.team === 0) SFX.cham(k); break
      case 'snipe': {
        if (u.player) window.__tsLastSnipe = ev
        spawnBeam(ev.x, ev.y, ev.z, ev.hx, ev.hy, ev.hz, u.team, ev.charge, ev.gun === 'ibis' ? 2.2 : ev.gun === 'lightning' ? 0.5 : 1, SNIPE_COL[ev.gun])
        burst(ev.hx, ev.hy, ev.hz, ev.hit >= 0 ? 6 : 10, '#fff6dd', 5, 0.09, 2, 8, 0.3)
        SFX.snipe(Math.max(0.45, k), ev.gun)
        if (u.player) shake = Math.max(shake, 0.5)
        break
      }
      case 'shoot': {
        const m = new THREE.Mesh(cubeGeo, new THREE.MeshBasicMaterial({ color: ev.gun === 'launcher' ? shellCol : ammoCol[ev.ammo] || bulletCol[u.team], transparent: true, toneMapped: false }))
        m.position.set(ev.x, ev.y, ev.z)
        scene.add(m)
        cubeFlashes.push({ mesh: m, t: 0 })
        SFX.shoot(k, ev.gun)
        break
      }
      case 'hit': {
        const src = st.units[ev.src]
        if (!callState.first) { callState.first = true; call('両隊が接触。戦闘が始まりました') }
        if (src && src.player && u.team !== src.team) popDamage(ev)
        // 傷から飛び散るものは青
        if (ev.kind === 'blade') {
          burst(ev.x, ev.y, ev.z, 18, '#4aa8ff', 8, 0.12, 3, 6, 0.35)
          burst(ev.x, ev.y, ev.z, 8, '#bfe4ff', 6, 0.09, 3, 6, 0.3)
          SFX.hitBlade(k)
          if (u.player || (src && src.player)) { hitstop = 4; shake = 0.8 }
        } else if (ev.kind === 'snipe') {
          burst(ev.x, ev.y, ev.z, 24, '#4aa8ff', 9, 0.13, 3, 6, 0.4)
          burst(ev.x, ev.y, ev.z, 12, '#bfe4ff', 6, 0.1, 2, 4, 0.5)
          SFX.hitSnipe(Math.max(0.5, k))
          if (u.player || (src && src.player)) { hitstop = 5; shake = Math.max(shake, 1.0) }
        } else {
          burst(ev.x, ev.y, ev.z, 3, '#6cb8ff', 4, 0.08, 2, 6, 0.25)
          SFX.hitBullet(k)
        }
        if (u.player) {
          shake = Math.max(shake, ev.kind === 'bullet' ? 0.35 : 1.0)
          $('flash').classList.add('on')
          setTimeout(() => $('flash').classList.remove('on'), 60)
          if (src) damageIndicator(src)
        }
        break
      }
      case 'bhit': { const bd = buildings.find(x => x.id === ev.id); if (bd) tintBuilding(bd, ev.ratio); break }
      case 'collapse': startCollapse(ev); call('建物が崩れ落ちました'); break
      case 'spark': burst(ev.x, ev.y, ev.z, 3, '#fff6dd', 3, 0.07, 2, 8, 0.25); break
      case 'pad': {
        if (u.player) fovKick = Math.max(fovKick, 1)
        const m = new THREE.Mesh(padGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM_LIGHT[u.team]).multiplyScalar(1.2), transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }))
        m.position.set(ev.x, ev.y + 0.05, ev.z)
        m.rotation.y = u.yaw
        scene.add(m)
        padMeshes.push(m)
        m.userData.t = 0
        burst(ev.x, ev.y + 0.1, ev.z, 10, TEAM_LIGHT[u.team], 4, 0.1, 1, 4, 0.35)
        SFX.pad(k)
        break
      }
      case 'jump': SFX.jump(k); break
      case 'land': if (ev.hard) burst(ev.x, ev.y + 0.05, ev.z, 8, '#d9dde2', 3, 0.12, 1, 6, 0.35); if (u && (u.player || k > 0.5)) SFX.land(ev.hard ? k : k * 0.4); break
      case 'bailout': {
        spawnBailout(ev.x, ev.y, ev.z, ev.team, u.player || !!(st.units[ev.killer] && st.units[ev.killer].player))
        SFX.bailout()
        const killer = st.units[ev.killer]
        {
          const side = t => t === 0 ? '自隊' : '敵隊'
          const who = u.player ? 'あなた' : `${side(u.team)}の${u.name}`
          call(killer && killer.team !== u.team ? `${who}が強制帰還。${side(killer.team)}に1点、${st.score[0]}対${st.score[1]}` : `${who}が強制帰還`)
        }
        feed(`<svg><use href="#i-out"/></svg><span class="t${u.team}">${nameOf(u)}</span>強制帰還${killer ? `<span class="by">${nameOf(killer)}</span>` : ''}`)
        if (u.player) {
          banner('強制帰還', killer && killer.team !== u.team ? `${killer.name}の${(TRIG_INFO[ev.how] || {}).name || '攻撃'}で倒された ・ ${G.respawnT(u)}秒後に再出撃` : `${G.respawnT(u)}秒後に再出撃`, 'var(--red)')
          $('touch').hidden = true
          $('dock').hidden = true
          $('me').hidden = true
          $('spectate').hidden = false
        } else if (killer && killer.player) banner('撃破', `${u.name} を${(TRIG_INFO[ev.how] || {}).name || ''}で強制帰還させた`, 'var(--blue)')
        break
      }
      case 'respawn': {
        burst(ev.x, ev.y + 1, ev.z, 16, TEAM_LIGHT[u.team], 5, 0.12, 2, 4, 0.5)
        if (u.player) {
          banner('再出撃', '', 'var(--blue)')
          $('spectate').hidden = true
          $('dock').hidden = false
          $('me').hidden = false
          $('touch').hidden = !isTouch
          camYaw = u.yaw + Math.PI
          SFX.pad(1)
        }
        break
      }
      case 'overtime': banner('延長戦', '次に撃破した隊の勝ち', 'var(--signal)'); call(`${st.score[0]}対${st.score[1]}の同点。延長戦は次の1点で決まります`); break
      case 'over': {
        mode = 'over'
        overT = 0
        $('touch').hidden = true
        $('spectate').hidden = true
        $('dock').hidden = true
        const win = ev.winner === 0
        banner(ev.winner === -1 ? '引き分け' : win ? '勝利' : '敗北', ev.reason === 'overtime' ? '延長戦で決着' : 'タイムアップ', win ? 'var(--blue)' : ev.winner === 1 ? 'var(--red)' : null)
        if (win) SFX.win(); else SFX.lose()
        call(ev.winner === -1 ? `${st.score[0]}対${st.score[1]}、引き分けで試合終了` : `${st.score[0]}対${st.score[1]}、${ev.winner === 0 ? '自隊' : '敵隊'}の勝利です`)
        if (pointerLocked) document.exitPointerLock()
        for (const x of st.units) {
          if (!x.alive) continue
          playOverlay(units[x.id], x.team === ev.winner ? (x.player ? 'Dance' : 'ThumbsUp') : 'No', 1)
        }
        break
      }
    }
  }
}

function showResult() {
  mode = 'result'
  updateRotate()
  const st = state
  const head = $('resHead')
  $('resTitle').textContent = st.winner === -1 ? '引き分け' : st.winner === 0 ? '勝利' : '敗北'
  head.className = 'r-head ' + (st.winner === 0 ? 'win' : st.winner === 1 ? 'lose' : '')
  $('resSub').textContent = `${st.endReason === 'overtime' ? '延長戦で決着' : 'タイムアップ'}　試合時間 ${fmtTime(st.t)}`
  $('resS0').textContent = st.score[0]
  $('resS1').textContent = st.score[1]
  // 経験値: 出撃20 ＋ 撃破1人15 ＋ 勝ち40
  const me = st.units.find(u => u.player)
  const gain = 20 + me.kills * 15 + (st.winner === 0 ? 40 : 0), lv0 = levelOf(myXp)
  myXp += gain; save('ts-xp', myXp)
  const lv1 = levelOf(myXp)
  $('resNote').textContent = `+${gain} XP` + (lv1 > lv0 ? `　Lv.${lv1} に上がった。ステータスの点が1増えた` : `　Lv.${lv1}`)
  renderStats()
  for (const team of [0, 1]) {
    $('resT' + team).innerHTML = st.units.filter(u => u.team === team).map(u =>
      `<div class="r-row plate${u.alive ? '' : ' out'}${u.player ? ' me' : ''}"><span>${nameOf(u)}</span><span class="k">${u.kills}<small>撃破</small></span><span class="st">${u.deaths}回 脱出</span></div>`).join('')
  }
  $('hud').hidden = true
  $('result').hidden = false
}

function fixedStep() {
  const dt = G.STEP
  let frozen = false
  if (mode === 'play' && state) {
    if (hitstop > 0) { hitstop--; frozen = true }
    else {
      const input = { ...readInput(), ...pressed }
      for (const k in pressed) pressed[k] = false
      G.step(state, input)
      handleEvents(G.drainEvents(state))
    }
  } else if (mode === 'over' && state) {
    G.step(state, {})
    G.drainEvents(state)
    overT += dt
    if (overT > 3.0) showResult()
  }
  if (state) {
    for (const u of state.units) {
      const v = units[u.id]
      if (v) stepUnitView(dt, u, v, frozen)
    }
  }
  if (mode === 'title' && titleUnits) for (const u of titleUnits) stepUnitView(dt, u, units[u.id], false)
  stepFx(dt)
  stepBailFx(dt)
  stepBeams(dt)
  stepDamagePops(dt)
  stepPings(dt)
  stepCollapse(dt)
  for (let i = cubeFlashes.length - 1; i >= 0; i--) {
    const c = cubeFlashes[i]
    c.t += dt
    c.mesh.scale.setScalar(1 + c.t * 4)
    c.mesh.material.opacity = 1 - c.t / 0.12
    c.mesh.rotation.set(c.t * 9, c.t * 7, 0)
    if (c.t > 0.12) { scene.remove(c.mesh); c.mesh.material.dispose(); cubeFlashes.splice(i, 1) }
  }
  for (let i = padMeshes.length - 1; i >= 0; i--) {
    const m = padMeshes[i]
    m.userData.t += dt
    m.material.opacity = 0.9 * (1 - m.userData.t / 1.2)
    if (m.userData.t > 1.2) { scene.remove(m); m.material.dispose(); padMeshes.splice(i, 1) }
  }
  stepCamera(dt, state)
  stepWeather(dt) // カメラの位置が決まってから、その周りに粒を回す
}

const bulletDummy = new THREE.Object3D()
function drawWorld() {
  const st = state
  if (st && mode !== 'title') {
    for (let i = 0; i < BULLET_MAX; i++) {
      const b = st.bullets[i]
      if (!b) { bulletDummy.scale.setScalar(0) } else {
        bulletDummy.position.set(b.x, b.y, b.z)
        bulletDummy.rotation.set(b.life * 20, b.life * 13, 0)
        bulletDummy.scale.setScalar(b.big ? 3.2 : b.blast ? 1.5 : 1)
        bulletMesh.setColorAt(i, b.big ? shellCol : ammoCol[b.kind] || bulletCol[b.team])
      }
      bulletDummy.updateMatrix()
      bulletMesh.setMatrixAt(i, bulletDummy.matrix)
    }
    bulletMesh.instanceMatrix.needsUpdate = true
    if (bulletMesh.instanceColor) bulletMesh.instanceColor.needsUpdate = true
    drawAimLines(st)
  } else for (const L of aimLines) L.visible = false
  drawFx()
}

function render() {
  applyCamera()
  renderer.render(scene, camera)
  // 札と矢印はカメラを決めた後に置く
  if (state && (mode === 'play' || mode === 'over')) { drawHud(state); drawTags(state) }
}

// ================================================================ ループ
let acc = 0
let paused = false
let last = performance.now()
function frame(now) {
  requestAnimationFrame(frame)
  let delta = (now - last) / 1000
  last = now
  if (delta > 0.25) delta = 0.25
  acc += delta * (slowmo > 0 ? 0.3 : 1) // 強制帰還の瞬間だけゆっくり
  slowmo = Math.max(0, slowmo - delta)
  if (paused) acc = 0
  let guard = 0
  while (acc >= G.STEP && guard < 10) { fixedStep(); acc -= G.STEP; guard++ }
  if (guard >= 10) acc = 0
  drawWorld()
  render()
}

let baseFov = 62
function resize() {
  const w = innerWidth, h = innerHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  portrait = w / h < 0.8
  baseFov = portrait ? 72 : 62
  camera.fov = baseFov * (1 - 0.55 * zoom)
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

$('startBtn').addEventListener('click', startGame)
// ================================================================ ホーム（出撃・編成・ステージ・操作）
// ギアは4つまで。近接・銃・狙撃は1つずつ。攻撃用は試合中に武器スロットで持ち替え、補助は専用のボタン
const TRIG_INFO = {
  blade: { name: 'ブロードセイバー', icon: 'i-blade', desc: '重い一太刀' },
  scorpion: { name: 'スティンガー', icon: 'i-scorpion', desc: '軽く速い刃' },
  handgun: { name: 'ハンドガン', icon: 'i-handgun', desc: '動いても正確・頭は1.5倍' },
  rifle: { name: 'アサルトライフル', icon: 'i-rifle', desc: '速い連射・撃つほど散る' },
  shotgun: { name: 'ショットガン', icon: 'i-shotgun', desc: '近距離で押し返す' },
  launcher: { name: 'グレネード', icon: 'i-launcher', desc: '弧を描いて爆発' },
  snipe: { name: 'ロングショット', icon: 'i-snipe', desc: '標準の狙撃銃' },
  lightning: { name: 'ラピッドショット', icon: 'i-lightning', desc: '速いが軽い' },
  ibis: { name: 'ヘビーショット', icon: 'i-ibis', desc: '遅いが重い' },
  pad: { name: 'エアステップ', icon: 'i-pad', key: 'E', desc: '空中の足場' },
  bag: { name: 'ステルスマント', icon: 'i-bag', key: 'C', desc: 'レーダーに映らない' },
  chameleon: { name: 'ミラージュ', icon: 'i-chameleon', key: 'V', desc: '姿を消す' },
  teleport: { name: 'ブリンク', icon: 'i-teleport', key: 'F', desc: '20m 先へ跳ぶ' },
}
const TRIG_ORDER = ['blade', 'scorpion', 'handgun', 'rifle', 'shotgun', 'launcher', 'snipe', 'lightning', 'ibis', 'pad', 'bag', 'chameleon', 'teleport'] // 表示・スロットの並び順
const HOLD = t => G.TRIGGER_CLASS[t] === 'sniper' // 長押しでためるもの
const PRESETS = { attacker: ['blade', 'pad', 'bag'], allround: ['blade', 'handgun', 'pad', 'bag'], sniper: ['snipe', 'rifle', 'pad', 'bag'], all: ['blade', 'rifle', 'snipe', 'pad'] }
const SENSE_INFO = { hawk: ['鷹の目', 'レーダーが50m→65m。見えない敵の音の印も長く残る'], rally: ['再起', '再出撃までが8秒→5秒'], precise: ['精密', 'どの銃・狙撃でも、頭に当たると1.3倍'], adversity: ['逆境', 'EN が3割を切ると、攻撃+20%・足+10%'] }
const AMMO_NAME = { normal: '通常弾', homing: '追尾弾', blast: '炸裂弾', curve: '曲射弾', weight: '重り弾' }
const STAT_INFO = { spd: ['機動', '走る速さ'], en: ['EN量', '体力と弾の量（80〜120）'], atk: ['攻撃', '与えるダメージ'], jmp: ['跳躍', 'ジャンプの高さ'] }
const load = (k, f) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? f } catch { return f } }
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
let myTrig = PRESETS.allround
{ const saved = G.validTriggers(load('ts-trig', null)); if (saved) myTrig = saved; else if (localStorage.getItem('ts-loadout') === 'sniper') myTrig = PRESETS.sniper }
let mySense = G.SENSES.includes(load('ts-sense', null)) ? load('ts-sense', null) : null
let myAmmo = G.AMMO[load('ts-ammo', 'normal')] ? load('ts-ammo', 'normal') : 'normal'
// レベル: 試合ごとの経験値で上がる。1つ上がるごとにステータスの点が1増える（3点まで）
const LV_XP = [100, 260, 480]
let myXp = +load('ts-xp', 0) || 0
const levelOf = xp => 1 + LV_XP.filter(t => xp >= t).length
const statBonus = () => Math.min(G.STAT_BONUS_MAX, levelOf(myXp) - 1)
let myStats = G.validStats(load('ts-stats', null), statBonus())
const sorted = t => TRIG_ORDER.filter(x => t.includes(x))
const atkTrig = t => G.ATTACK_TRIGGERS.includes(t)
function setTriggers(list) {
  const v = G.validTriggers(list)
  if (!v) return false
  myTrig = sorted(v)
  save('ts-trig', myTrig)
  weapons = myTrig.filter(atkTrig); supports = myTrig.filter(t => !atkTrig(t))
  activeW = Math.min(activeW, Math.max(0, weapons.length - 1))
  for (const b of document.querySelectorAll('.tp')) b.setAttribute('aria-pressed', String(myTrig.includes(b.dataset.t)))
  $('trigCount').textContent = `${myTrig.length} / ${G.TRIGGER_SLOTS}`
  for (const b of document.querySelectorAll('.pre')) b.setAttribute('aria-pressed', String(PRESETS[b.dataset.p].join() === myTrig.join()))
  const help = [['WASD', '移動'], ['左クリック / J', '攻撃（いまの武器）'], ['1 2 3 / ホイール / 右クリック', '武器の持ち替え'], ...supports.map(t => [TRIG_INFO[t].key, TRIG_INFO[t].name]),
    ['Shift', 'ダッシュ'], ['Space', 'ジャンプ'], ['マウス', '視点'], ['Q', '狙いの固定を外す'], ['Tab', '狙う敵を変える'], ['M', '全体地図']]
  $('keysHelp').innerHTML = help.map(([k, t]) => `<span class="nb"><kbd class="k">${k}</kbd>${t}</span>`).join('　')
  // 試合中の札: 武器スロット（数字キー）・ダッシュ・補助
  const chip = (id, icon, name, key, extra = '') => `<div class="trig plate" id="s-${id}"><svg><use href="#${icon}"/></svg><span class="nm">${name}</span><kbd>${key}</kbd><div class="cd"></div>${extra}</div>`
  $('dock').innerHTML = weapons.map((t, i) => chip(t, TRIG_INFO[t].icon, TRIG_INFO[t].name, String(i + 1))).join('')
    + '<span class="dock-gap" aria-hidden="true"></span>' + chip('dash', 'i-dash', 'ダッシュ', 'Shift')
    + supports.map(t => chip(t, TRIG_INFO[t].icon, TRIG_INFO[t].name, TRIG_INFO[t].key, t === 'pad' ? '<b class="left" id="padLeftS" hidden></b>' : '')).join('')
  // スマホ: 大きいボタン＝攻撃、その左＝持ち替え、まわり＝補助
  touchBtn = {}
  $('tShoot').hidden = weapons.length < 2
  const badge = $('padLeftT')
  SUP_SLOTS.forEach((id, i) => {
    const btn = $(id), t = supports[i]
    btn.hidden = !t
    if (!t) return
    touchBtn[t] = btn
    btn.querySelector('use').setAttribute('href', '#' + TRIG_INFO[t].icon)
    btn.setAttribute('aria-label', TRIG_INFO[t].name)
    if (t === 'pad') btn.appendChild(badge)
  })
  hud = {}
  updateSummary()
  return true
}
// いまの武器を、札・攻撃ボタン・持ち替えボタンに出す
function showWeapon() {
  const w = weapons[activeW]
  for (const [i, t] of weapons.entries()) { const c = $('s-' + t); if (c) c.classList.toggle('active', i === activeW) }
  if (w) { $('tBlade').querySelector('use').setAttribute('href', '#' + TRIG_INFO[w].icon); $('tBlade').setAttribute('aria-label', TRIG_INFO[w].name + (HOLD(w) ? '（長押しでため、離して撃つ）' : '')) }
  const nx = weapons[(activeW + 1) % weapons.length]
  if (nx) $('tShoot').querySelector('use').setAttribute('href', '#' + TRIG_INFO[nx].icon)
}
function updateSummary() {
  const gun = myTrig.find(t => G.TRIGGER_CLASS[t] === 'gun')
  $('miLoadout').innerHTML = myTrig.map(t => `<svg class="mini" aria-label="${TRIG_INFO[t].name}"><use href="#${TRIG_INFO[t].icon}"/></svg>`).join('') + (gun ? `<em>${AMMO_NAME[myAmmo]}</em>` : '') + (mySense ? `<svg class="mini" aria-label="${SENSE_INFO[mySense][0]}"><use href="#i-sense-${mySense}"/></svg><em>${SENSE_INFO[mySense][0]}</em>` : '')
  $('miStage').textContent = `${G.STAGES[stageKey].name}・${WEATHER[weather].name}`
  $('startSub').textContent = `${G.STAGES[stageKey].name} ・ ${WEATHER[weather].name}`
  for (const b of document.querySelectorAll('.am:not(.sx)')) b.setAttribute('aria-pressed', String(b.dataset.a === myAmmo))
  for (const b of document.querySelectorAll('.sx')) b.setAttribute('aria-pressed', String(b.dataset.s === (mySense || '')))
  $('ammoNote').textContent = gun ? `${TRIG_INFO[gun].name}に込める弾。枠は使わない` : '銃を組むと使える（今は銃が入っていない）'
  for (const b of document.querySelectorAll('.sg')) b.setAttribute('aria-pressed', String(b.dataset.s === stageKey))
  renderStats()
}
function renderStats() {
  const total = G.STAT_TOTAL + statBonus()
  const used = G.STAT_KEYS.reduce((a, k) => a + myStats[k], 0), left = total - used
  $('statLeft').textContent = left
  const lv = levelOf(myXp), nxt = LV_XP[lv - 1], prev = LV_XP[lv - 2] || 0
  $('lvNum').textContent = `Lv.${lv}`
  $('lvBar').style.width = nxt ? `${Math.round((myXp - prev) / (nxt - prev) * 100)}%` : '100%'
  $('lvNext').textContent = nxt ? `次のレベルまで ${nxt - myXp} XP（上がるとステータス+1）` : '最大レベル（ステータス+3）'
  $('statTotal').textContent = `合計${total}点を各1〜5で振り分ける（3が標準${statBonus() ? `、レベルで+${statBonus()}` : ''}）`
  $('statList').innerHTML = G.STAT_KEYS.map(k => `<div class="st-row"><b>${STAT_INFO[k][0]}</b><small>${STAT_INFO[k][1]}</small><div class="st-ctl">
    <button data-k="${k}" data-d="-1" aria-label="${STAT_INFO[k][0]}を下げる" ${myStats[k] <= G.STAT_MIN ? 'disabled' : ''}>−</button>
    <span class="pips" aria-label="${myStats[k]}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= myStats[k] ? 'on' : ''}"></i>`).join('')}</span>
    <button data-k="${k}" data-d="1" aria-label="${STAT_INFO[k][0]}を上げる" ${myStats[k] >= G.STAT_MAX || left <= 0 ? 'disabled' : ''}>＋</button></div></div>`).join('')
}
$('statList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  const k = b.dataset.k, d = +b.dataset.d, next = { ...myStats, [k]: myStats[k] + d }
  const used = G.STAT_KEYS.reduce((a, q) => a + next[q], 0)
  if (next[k] < G.STAT_MIN || next[k] > G.STAT_MAX || used > G.STAT_TOTAL + statBonus()) return
  myStats = next; save('ts-stats', myStats); renderStats()
})
const trigMsg = text => { const m = $('trigMsg'); m.textContent = text; m.classList.remove('show'); void m.offsetWidth; m.classList.add('show') }
// 編成のカードに比べられる数字を出す（威力・連射・射程など）
const specOf = t => {
  if (G.MELEE[t]) { const m = G.MELEE[t]; return `威力${m.dmg} ・ 振り${(m.time + m.cd).toFixed(1)}秒` }
  if (G.GUNS[t]) { const g = G.GUNS[t]; return `${g.n > 1 ? g.n + '発×' : ''}${g.dmg} ・ 毎秒${(1 / g.rate).toFixed(1)}回 ・ 射程${g.range}m` }
  if (G.SNIPERS[t]) { const p = G.SNIPERS[t]; return `威力${p.dmin}〜${p.dmax} ・ ため${p.charge}秒` }
  return null
}
for (const b of document.querySelectorAll('.tp')) { const sp = specOf(b.dataset.t); if (sp) b.insertAdjacentHTML('beforeend', `<span class="spec">${sp}</span>`) }
for (const b of document.querySelectorAll('.tp')) b.addEventListener('click', () => {
  const t = b.dataset.t
  const same = myTrig.find(x => x !== t && G.TRIGGER_CLASS[x] === G.TRIGGER_CLASS[t])
  if (myTrig.includes(t)) {
    if (!setTriggers(myTrig.filter(x => x !== t))) trigMsg('攻撃用のギアを1つは入れる')
  } else if (same) setTriggers(myTrig.map(x => x === same ? t : x)) // 同じ系統は入れ替える
  else if (myTrig.length >= G.TRIGGER_SLOTS) trigMsg(`ギアは${G.TRIGGER_SLOTS}つまで。先に1つ外す`)
  else setTriggers([...myTrig, t])
  if (mode === 'title') setupTitle()
})
for (const b of document.querySelectorAll('.pre')) b.addEventListener('click', () => { setTriggers(PRESETS[b.dataset.p]); if (mode === 'title') setupTitle() })
for (const b of document.querySelectorAll('.am:not(.sx)')) b.addEventListener('click', () => { myAmmo = b.dataset.a; save('ts-ammo', myAmmo); updateSummary() })
for (const b of document.querySelectorAll('.sx')) b.addEventListener('click', () => { mySense = b.dataset.s || null; save('ts-sense', mySense); updateSummary() })
// 見た目の選択
const LOOK_OPTS = { helmet: Object.entries(LOOK_HELMET).map(([k, n]) => [k, n, null]), suit: Object.entries(LOOK_SUIT).map(([k, [n, c]]) => [k, n, c]), glow: Object.entries(LOOK_GLOW).map(([k, [n, c]]) => [k, n, c || TEAM_LIGHT[0]]) }
function renderLook() {
  for (const row of document.querySelectorAll('.lk-row')) {
    const g = row.dataset.g
    row.innerHTML = LOOK_OPTS[g].map(([k, n, c]) => `<button class="lk" data-v="${k}" aria-pressed="${myLook[g] === k}">${c ? `<i style="background:${c}"></i>` : ''}${n}</button>`).join('')
  }
}
for (const row of document.querySelectorAll('.lk-row')) row.addEventListener('click', e => {
  const b = e.target.closest('.lk'); if (!b) return
  myLook = { ...myLook, [row.dataset.g]: b.dataset.v }; save('ts-look', myLook); renderLook()
  if (mode === 'title') setupTitle() // ホームの機体にすぐ反映
})
renderLook()
for (const b of document.querySelectorAll('.wx')) b.addEventListener('click', () => { applyWeather(b.dataset.w); updateSummary() })
for (const b of document.querySelectorAll('.sg')) b.addEventListener('click', () => { if (b.dataset.s !== stageKey) { buildStage(b.dataset.s); setupTitle() } updateSummary() })
// 画面の開閉とタブ
function openSheet(id) { for (const s of document.querySelectorAll('.sheet')) s.hidden = s.id !== 'sh-' + id; const f = $('sh-' + id).querySelector('.sh-back'); if (f) f.focus() }
function closeSheets() { for (const s of document.querySelectorAll('.sheet')) s.hidden = true }
for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => { openSheet(b.dataset.open); ensureAudio() })
for (const b of document.querySelectorAll('.sh-back')) b.addEventListener('click', closeSheets)
addEventListener('keydown', e => { if (e.code === 'Escape' && mode === 'title') closeSheets() })
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => {
  for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', String(x === b))
  for (const t of document.querySelectorAll('#sh-loadout .tab')) t.hidden = t.id !== 'tab-' + b.dataset.tab
})
// ステージの見取り図（建物を高さの濃さで）
for (const c of document.querySelectorAll('.sg-map')) {
  const st = G.STAGES[c.closest('.sg').dataset.s], x = c.getContext('2d'), S = c.width, E = G.MAP_HALF + 4, sc = S / (E * 2)
  x.fillStyle = '#1a2330'; x.fillRect(0, 0, S, S)
  x.fillStyle = 'rgba(255,255,255,.07)'
  for (const rd of st.roads) { x.fillRect(0, (rd.c - rd.w / 2 + E) * sc, S, rd.w * sc); x.fillRect((rd.c - rd.w / 2 + E) * sc, 0, rd.w * sc, S) }
  for (const b of st.blocks) {
    if (b.kind === 'mwall' || (b.kind === 'mfloor' && b.roof)) { x.fillStyle = b.kind === 'mwall' ? '#dfe6ee' : 'rgba(210,220,232,.18)'; x.fillRect((b.x - b.w / 2 + E) * sc, (b.z - b.d / 2 + E) * sc, Math.max(1, b.w * sc), Math.max(1, b.d * sc)); continue }
    if (b.kind) continue
    x.fillStyle = b.cont ? ['#b8432f', '#2f6aa8', '#3f8a4a', '#d0882a', '#7d8790'][b.tint] : `rgba(210,220,232,${Math.min(0.9, 0.25 + b.h / 70).toFixed(2)})`
    x.fillRect((b.x - b.w / 2 + E) * sc, (b.z - b.d / 2 + E) * sc, Math.max(1, b.w * sc), Math.max(1, b.d * sc))
  }
}
applyWeather(weather)
setTriggers(myTrig)
$('retryBtn').addEventListener('click', startGame)
// 結果からホームへ戻る
$('titleBtn').addEventListener('click', () => {
  mode = 'title'
  $('result').hidden = true
  $('hud').hidden = true
  for (const L of aimLines) L.visible = false
  setupTitle()
  $('title').hidden = false
})

// ================================================================ 検証用API（window.ts）
window.ts = {
  get mode() { return mode },
  raw: () => state,
  state: () => state && {
    phase: state.phase, t: +state.t.toFixed(2), timeLeft: +state.timeLeft.toFixed(2), score: [...state.score], winner: state.winner,
    cam: { yaw: +camYaw.toFixed(3), pitch: +camPitch.toFixed(3), x: +camPos.x.toFixed(2), y: +camPos.y.toFixed(2), z: +camPos.z.toFixed(2) },
    units: state.units.map(u => ({ id: u.id, team: u.team, role: u.role, player: u.player, alive: u.alive, en: +u.en.toFixed(1), x: +u.x.toFixed(2), y: +u.y.toFixed(2), z: +u.z.toFixed(2), yaw: +u.yaw.toFixed(2), grounded: u.grounded, bladeT: +u.bladeT.toFixed(2), targetId: u.targetId, leak: +u.leak.toFixed(2), speed: +u.speed.toFixed(2), kills: u.kills, padAir: u.padAir })),
    bullets: state.bullets.length,
  },
  pause(v = true) { paused = v },
  start(opts) {
    opts = opts || {}
    if (opts.loadout) setTriggers(opts.loadout === 'sniper' ? PRESETS.sniper : PRESETS.allround)
    if (opts.triggers) setTriggers(opts.triggers)
    window.__tsOpts = {}; window.__tsNoHint = true; startGame()
  },
  look(yaw, pitch = camPitch) { camYaw = yaw; camPitch = pitch },
  turn(dx, dy = 0) { turnCamera(dx, dy) },
  // 入力を与えて n ステップ同期で進め、1枚描く。mx/mz は画面基準（mz=-1 が前）
  run(n, input = {}) {
    for (let i = 0; i < n; i++) {
      stick.x = input.mx || 0; stick.y = input.mz || 0
      if (input.snipe) snipeHolders.add('test'); else snipeHolders.delete('test')
      if (input.shoot) shootHolders.add('test'); else shootHolders.delete('test')
      if (i === 0) for (const k of ['jump', 'pad', 'blade', 'lock', 'dash', 'bag', 'cham', 'tele']) if (input[k]) pressed[k] = true
      fixedStep()
    }
    stick.x = stick.y = 0; snipeHolders.delete('test'); shootHolders.delete('test')
    drawWorld(); render()
    return this.state()
  },
  place(id, x, z, extra = {}) { Object.assign(state.units[id], { x, z, y: 0, vx: 0, vz: 0, vy: 0, grounded: true }, extra) },
  render() { drawWorld(); render() },
  weights(id = 0) { const v = units[id]; return Object.fromEntries(Object.entries(v.actions).map(([k, a]) => [k, +a.getEffectiveWeight().toFixed(2)]).filter(([k, w]) => w > 0 && v.actions[k].isScheduled())) },
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  coverage() {
    const c = document.createElement('canvas')
    c.width = 160; c.height = 100
    const x = c.getContext('2d')
    x.drawImage(renderer.domElement, 0, 0, 160, 100)
    const d = x.getImageData(0, 0, 160, 100).data
    let s = 0, s2 = 0, n = 0
    for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; s += l; s2 += l * l; n++ }
    const m = s / n
    return { mean: +m.toFixed(1), std: +Math.sqrt(s2 / n - m * m).toFixed(1) }
  },
  // カメラが建物の中に入っていないか
  // 検証用: 自機の主な骨の位置（キャラ空間、立ち姿勢）
  bones() {
    const v = units[0], out = {}
    v.root.updateMatrixWorld(true)
    const inv = v.root.matrixWorld.clone().invert()
    v.model.traverse(o => { if (o.isBone && /^(Head|Neck|Torso|Abdomen|Hips|ShoulderL|ShoulderR|UpperArmL|UpperArmR|LowerArmR|UpperLegL|LowerLegL|FootL)$/.test(o.name)) { const p = o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv); out[o.name] = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] } })
    return out
  },
  aimPoint() { return aimPointFromCamera() },
  three() { return { renderer, scene, camera, THREE, buildings } },
  nests() { return G.STAGES[state.stage].nests.map(n => ({ x: n.x, z: n.z, w: n.w, d: n.d, h: n.h })) },
  camInside() { return buildings.some(bd => !bd.dead && bd.box.containsPoint(camPos)) },
  hitIndicator(srcId) { damageIndicator(state.units[srcId]) },
}

// ================================================================ 起動
loadRobot().then(() => {
  mode = 'title'
  setupTitle()
  renderMute()
  $('loading').hidden = true
  $('title').hidden = false
  $('mute').hidden = false
  window.__tsReady = true
  requestAnimationFrame(t => { last = t; frame(t) })
}).catch(err => {
  console.error(err)
  $('loading').textContent = 'モデルを読み込めませんでした'
  const el = $('bootErr')
  el.hidden = false
  el.textContent = String(err && err.message || err) + '\n' + navigator.userAgent
})
