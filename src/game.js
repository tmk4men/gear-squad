// ゲームロジック。three.js に依存しない純ロジック。固定60Hzで step() を呼ぶ。
// 3対3のチーム戦。体力と弾薬を兼ねたエネルギー（EN）が尽きると強制帰還して退場する。
// 得点: 撃破1点、最後まで残った隊に生存点2点。

export const STEP = 1 / 60
export const MAP_HALF = 160 // 戦える範囲は 320m 四方。端から端まで走って約45秒
export const MATCH_TIME = 300 // 広い街で探して戦うので5分
export const MAX_EN = 100
// ステータス: 機動（足の速さ）・EN量・攻撃・跳躍。各1〜5、合計12点を振り分ける（全部3が標準）
export const STAT_KEYS = ['spd', 'en', 'atk', 'jmp']
export const STAT_TOTAL = 12, STAT_MIN = 1, STAT_MAX = 5
export const STAT_BONUS_MAX = 3 // レベルが上がるたびに1点ずつ、3点まで増える
export function validStats(s, bonus = 0) {
  const o = {}
  for (const k of STAT_KEYS) o[k] = Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round((s && s[k]) || 3)))
  const total = STAT_TOTAL + Math.max(0, Math.min(STAT_BONUS_MAX, bonus | 0))
  return STAT_KEYS.reduce((a, k) => a + o[k], 0) <= total ? o : { spd: 3, en: 3, atk: 3, jmp: 3 }
}
// 段階ごとの効き目（3で標準）
export const statSpd = lv => 0.82 + 0.06 * lv   // 足の速さ ×0.88〜1.12
export const statEn = lv => 70 + 10 * lv        // EN 80〜120
export const statAtk = lv => 0.85 + 0.05 * lv   // 与えるダメージ ×0.9〜1.1
export const statJmp = lv => 0.8 + 0.2 / 3 * lv // ジャンプの高さ ×0.87〜1.13
const ROLE_STATS = { attacker: { spd: 4, en: 3, atk: 3, jmp: 2 }, allround: { spd: 3, en: 3, atk: 3, jmp: 3 }, shooter: { spd: 3, en: 4, atk: 3, jmp: 2 }, sniper: { spd: 2, en: 3, atk: 4, jmp: 3 } }
export const UNIT_R = 0.45
export const UNIT_H = 1.9
export const SCORE = { kill: 1 }
export const RESPAWN_T = 8      // 強制帰還から再出撃までの秒数
// 第六感: 出撃前に1つ選ぶ常時の能力
export const SENSES = ['hawk', 'rally', 'precise', 'adversity']
export const HAWK_RADAR = 65                         // 鷹の目: レーダー 50→65m
export const RALLY_T = 5                             // 再起: 再出撃 8→5秒
export const PRECISE_HEAD = 1.3                      // 精密: 頭に当たると1.3倍（どの銃・狙撃でも）
export const ADVERSITY_EN = 0.3, ADVERSITY_ATK = 1.2, ADVERSITY_SPD = 1.1 // 逆境: EN 3割未満で攻撃+20%・足+10%
export const respawnT = u => u.sense === 'rally' ? RALLY_T : RESPAWN_T
export const adverse = u => u.sense === 'adversity' && u.alive && u.en < u.maxEn * ADVERSITY_EN
export const SPAWN_SHIELD = 2   // 再出撃直後に攻撃を受けない秒数
export const OVERTIME_MAX = 60  // 同点で時間切れなら、次の撃破で決まる延長戦（最長60秒）

const RUN = 7.5
const ACCEL = 60
const FRICTION = 45
const GRAVITY = 26
const JUMP_V = 12.5 // 基礎のジャンプ: 約3m（アニメのような高い跳び）
const TURN_RATE = 16
// エアステップ: 足元に板を出して高く跳ぶ。着地するまでに2回まで（地上で1回＋空中で1回、または空中で2回）。
// 空中の板は上より前へ強く押し出すので、上へ積み上がるより街を跳び回る動きになる
const PAD_V = 30
const PAD_PUSH = 10
const PAD_AIR_V = 22
const PAD_AIR_PUSH = 14
export const PAD_CD = 0.22
const PAD_COST = 0.5
export const WEIGHT_T = 60 // 重り弾の重りが付いている秒数（当たるたびに60秒に戻る）
export const WEIGHT_MAX = 0.45 // 重りで遅くなる上限
export const PAD_MAX = 2
// ブレード
// シューター: 立方体を出し、分裂させて撃つ

const BULLET_LEAK = 0.15
// ステルスマント: マントを着ている間はレーダーに映らない。姿は見えるので、見通しが通っていて近ければ見つかる。
// 着ている間は少しずつENを使う（消費量は作中に明記が無いので仮の値）
const BAG_DRAIN = 0.2
export const BAG_SIGHT = 45
// 索敵: レーダーは味方の誰かから50m以内の敵を映す。それより遠い敵は、見通しが通って70m以内なら目で見つかる
export const RADAR_RANGE = 50
export const SIGHT = 70
// ダッシュ: 押した向きへ短く飛び出す。入力が無ければ後ろへ下がる。逃げるための手段なので待ち時間は長め
const DASH_V = 20
export const DASH_T = 0.25
export const DASH_CD = 1 // ダッシュの待ち時間（秒）
// 狙撃: 押している間ためて、離して撃つ。弾は一瞬で届く光線。ためるほど強い。
// 狙いは相手の0.15秒前の位置に付くので、走り回る相手には外れ、止まった相手や着地の瞬間に当たる
export const SNIPE_RANGE = 160 // 狙撃の届く距離（マップの半分）
const SNIPE_LAG = 9               // 何ステップ前の位置を狙うか（0.15秒）
const SNIPE_HIT_R = 0.55
const LOCK_RANGE = 110
const LEAK_MAX = 1.2 // 漏れは傷が増えても毎秒1.2まで
// 傷ごとに漏れが続く時間。受けたダメージに比例する（ブレード14で約5秒、狙撃30で約10秒、スプリッター1発で約0.5秒）
export const LEAK_SEC_PER_DMG = 0.21

// 再現できる乱数
function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

// 市街地。道路で区切った街区に建物を自動で並べる。点対称にして両陣営の条件をそろえる。
// 高さは実際の建物に合わせる（1階 3.6m、2階から上は 3m。キャラの身長は1.9m）。
// エアステップは1回で約17m、2回（頂点で2回目）で約26mまで届く。それより高い建物は壁のベランダを足場にして登る。
// 幅と奥行きは 3m の倍数（窓1区画が 3m なので、壁の絵の繰り返しが窓の途中で切れない）
// 道路の中心と幅（東西・南北とも同じ）。45m ごとに通し、中央と ±90m は幅の広い大通り
export const ROADS = []
for (let c = -135; c <= 135; c += 45) ROADS.push({ c, w: c % 90 === 0 ? 12 : 8 })
export const SIDEWALK = 1.5
export const PARKS = [] // 空き地（公園）の街区。見た目で芝を描く
const HEIGHTS_LOW = [6.6, 9.6, 12.6, 15.6, 15.6, 21.6, 27.6, 33.6]
const HEIGHTS_MID = [15.6, 24.6, 30.6, 36.6, 45.6, 54.6, 63.6, 75.6] // 中心付近は高層ビル（エアステップで届くのは5階建ての15.6m まで）
// 狙撃場所: 4階建て以上の屋上には、縁に当たり判定のある手すり壁（1.1m）と出入口の塔屋（2.6m）を置く。
// 屋上に立つと目の高さ（1.4m）は壁より上なので外を狙えるが、下からは体の中心（1.0m）が壁に隠れる
export const PARAPET_H = 1.1
export const NESTS = [] // 狙撃場所になる建物（CPU のスナイパーが向かう）
function generateCity() {
  const r = rng(20261008)
  const edge = MAP_HALF - 3 // 外周の歩道
  // 街区の境目（道路の端と、外周）
  const cuts = [-edge]
  for (const rd of ROADS) cuts.push(rd.c - rd.w / 2 - SIDEWALK, rd.c + rd.w / 2 + SIDEWALK)
  cuts.push(edge)
  const cells = []
  for (let i = 0; i < cuts.length; i += 2) cells.push([cuts[i], cuts[i + 1]])
  const n = cells.length
  const half = []
  const snap = v => Math.floor(v / 3) * 3 // 3m の倍数に切り下げ（敷地からはみ出さない）
  for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) {
    const k = ix * n + iz, km = (n - 1 - ix) * n + (n - 1 - iz)
    if (k > km) continue // 点対称の相方は後で鏡写しにする
    const [x0, x1] = cells[ix], [z0, z1] = cells[iz]
    const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    const central = Math.max(Math.abs(cx), Math.abs(cz)) < 70
    const H = () => (central ? HEIGHTS_MID : HEIGHTS_LOW)[Math.floor(r() * 8)]
    const v = r()
    const put = (bx, bz, bw, bd) => { if (bw >= 9 && bd >= 9) half.push({ x: bx, z: bz, w: bw, d: bd, h: H() }) }
    if (v < 0.1) { PARKS.push({ x: cx, z: cz, w: W, d: D }, { x: -cx, z: -cz, w: W, d: D }); continue }
    if (v < 0.42) {
      // 1棟（敷地に少し余白）
      const bw = snap(W - 1 - r() * 4), bd = snap(D - 1 - r() * 4)
      put(cx + (r() - 0.5) * (W - bw - 1), cz + (r() - 0.5) * (D - bd - 1), bw, bd)
    } else if (v < 0.74) {
      // 2棟（長い方向に分け、間に通れる路地）
      const alley = 4
      if (W >= D) { const a = snap((W - alley) * (0.4 + r() * 0.2)), b2 = snap(W - alley - a); const bd = snap(D - 1 - r() * 3); put(x0 + a / 2, cz, a, bd); put(x1 - b2 / 2, cz, b2, snap(D - 1 - r() * 3)) }
      else { const a = snap((D - alley) * (0.4 + r() * 0.2)), b2 = snap(D - alley - a); put(cx, z0 + a / 2, snap(W - 1 - r() * 3), a); put(cx, z1 - b2 / 2, snap(W - 1 - r() * 3), b2) }
    } else if (v < 0.86 && W > 23 && D > 23) {
      // 4棟（十字の路地）
      const al = 2.6
      const aw = snap((W - al) / 2), ad = snap((D - al) / 2)
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (r() < 0.15) continue // ところどころ空き地
        const bw = snap(aw - r() * 2), bd = snap(ad - r() * 2)
        put(cx + sx * (al / 2 + aw / 2), cz + sz * (al / 2 + ad / 2), Math.min(bw, aw), Math.min(bd, ad))
      }
    } else {
      // L字: 大きい1棟と小さい1棟
      const bw = snap(W * 0.62), bd = snap(D - 1)
      put(x0 + bw / 2 + 0.5, cz, bw, bd)
      const sw = snap(W - bw - 3.5), sd = snap(D * 0.45)
      if (sw >= 6) put(x1 - sw / 2 - 0.5, z0 + sd / 2 + 0.5, sw, sd)
    }
  }
  // 狙撃場所の手すり壁と塔屋（当たり判定のある本物の壁）。kind で建物本体と区別する
  const extra = []
  for (const b of half) {
    if (b.h < 12.6 || b.h > 15.6 || b.w < 9 || b.d < 9) continue
    b.nest = true
    extra.push(
      { x: b.x + b.w / 2 - 2.6, z: b.z - b.d / 2 + 2.6, w: 3, d: 3, h: b.h + 2.6, kind: 'roof', par: b }, // 塔屋（隅に寄せる）
    )
  }
  // 高い建物（エアステップで屋上に届かない）: 壁にベランダの足場を18mごとに付け、跳び移って登れるようにする。
  // 足場は浮いた板（y0 から h まで）。前に何もない面を選ぶ。8階建て以上の屋上には機械室と給水タンク（どちらも当たり判定あり）
  const both = [...half, ...half.map(b => ({ ...b, x: -b.x, z: -b.z }))]
  const clear = (x, z, w, d, self) => !both.some(o => !(o.x === self.x && o.z === self.z) && Math.abs(x - o.x) < (w + o.w) / 2 + 0.8 && Math.abs(z - o.z) < (d + o.d) / 2 + 0.8) &&
    Math.abs(x) + w / 2 < edge && Math.abs(z) + d / 2 < edge
  const LD = 2.4, LW = 6
  for (const b of half) {
    if (b.h > 26) {
      const faces = [[0, 1], [0, -1], [1, 0], [-1, 0]]
      for (const [fx, fz] of faces) {
        const along = fz ? b.w : b.d
        if (along < LW + 1) continue
        const lw = fz ? LW : LD, ld = fz ? LD : LW
        const cx = b.x + fx * (b.w / 2 + LD / 2), cz = b.z + fz * (b.d / 2 + LD / 2)
        if (!clear(cx + fx * 1.5, cz + fz * 1.5, lw + Math.abs(fx) * 3, ld + Math.abs(fz) * 3, b)) continue // 足場の前に跳ぶ場所も空ける
        let i = 0
        for (let H = 18; H <= b.h - 6; H += 18, i++) {
          const off = (i % 2 ? 1 : -1) * Math.min(along / 2 - LW / 2 - 0.5, 4) // 左右に互い違い
          extra.push({ x: cx + (fz ? off : 0), z: cz + (fx ? off : 0), w: lw, d: ld, h: H, y0: H - 0.35, kind: 'ledge', par: b })
        }
        break
      }
    }
    if (b.h >= 17 && !b.nest) {
      extra.push({ x: b.x - b.w * 0.15, z: b.z + b.d * 0.1, w: Math.min(b.w * 0.4, 9), d: Math.min(b.d * 0.35, 7), h: b.h + 3.4, kind: 'roof', par: b })
      extra.push({ x: b.x + b.w / 2 - 1.4, z: b.z - b.d / 2 + 1.4, w: 1.6, d: 1.4, h: b.h + 1.9, kind: 'tank', par: b })
    }
  }
  const all = [...half, ...extra]
  // 点対称の相方を作り、番号（id）と、屋上の物・足場がどの建物のものか（parent）を付ける
  const mir = new Map(half.map(b => [b, { ...b, x: -b.x, z: -b.z }]))
  const out = [...all, ...all.map(b => b.par ? { ...b, x: -b.x, z: -b.z, par: mir.get(b.par) } : mir.get(b))]
  const idOf = new Map(out.map((b, i) => [b, i]))
  for (const [i, b] of out.entries()) { b.id = i; if (b.par) { b.parent = idOf.get(b.par); delete b.par } }
  for (const b of out) if (b.nest) NESTS.push(b)
  return out
}
export const BLOCKS = generateCity()

// ---------------------------------------------------------------- 2つ目のステージ: 港湾倉庫街
// 地形で戦うための街: 積み上げたコンテナ（1〜3段。基礎のジャンプ約3mで1段ずつ登れる高台）、
// 屋上に乗れる大きな倉庫（4〜5階相当の高さは狙撃場所）、見通しの良い岸壁（狙撃の通り道）、角の高いクレーン塔（ベランダで登る）
export const HARBOR_PARKS = []
function generateHarbor() {
  const r = rng(20261012)
  const half = []
  const CONT_H = 2.6
  const free = (x, z, w, d, m = 2) => Math.abs(x) + w / 2 < MAP_HALF - 4 && Math.abs(z) + d / 2 < MAP_HALF - 4 && z + d / 2 < -1.5 &&
    !half.some(o => Math.abs(x - o.x) < (w + o.w) / 2 + m && Math.abs(z - o.z) < (d + o.d) / 2 + m)
  const add = (b, m) => { if (free(b.x, b.z, b.w, b.d, m)) { half.push(b); return true } return false }
  // 岸壁の倉庫の列（南側の半分。北側は点対称の相方）
  for (let x = -132; x <= 132; x += 44) {
    const w = 30 + Math.floor(r() * 3) * 3, d = 18 + Math.floor(r() * 2) * 3
    add({ x, z: -118 + (r() - 0.5) * 6, w, d, h: r() < 0.5 ? 12.6 : 9.6, ware: true }, 4)
  }
  // 中ほどの倉庫と事務所
  for (const [x, z] of [[-96, -62], [0, -70], [96, -60], [-40, -24], [48, -26]]) {
    const office = r() < 0.3
    add({ x, z, w: office ? 18 : 27, d: office ? 15 : 18, h: office ? 21.6 : (r() < 0.5 ? 12.6 : 9.6), ware: !office }, 4)
  }
  // クレーン塔（角。ベランダの足場で登る）
  for (const x of [-148, 148]) add({ x, z: -146, w: 9, d: 9, h: 39.6, crane: true }, 2)
  // コンテナ置き場: 列ごとに3m の通路をあけて積む。段数がばらばらなので、跳び乗っていくと高台に出られる
  const yards = [[-130, -86, 50, 26], [-60, -96, 44, 20], [24, -98, 52, 24], [96, -92, 40, 22], [-110, -30, 46, 24], [0, -44, 40, 18], [100, -28, 44, 22], [-60, -10, 28, 14], [56, -6, 32, 12]]
  for (const [cx, cz, W, D] of yards) {
    for (let zz = cz - D / 2; zz <= cz + D / 2 - 6; zz += 9) {
      for (let xx = cx - W / 2; xx <= cx + W / 2 - 2.4; xx += 2.4 + (r() < 0.25 ? 3 : 0)) {
        if (r() < 0.12) continue // ところどころ抜けている
        const lv = 1 + Math.floor(r() * r() * 3.2) // 1段が多く、3段は少ない
        add({ x: xx + 1.2, z: zz + 3, w: 2.4, d: 6, h: CONT_H * Math.min(3, lv), cont: true, tint: Math.floor(r() * 5) }, 0.05)
      }
    }
  }
  // 広場の低い遮蔽物（積み荷のパレット・コンクリートの塊。1.2m で体の半分が隠れる）
  for (let i = 0; i < 26; i++) {
    const x = (r() * 2 - 1) * (MAP_HALF - 12), z = -6 - r() * (MAP_HALF - 18)
    add({ x, z, w: 2.4 + Math.floor(r() * 2) * 1.2, d: 1.2, h: 1.2, low: true }, 2.5)
  }
  const mir = new Map(half.map(b => [b, { ...b, x: -b.x, z: -b.z }]))
  // 倉庫の高い方（12.6m）は狙撃場所: 隅に塔屋。クレーン塔はベランダ
  const extra = []
  for (const b of half) {
    if (b.ware && b.h === 12.6) { b.nest = true; extra.push({ x: b.x + b.w / 2 - 2.6, z: b.z - b.d / 2 + 2.6, w: 3, d: 3, h: b.h + 2.6, kind: 'roof', par: b }) }
    if (b.crane) for (let H = 18; H <= b.h - 6; H += 18) extra.push({ x: b.x, z: b.z + b.d / 2 + 1.2, w: 6, d: 2.4, h: H, y0: H - 0.35, kind: 'ledge', par: b })
  }
  const all = [...half, ...extra]
  const out = [...all, ...all.map(b => b.par ? { ...b, x: -b.x, z: -b.z, par: mir.get(b.par) } : mir.get(b))]
  const idOf = new Map(out.map((b, i) => [b, i]))
  for (const [i, b] of out.entries()) { b.id = i; if (b.par) { b.parent = idOf.get(b.par); delete b.par } }
  return out
}
export const HARBOR_BLOCKS = generateHarbor()
// ---------------------------------------------------------------- 3つ目のステージ: ショッピングモール（中で戦う）
// 256m x 192m・3階建て（床の上面 0 / 6.8 / 13.6m、屋上 20.4m）。床は下から抜けない本物の天井。
// 中央に大きな吹き抜け（天窓）。階段は1段0.34m（歩くだけで上り下りできる）で、真上の床には穴が開いている。
// 南北の壁ぞいに店、通路に柱と売店のカウンター（遮蔽物）。外の狭い駐車場に車
const FH = 6.8, STEP_R = 0.34, STEP_D = 0.8, NSTEP = 20
export const MALL = { x: 128, z: 96, floors: [0, FH, FH * 2], roof: FH * 3, hole: { x: 28, z: 20 }, slab: 0.4, stairs: [] }
// 階段（下の階 k → k+1）: x の位置と、上る向き（+z / -z）。点対称に置く
for (const [k, sx] of [[0, 92], [1, 52], [0, 116], [1, 80]]) for (const s of [1, -1]) // 各階へ4か所（1か所で上下を封鎖できないように）
  MALL.stairs.push({ k, x: s * sx, z0: -s * 8, dir: s, w: 6 })
// 長方形から穴を引いて、残りを長方形の集まりにする
function subtract(rects, h) {
  const out = []
  for (const r of rects) {
    const ix0 = Math.max(r.x0, h.x0), ix1 = Math.min(r.x1, h.x1), iz0 = Math.max(r.z0, h.z0), iz1 = Math.min(r.z1, h.z1)
    if (ix0 >= ix1 || iz0 >= iz1) { out.push(r); continue }
    if (r.z0 < iz0) out.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: iz0 })
    if (iz1 < r.z1) out.push({ x0: r.x0, x1: r.x1, z0: iz1, z1: r.z1 })
    if (r.x0 < ix0) out.push({ x0: r.x0, x1: ix0, z0: iz0, z1: iz1 })
    if (ix1 < r.x1) out.push({ x0: ix1, x1: r.x1, z0: iz0, z1: iz1 })
  }
  return out
}
function generateMall() {
  const r = rng(20261013)
  const out = []
  const add = b => out.push(b)
  const { x: MX, z: MZ, roof: RH, hole: H, slab: SL } = MALL
  const T = 0.6 // 外壁の厚さ
  // 外壁: 入口（幅8m・高さ4m）の上は梁
  const wallRun = (axis, c, from, to, doors) => {
    let p = from
    for (const d of doors) {
      const a = d - 4
      if (a > p) add(axis === 'x' ? { x: (p + a) / 2, z: c, w: a - p, d: T, h: RH, kind: 'mwall', ext: true } : { x: c, z: (p + a) / 2, w: T, d: a - p, h: RH, kind: 'mwall', ext: true })
      add(axis === 'x' ? { x: d, z: c, w: 8, d: T, h: RH, y0: 4, kind: 'mwall', ext: true } : { x: c, z: d, w: T, d: 8, h: RH, y0: 4, kind: 'mwall', ext: true })
      p = d + 4
    }
    if (to > p) add(axis === 'x' ? { x: (p + to) / 2, z: c, w: to - p, d: T, h: RH, kind: 'mwall', ext: true } : { x: c, z: (p + to) / 2, w: T, d: to - p, h: RH, kind: 'mwall', ext: true })
  }
  wallRun('x', MZ, -MX, MX, [-80, -40, 0, 40, 80]); wallRun('x', -MZ, -MX, MX, [-80, -40, 0, 40, 80])
  wallRun('z', MX, -MZ, MZ, [-40, 0, 40]); wallRun('z', -MX, -MZ, MZ, [-40, 0, 40])
  // 床と屋上: 吹き抜けと、その階に上がってくる階段の上を穴にする
  const levels = [MALL.floors[1], MALL.floors[2], RH]
  levels.forEach((top, li) => {
    let rects = [{ x0: -MX + T / 2, x1: MX - T / 2, z0: -MZ + T / 2, z1: MZ - T / 2 }]
    rects = subtract(rects, { x0: -H.x, x1: H.x, z0: -H.z, z1: H.z })
    for (const s of MALL.stairs) if (s.k === li) { const za = s.z0 - s.dir * 2, zb = s.z0 + s.dir * NSTEP * STEP_D; /* 穴は最後の段の位置で止める（先まで開けると上り切った所で落ちる） */ rects = subtract(rects, { x0: s.x - s.w / 2 - 0.5, x1: s.x + s.w / 2 + 0.5, z0: Math.min(za, zb), z1: Math.max(za, zb) }) }
    for (const q of rects) add({ x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, w: q.x1 - q.x0, d: q.z1 - q.z0, h: top, y0: top - SL, kind: 'mfloor', roof: top === RH })
  })
  // 階段（段は床から積む。最後の段の上面が上の階の床の上面）
  for (const s of MALL.stairs) {
    const fl = MALL.floors[s.k]
    for (let i = 1; i <= NSTEP; i++) add({ x: s.x, z: s.z0 + s.dir * (i - 0.5) * STEP_D, w: s.w, d: STEP_D, h: fl + i * STEP_R, y0: fl || undefined, kind: 'mstep' })
  }
  // 吹き抜けと階段の穴のまわりの手すり（1m。体の半分が隠れる）
  for (const fl of MALL.floors.slice(1)) {
    for (const sz of [1, -1]) add({ x: 0, z: sz * (H.z + 0.15), w: H.x * 2, d: 0.3, h: fl + 1.0, y0: fl, kind: 'mrail' })
    for (const sx of [1, -1]) add({ x: sx * (H.x + 0.15), z: 0, w: 0.3, d: H.z * 2, h: fl + 1.0, y0: fl, kind: 'mrail' })
    // 手すりの一部を広告板（2.4m）でふさぐ。上の階から吹き抜け全体を見下ろして撃てないように
    for (const s of [1, -1]) { add({ x: s * 10, z: s * (H.z + 0.15), w: 12, d: 0.35, h: fl + 2.4, y0: fl, kind: 'mwall', ad: true }); add({ x: s * (H.x + 0.15), z: -s * 8, w: 0.35, d: 10, h: fl + 2.4, y0: fl, kind: 'mwall', ad: true }) }
  }
  // 店: 南北の壁ぞいに奥行き14m。仕切り壁と、通路側の上の看板壁（下は開いた店先）
  const SHOP_D = 14, SHOP_W = 16
  for (const fl of MALL.floors) {
    const ceil = fl + FH - SL
    for (const sz of [1, -1]) {
      const back = sz * (MZ - T / 2), front = sz * (MZ - T / 2 - SHOP_D)
      for (let x = -MX + T / 2; x <= MX - SHOP_W; x += SHOP_W) {
        add({ x, z: (back + front) / 2, w: 0.3, d: SHOP_D, h: ceil, y0: fl || undefined, kind: 'mwall' })
        const door = fl === 0 && [-80, -40, 0, 40, 80].some(d => Math.abs(x + SHOP_W / 2 - d) < 9) // 外の入口の前は店にしない（通り抜けられる）
        if (!door) add({ x: x + SHOP_W / 2, z: front, w: SHOP_W - 0.3, d: 0.3, h: ceil, y0: fl + 3.4, kind: 'mwall', sign: true, shop: Math.floor(r() * 8) })
      }
    }
  }
  // 柱（各階、床から天井まで）
  for (const fl of MALL.floors) for (const px of [-108, -72, -36, 36, 72, 108]) for (const pz of [-36, 36]) add({ x: px, z: pz, w: 1.4, d: 1.4, h: fl + FH - SL, y0: fl || undefined, kind: 'mwall' })
  // 売店のカウンター・ベンチ（1.1m の遮蔽物）。南半分を作って点対称に写す
  const kiosks = []
  for (const fl of MALL.floors) for (let i = 0; i < 9; i++) {
    const x = -112 + r() * 224, z = -(24 + r() * 46), w = 3 + Math.floor(r() * 3), d = 1.4
    if (MALL.stairs.some(s => Math.abs(x - s.x) < 8 && Math.abs(z) < 14)) continue
    kiosks.push({ x, z, w, d, h: fl + 1.1, y0: fl || undefined, kind: 'mrail', counter: true })
  }
  kiosks.push({ x: 0, z: 0, w: 10, d: 7, h: 0.9, kind: 'mrail', counter: true }) // 1階の噴水の縁
  // 通路の中央に植え込みとベンチを約10m おきに並べ、見通しを40m 以上続けない（遮蔽の鎖）
  for (const fl of MALL.floors) for (let x = -116; x <= -6; x += 11) for (const z of [-60, -36]) {
    if (MALL.stairs.some(s => Math.abs(x - s.x) < 7 && Math.abs(z) < 14) || (Math.abs(x) < 32 && Math.abs(z) < 24)) continue
    const big = (Math.round(x / 11) + (z === -60 ? 0 : 1)) % 2 === 0
    kiosks.push({ x, z, w: big ? 3.2 : 2.4, d: big ? 2.4 : 1.2, h: fl + (big ? 1.25 : 0.9), y0: fl || undefined, kind: 'mrail', counter: true, planter: big })
  }
  for (const k of kiosks) { add(k); if (k.x || k.z) add({ ...k, x: -k.x, z: -k.z }) }
  // 外の駐車場（建物のまわりの帯）に車
  const cars = []
  for (let i = 0; i < 40; i++) {
    const side = r() < 0.7, x = side ? -150 + r() * 300 : (r() < 0.5 ? -1 : 1) * (MX + 8 + r() * 20), z = side ? -(MZ + 10 + r() * 50) : -r() * MZ
    if (Math.abs(x) > MAP_HALF - 6 || Math.abs(z) > MAP_HALF - 6) continue
    const long = !side
    const c = { x, z, w: long ? 1.9 : 4.4, d: long ? 4.4 : 1.9, h: 1.5, car: true, tint: Math.floor(r() * 5) }
    if (cars.some(o => Math.abs(o.x - c.x) < (o.w + c.w) / 2 + 1 && Math.abs(o.z - c.z) < (o.d + c.d) / 2 + 1)) continue
    if ([-80, -40, 0, 40, 80].some(d => Math.abs(c.x - d) < 7) && Math.abs(c.z) < MZ + 8) continue
    cars.push(c)
  }
  for (const c of cars) { add(c); add({ ...c, x: -c.x, z: -c.z }) }
  for (const [i, b] of out.entries()) { b.id = i; if (b.y0 === undefined) delete b.y0 }
  return out
}
export const MALL_BLOCKS = generateMall()
export const STAGES = {
  city: { name: '市街地', blocks: BLOCKS, roads: ROADS, parks: PARKS },
  harbor: { name: '港湾倉庫街', blocks: HARBOR_BLOCKS, roads: [], parks: HARBOR_PARKS },
  mall: { name: 'ショッピングモール', blocks: MALL_BLOCKS, roads: [], parks: [] },
}
for (const k in STAGES) STAGES[k].nests = STAGES[k].blocks.filter(b => b.nest)
// 検証用の小さい街（以前の配置）。テストはこちらで回して、地形が変わっても検査の前提がずれないようにする
const LEGACY_HALF = [
  { x: -14, z: 6, w: 8, d: 6, h: 9.6 }, { x: 0, z: 8.5, w: 6, d: 3, h: 3.6 }, { x: 14, z: 6, w: 7, d: 8, h: 15.6 },
  { x: -6, z: 16, w: 5, d: 5, h: 6.6 }, { x: 8, z: 18, w: 9, d: 4, h: 3.6 }, { x: -21, z: 18, w: 5, d: 7, h: 12.6 },
  { x: 23, z: 20, w: 5, d: 5, h: 6.6 }, { x: -25, z: 4, w: 4, d: 4, h: 4.2 },
]
export const LEGACY_BLOCKS = [...LEGACY_HALF, ...LEGACY_HALF.map(b => ({ ...b, x: -b.x, z: -b.z }))]
const LEGACY_SPAWN = [[0, 26], [-6, 25], [6, 27]]
// 出撃位置: 自隊の3人を街の空いている所へ散らして置き、敵は点対称の位置。
// 敵の出撃位置からはレーダーの範囲より遠く（80m以上）離して、出撃直後は互いに見えないようにする
export const SPAWN_GAP = 150
const REGROUP_T = 12 // CPU が味方と合流しに向かう時間
function pickSpawns(st) {
  const free = (x, z) => Math.abs(x) < MAP_HALF - 4 && Math.abs(z) < MAP_HALF - 4 &&
    !st.blocks.some(b => base(b) < 2.5 && Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5) && // 頭上の床・梁は気にしない
    (st.stage !== 'mall' || (Math.abs(x) < MALL.x - 3 && Math.abs(z) < MALL.z - 3)) // モールは中から出撃
  for (let tries = 0; tries < 400; tries++) {
    const pts = []
    for (let i = 0; i < 3; i++) {
      let p = null
      for (let k = 0; k < 200 && !p; k++) {
        const x = (st.rand() * 2 - 1) * (MAP_HALF - 6), z = (st.rand() * 2 - 1) * (MAP_HALF - 6)
        if (free(x, z) && Math.hypot(x, z) > SPAWN_GAP / 2) p = [x, z]
      }
      if (!p) break
      pts.push(p)
    }
    if (pts.length < 3) continue
    // 自隊のどの出撃位置も、敵（点対称）のどの出撃位置からも45m以上
    const ok = pts.every(a => pts.every(b => Math.hypot(a[0] + b[0], a[1] + b[1]) >= SPAWN_GAP))
    if (ok) return pts
  }
  return LEGACY_SPAWN
}

// ギア: 1人が持てるのは4つまで（ダッシュは全員の基本動作）。
// 画面の名前: blade=ブロードセイバー、shoot=スプリッター、snipe=ロングショット（内部の名前は古いまま）
export const TRIGGERS = ['blade', 'scorpion', 'handgun', 'rifle', 'shotgun', 'launcher', 'snipe', 'lightning', 'ibis', 'pad', 'bag', 'chameleon', 'teleport']
export const TRIGGER_SLOTS = 4
// 系統: 近接・射撃・狙撃はそれぞれ1つまで（同じボタンで出すため）
export const TRIGGER_CLASS = { blade: 'melee', scorpion: 'melee', handgun: 'gun', rifle: 'gun', shotgun: 'gun', launcher: 'gun', snipe: 'sniper', lightning: 'sniper', ibis: 'sniper', pad: 'pad', bag: 'bag', chameleon: 'chameleon', teleport: 'teleport' }
export const ATTACK_TRIGGERS = TRIGGERS.filter(t => ['melee', 'gun', 'sniper'].includes(TRIGGER_CLASS[t]))
// 近接: ブロードセイバーは重くて強い、スティンガーは軽くて速い
export const MELEE = {
  blade: { dmg: 22, time: 0.42, from: 0.1, to: 0.24, range: 2.6, lunge: 9, cd: 0.5, leak: 0.6, arc: Math.cos(80 * Math.PI / 180) },
  scorpion: { dmg: 14, time: 0.28, from: 0.06, to: 0.16, range: 2.2, lunge: 12, cd: 0.18, leak: 0.45, arc: Math.cos(70 * Math.PI / 180) },
}
// 銃: 撃ち方が違う。押している間、銃ごとの間隔で撃ち続ける（連射の速さで、待ち時間ではない）
export const GUNS = {
  // move: 走りながら撃つと散る度合い / bloom: 撃ち続けると散っていく量 / slow: 撃っている間の足 / head: 頭に当たったときの倍率 / kb: 当たった相手を押す強さ
  handgun: { rate: 0.2, n: 1, spread: 0.008, v: 58, life: 0.62, dmg: 2.2, cost: 0.12, range: 34, move: 0, bloom: 0, slow: 1, head: 1.5, kb: 0 },          // 動きながらでも正確。頭は1.5倍
  rifle: { rate: 0.09, n: 1, spread: 0.02, v: 62, life: 0.7, dmg: 1.0, cost: 0.06, range: 42, move: 0.6, bloom: 0.012, slow: 0.75, head: 1, kb: 0 },   // 撃ち続けるほど散る。撃つ間は足が重い
  shotgun: { rate: 0.6, n: 9, spread: 0.11, v: 46, life: 0.34, dmg: 1.3, cost: 0.5, range: 14, move: 0.2, bloom: 0, slow: 1, head: 1, kb: 1.4 },       // 近いほど強く、当てると押し返してよろめかせる
  launcher: { rate: 0.85, n: 1, spread: 0, v: 28, life: 2.2, dmg: 12, cost: 1.2, range: 38, grav: 9, blast: 3.6, move: 0, bloom: 0, slow: 0.6, head: 1, kb: 0 }, // 弧を描いて爆発。建物に強い
}
// 弾: 銃に込める種類。銃とは別に1つ選ぶ（枠は使わない）
export const AMMO = {
  normal: { dmg: 1, v: 1 },                    // 通常弾: まっすぐ速い。威力が一番高い
  homing: { dmg: 0.75, v: 0.6, turn: 6 },      // 追尾弾: 狙った相手へ曲がる。動く相手・遠い相手に
  blast: { dmg: 0.8, v: 0.75, blast: 1.8 },    // 炸裂弾: 当たった所で弾ける。物陰の相手と建物に強い
  curve: { dmg: 0.85, v: 0.85, curve: 0.55 },  // 曲射弾: 横へふくらんでから狙った点へ。正面の遮蔽物を回り込む
  weight: { dmg: 0.25, v: 0.9, slow: 0.03 },   // 重り弾: ほとんど削れない代わりに、当たった数だけ重りが付く（1発3%、最大45%。走る速さとジャンプが下がる。1分続く）
}
export const AMMO_TYPES = Object.keys(AMMO)
// 狙撃: ロングショットは標準、ラピッドショットは速いが軽い、ヘビーショットは遅いが重い
export const SNIPERS = {
  snipe: { charge: 0.9, cd: 1.4, min: 0.3, cost: 1.5, dmin: 10, dmax: 24, leak: 0.6, slow: 0.4, lag: 9, kick: 4 },
  lightning: { charge: 0.35, cd: 0.5, min: 0.1, cost: 0.5, dmin: 4, dmax: 7, leak: 0.3, slow: 0.75, lag: 4, kick: 1 },
  ibis: { charge: 1.6, cd: 2.6, min: 0.6, cost: 3, dmin: 24, dmax: 44, leak: 0.9, slow: 0.2, lag: 9, kick: 9 },
}
export const CHAMELEON_DRAIN = 0.6 // ミラージュ: 姿が消える（8m より近いと見つかる）。攻撃すると解ける
export const CHAMELEON_SIGHT = 0 // ミラージュ中は近くても見えない（PvP で完全に消えるように）
export const TELEPORT_DIST = 20, TELEPORT_CD = 5, TELEPORT_COST = 1.5 // ブリンク: 向いている方へ最大15m跳ぶ
const ROLE_TRIGGERS = {
  attacker: ['blade', 'pad', 'bag'],
  allround: ['blade', 'handgun', 'pad', 'bag'],
  shooter: ['rifle', 'pad', 'bag'],
  sniper: ['snipe', 'pad', 'bag'],
}
// CPU の組み方の幅（出撃位置がランダムな通常の試合だけ。テストは上の固定の組み方）
const ROLE_VARIANTS = {
  // 近接で飛び込む型: 刃＋機動の補助
  attacker: [['blade', 'pad', 'bag'], ['scorpion', 'pad', 'bag'], ['scorpion', 'pad', 'teleport'], ['blade', 'pad', 'teleport'], ['scorpion', 'chameleon', 'pad'], ['blade', 'chameleon', 'teleport'],
    ['scorpion', 'shotgun', 'pad', 'teleport'], ['blade', 'pad', 'bag', 'teleport'], ['scorpion', 'chameleon', 'pad', 'teleport']],
  // 中距離で撃ち、寄られたら斬る型
  allround: [['blade', 'handgun', 'pad', 'bag'], ['scorpion', 'rifle', 'pad', 'bag'], ['blade', 'shotgun', 'pad', 'bag'], ['scorpion', 'launcher', 'pad', 'teleport'], ['blade', 'rifle', 'pad', 'teleport'],
    ['scorpion', 'handgun', 'pad', 'chameleon'], ['blade', 'launcher', 'pad', 'bag'], ['scorpion', 'shotgun', 'teleport', 'pad'], ['blade', 'handgun', 'teleport', 'bag']],
  // 撃つだけの型（銃＋補助）
  shooter: [['rifle', 'pad', 'bag'], ['handgun', 'pad', 'teleport', 'bag'], ['launcher', 'pad', 'bag'], ['shotgun', 'pad', 'teleport', 'chameleon'], ['rifle', 'pad', 'teleport']],
  // 狙撃型: 狙撃銃＋寄られたときの銃か補助
  sniper: [['snipe', 'pad', 'bag'], ['lightning', 'pad', 'bag'], ['ibis', 'pad', 'bag'], ['snipe', 'handgun', 'pad', 'bag'], ['lightning', 'rifle', 'pad', 'bag'], ['ibis', 'pad', 'bag', 'teleport'], ['snipe', 'pad', 'teleport'], ['lightning', 'shotgun', 'pad', 'bag']],
}
const pickClass = (trig, cls) => trig.find(t => TRIGGER_CLASS[t] === cls) || null
export const sniperSpec = u => SNIPERS[u.sniper] || SNIPERS.snipe
// 武器の待ち時間: 人が操作する自機には無い（撃つたびに EN を使うので、それが歯止め）。CPU は表の値で間をあける
const cdOf = (st, u, cd) => u.player && !st.autoplay ? 0 : cd
// 組んだギアから役割（CPU の動き方と見た目）を決める
export function roleOf(trig) {
  const melee = pickClass(trig, 'melee'), gun = pickClass(trig, 'gun')
  if (pickClass(trig, 'sniper')) return 'sniper'
  if (melee && gun) return 'allround'
  if (melee) return 'attacker'
  return 'shooter'
}
// 組み方の検査: 知らない名前を落とし、近接・射撃・狙撃は1つずつまで、4つまで、攻撃用を1つ以上
const LEGACY_ID = { shoot: 'handgun', hound: 'rifle', meteora: 'launcher' } // 以前の射撃トリガーの名前（保存済みの組み方を読めるように）
export function validTriggers(list) {
  const seen = new Set()
  const t = [...new Set((list || []).map(x => LEGACY_ID[x] || x).filter(x => TRIGGERS.includes(x)))].filter(x => {
    const c = TRIGGER_CLASS[x]
    if (seen.has(c)) return false
    seen.add(c); return true
  }).slice(0, TRIGGER_SLOTS)
  return t.some(x => ATTACK_TRIGGERS.includes(x)) ? t : null
}
const ROSTER = [
  { team: 0, role: 'allround', name: 'あなた', player: true, x: -4, z: 40 },
  { team: 0, role: 'attacker', name: 'アタッカー', x: -10, z: 39 },
  { team: 0, role: 'sniper', name: 'スナイパー', x: 6, z: 41 },
  { team: 1, role: 'attacker', name: 'アタッカー', x: 10, z: -39 },
  { team: 1, role: 'sniper', name: 'スナイパー', x: -6, z: -41 },
  { team: 1, role: 'allround', name: 'オールラウンダー', x: 4, z: -40 },
]

export function createState(seed = Date.now(), opts = {}) {
  const st = {
    rand: rng(seed),
    phase: 'play',          // play | over
    endReason: null,        // time | overtime
    winner: -1,             // 0 | 1 | -1(引き分け)
    t: 0,
    timeLeft: opts.time ?? MATCH_TIME,
    score: [0, 0],
    overtime: false,
    overtimeT: 0,
    units: [],
    bullets: [],
    pads: [],
    events: [],
    stage: STAGES[opts.stage] ? opts.stage : 'city',
    blocks: (opts.blocks || (STAGES[opts.stage] || STAGES.city).blocks).map((b, i) => ({ ...b, id: b.id ?? i, hp: blockHp(b), maxHp: blockHp(b) })), // 壊れるので試合ごとに写す
    mainMap: !opts.blocks,
    autoplay: !!opts.autoplay,  // 自機もAIに任せる（検証・観戦用）
  }
  // 出撃位置: 既定は毎回ランダム。テストは固定（以前の位置）
  const mine3 = opts.spawn === 'fixed' ? LEGACY_SPAWN : pickSpawns(st)
  ROSTER.forEach((r, i) => {
    const sp = mine3[i % 3], sgn = r.team === 0 ? 1 : -1
    r = { ...r, x: sp[0] * sgn, z: sp[1] * sgn }
    // 自機の役割は出撃前に選ぶ（allround = ブレード＋スプリッター、sniper = 狙撃＋スプリッター）
    // 自機は出撃前に組んだギア（無ければ役割の既定）。古い loadout 指定も受ける
    const mine = r.player && (validTriggers(opts.triggers) || (opts.loadout === 'sniper' ? ['snipe', 'shoot', 'pad', 'bag'] : null))
    const slotRole = opts.spawn !== 'fixed' && r.role === 'allround' && !r.player && st.rand() < 0.35 ? 'shooter' : r.role // 隊の真ん中は銃だけの型にもなる
    const variants = opts.spawn !== 'fixed' && ROLE_VARIANTS[slotRole]
    const trig = mine || (variants ? variants[Math.floor(st.rand() * variants.length)] : ROLE_TRIGGERS[r.role])
    const ammo = r.player && AMMO[opts.ammo] ? opts.ammo : variants ? AMMO_TYPES[Math.floor(st.rand() * AMMO_TYPES.length)] : 'normal'
    const role = roleOf(trig) // 組み方から役割を決める（CPU も）
    st.units.push({
      id: i, team: r.team, role, trig, name: r.name, player: !!r.player,
      melee: pickClass(trig, 'melee'), gun: pickClass(trig, 'gun'), sniper: pickClass(trig, 'sniper'), ammo,
      sense: r.player ? (SENSES.includes(opts.sense) ? opts.sense : null) : variants ? SENSES[Math.floor(st.rand() * SENSES.length)] : null,
      cham: false, teleCd: 0, stats: r.player && opts.stats ? validStats(opts.stats, opts.statBonus) : { ...(ROLE_STATS[role] || ROLE_STATS.allround), ...(opts.spawn === 'fixed' ? { spd: 3, en: 3, atk: 3, jmp: 3 } : {}) },
      x: r.x, y: 0, z: r.z, vx: 0, vy: 0, vz: 0,
      yaw: Math.atan2(-r.x, -r.z), grounded: true, speed: 0, // 最初は街の中心を向く
      en: MAX_EN, maxEn: MAX_EN, leak: 0, wounds: [], alive: true, outT: -1, lastHitBy: -1, kills: 0, deaths: 0,
      bladeT: -1, bladeHit: [], bladeCd: 0, shootCd: 0.5, shootT: -1, padCd: 0, padAir: 0,
      snipeT: -1, snipeCd: 0.5, hist: [], bag: false, dashT: -1, dashCd: 0, dashX: 0, dashZ: 0,
      stun: 0, hurtT: -1, shieldT: 0,
      targetId: -1,
      ai: { think: 0, targetId: -1, strafe: st.rand() < 0.5 ? -1 : 1, dodgeT: 0, side: st.rand() < 0.5 ? -1 : 1, lastX: r.x, lastZ: r.z, stuckT: 0, reaction: 0.25 + st.rand() * 0.2 },
    })
  })
  for (const u of st.units) { u.maxEn = statEn(u.stats.en); u.en = u.maxEn } // ステータスの EN 量
  return st
}

// ---------------------------------------------------------------- 地形
function groundAt(st, x, z, y) {
  let g = 0
  for (const b of st.blocks) {
    if (b.h > g && y >= b.h - 0.35 && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) g = b.h
  }
  return g
}
// 建物の耐久: 大きさで決まる。ベランダで登る高層ビル（26m超）と屋上の物・足場そのものは壊れない（建物ごと崩れる）
export const BLDG_DMG = { bullet: 1, snipe: 1, blast: 2.5 }
function blockHp(b) { return !b.kind && b.h <= 26 ? Math.round(40 + b.w * b.d * b.h * 0.02) : Infinity }
// 建物に当たった: 屋上の物に当たったら持ち主の建物が受ける。尽きたら崩れてがれきになる（上に乗っていた者は落ちる）
function damageBlock(st, b, amount) {
  if (!b || b.kind === 'rubble' || st.phase !== 'play') return
  const t = b.kind ? st.blocks.find(p => p.id === b.parent) : b
  if (!t || !Number.isFinite(t.hp)) return
  t.hp -= amount
  st.events.push({ type: 'bhit', id: t.id, ratio: Math.max(0, t.hp / t.maxHp) })
  if (t.hp > 0) return
  st.blocks = st.blocks.filter(o => o.id !== t.id && o.parent !== t.id)
  st.blocks.push({ id: 100000 + t.id, x: t.x, z: t.z, w: Math.max(2, t.w - 1.2), d: Math.max(2, t.d - 1.2), h: 1.2, kind: 'rubble', hp: Infinity, maxHp: Infinity })
  st.events.push({ type: 'collapse', id: t.id, x: t.x, z: t.z, w: t.w, d: t.d, h: t.h })
}
// 浮いた板（ベランダ）は y0 から上だけ。ふつうの建物は地面から
const base = b => b.y0 || 0
const oneWay = b => b.y0 && b.kind === 'ledge' // ベランダだけが下から抜けられる床。モールの床は天井として頭がぶつかる

function collideBlocks(st, u) {
  for (const b of st.blocks) {
    if (oneWay(b)) continue // 浮いた床（ベランダ・モールの床）は下からすり抜けて上に乗る。横からは押さない（壁側へ押してめり込ませないため）
    if (u.y >= b.h - 0.35 || u.y + UNIT_H <= base(b)) continue // 上に乗っている・下をくぐっている（入口の上の梁など）
    const hx = b.w / 2, hz = b.d / 2
    const cx = Math.max(b.x - hx, Math.min(u.x, b.x + hx))
    const cz = Math.max(b.z - hz, Math.min(u.z, b.z + hz))
    let dx = u.x - cx, dz = u.z - cz
    const d = Math.hypot(dx, dz)
    if (d >= UNIT_R) continue
    if (d > 1e-6) {
      const push = UNIT_R - d
      u.x += dx / d * push; u.z += dz / d * push
      const vn = u.vx * dx / d + u.vz * dz / d
      if (vn < 0) { u.vx -= vn * dx / d; u.vz -= vn * dz / d }
    } else {
      // 中心が箱の中に入った: 一番近い面から出す
      const px = hx - Math.abs(u.x - b.x), pz = hz - Math.abs(u.z - b.z)
      if (px < pz) u.x = b.x + Math.sign(u.x - b.x || 1) * (hx + UNIT_R)
      else u.z = b.z + Math.sign(u.z - b.z || 1) * (hz + UNIT_R)
    }
  }
}

// 線分が建物を通るか（スラブ法）
function segHitsBox(ax, ay, az, bx, by, bz, b) {
  const o = [ax, ay, az], d = [bx - ax, by - ay, bz - az]
  const mn = [b.x - b.w / 2, b.y0 || -1, b.z - b.d / 2], mx = [b.x + b.w / 2, b.h, b.z + b.d / 2]
  let t0 = 0, t1 = 1
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return false; continue }
    let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i]
    if (ta > tb) { const s = ta; ta = tb; tb = s }
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return false
  }
  return true
}
// 半直線と箱が最初に交わる距離。交わらなければ Infinity
function rayBox(ox, oy, oz, dx, dy, dz, b) {
  const o = [ox, oy, oz], d = [dx, dy, dz]
  const mn = [b.x - b.w / 2, b.y0 || -1, b.z - b.d / 2], mx = [b.x + b.w / 2, b.h, b.z + b.d / 2]
  let t0 = 0, t1 = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return Infinity; continue }
    let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i]
    if (ta > tb) { const s = ta; ta = tb; tb = s }
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return Infinity
  }
  return t0
}
export function lineOfSight(st, a, b) {
  for (const k of st.blocks) if (segHitsBox(a.x, a.y + 1.4, a.z, b.x, b.y + 1.0, b.z, k)) return false
  return true
}
function pointInBlock(st, x, y, z) {
  for (const b of st.blocks) if (y < b.h && y >= base(b) && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b
  return null
}

function angleLerp(a, b, k) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * k
}

// ---------------------------------------------------------------- ダメージと強制帰還
function damage(st, target, amount, leak, src, kind, dirx, dirz) {
  if (!target.alive || target.shieldT > 0) return false
  if (src && src.stats) amount *= statAtk(src.stats.atk) // ステータスの攻撃
  if (src && adverse(src)) amount *= ADVERSITY_ATK // 逆境
  target.en -= amount
  target.wounds.push({ rate: leak, t: amount * LEAK_SEC_PER_DMG })
  target.leak = Math.min(LEAK_MAX, target.wounds.reduce((a, w) => a + w.rate, 0))
  target.lastHitBy = src.id
  target.revealT = 0.4 // ミラージュ中でも、撃たれた瞬間だけ輪郭がゆらめく
  target.lastHow = kind === 'blade' ? src.melee : kind === 'snipe' ? src.sniper : src.gun // 何で倒されたか（画面に出す）
  target.hurtT = 0
  st.events.push({ type: 'hit', kind, id: target.id, src: src.id, x: target.x, y: target.y + 1.1, z: target.z, amount })
  if (target.en <= 0) bailout(st, target)
  return true
}

function bailout(st, u) {
  if (!u.alive) return
  u.alive = false
  u.en = 0
  u.deaths++
  u.outT = 0
  u.bladeT = -1
  const killer = st.units[u.lastHitBy]
  if (killer && killer.team !== u.team) {
    st.score[killer.team] += SCORE.kill
    killer.kills++
  }
  st.events.push({ type: 'bailout', id: u.id, team: u.team, killer: killer ? killer.id : -1, how: u.lastHow || null, x: u.x, y: u.y, z: u.z })
}

// 再出撃: 生きている敵からできるだけ離れ（レーダーの外）、味方に近い空き地へ出す
function respawnPoint(st, u) {
  const foes = aliveEnemies(st, u), mates = st.units.filter(m => m.alive && m.team === u.team && m !== u)
  let best = null, bestScore = -Infinity
  for (let k = 0; k < 60; k++) {
    const x = (st.rand() * 2 - 1) * (MAP_HALF - 6), z = (st.rand() * 2 - 1) * (MAP_HALF - 6)
    if (st.blocks.some(b => base(b) < 2.5 && Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5)) continue
    if (st.stage === 'mall' && (Math.abs(x) > MALL.x - 3 || Math.abs(z) > MALL.z - 3)) continue
    const df = foes.length ? Math.min(...foes.map(e => Math.hypot(e.x - x, e.z - z))) : 999
    const dm = mates.length ? Math.min(...mates.map(m => Math.hypot(m.x - x, m.z - z))) : 0
    const score = Math.min(df, RADAR_RANGE + 15) * 2 - dm * 0.3
    if (score > bestScore) { bestScore = score; best = [x, z] }
  }
  return best || [u.team === 0 ? 0 : 0, u.team === 0 ? MAP_HALF - 8 : -(MAP_HALF - 8)]
}
function respawn(st, u) {
  const [x, z] = respawnPoint(st, u)
  Object.assign(u, {
    x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: Math.atan2(-x, -z), grounded: true, speed: 0,
    en: u.maxEn, leak: 0, wounds: [], alive: true, outT: -1, lastHitBy: -1,
    bladeT: -1, bladeHit: [], bladeCd: 0, shootCd: 0.5, shootT: -1, padCd: 0, padAir: 0,
    snipeT: -1, snipeCd: 0.5, hist: [], bag: false, dashT: -1, dashCd: 0, stun: 0, hurtT: -1,
    shieldT: SPAWN_SHIELD, targetId: -1, cham: false, teleCd: 0, slow: 0, slowT: 0, weights: 0,
  })
  Object.assign(u.ai, { think: 0, targetId: -1, lastX: x, lastZ: z, stuckT: 0, dodgeT: 0 })
  st.events.push({ type: 'respawn', id: u.id, team: u.team, x, y: 0, z })
}

// ---------------------------------------------------------------- 狙い
function aliveEnemies(st, u) { return st.units.filter(e => e.alive && e.team !== u.team) }
// その隊から見えている（レーダーか目で捉えている）か。味方の誰か1人が捉えていれば隊全体で分かる。
// ステルスマント中はレーダーに映らず、目で見つかるのも45m以内
// レーダーの点だけで分かるか（ミラージュ中の相手。マントを着ていれば映らない）
export function radarBlip(st, team, e) {
  if (!e.cham || e.bag) return false
  return st.units.some(a => a.alive && a.team === team && Math.hypot(a.x - e.x, a.z - e.z) < (a.sense === 'hawk' ? HAWK_RADAR : RADAR_RANGE))
}
export function detectable(st, team, e) {
  if (e.cham) return false // ミラージュ中は目に映らない（狙いも付けられない）。レーダーにだけ映る（radarBlip）
  const sight = e.bag ? BAG_SIGHT : SIGHT
  return st.units.some(a => {
    if (!a.alive || a.team !== team) return false
    const d = Math.hypot(a.x - e.x, a.z - e.z)
    return (!e.bag && d < (a.sense === 'hawk' ? HAWK_RADAR : RADAR_RANGE)) || (d < sight && lineOfSight(st, a, e)) // 鷹の目はレーダーが広い
  })
}
function knownEnemies(st, u) { return aliveEnemies(st, u).filter(e => detectable(st, u.team, e)) }

// 自機のロックオン。aimYaw（カメラの向き）があれば、その向きに近い敵だけを選ぶ
const AIM_CONE = Math.cos(38 * Math.PI / 180)
export function pickLock(st, u, prefer = -1, exclude = -1, aimYaw = null) {
  let best = null, bestScore = Infinity
  for (const e of knownEnemies(st, u)) {
    if (e.id === exclude) continue
    const dx = e.x - u.x, dz = e.z - u.z, d = Math.hypot(dx, dz)
    if (d > LOCK_RANGE) continue
    if (aimYaw !== null) {
      const c = d > 0.01 ? (dx * Math.sin(aimYaw) + dz * Math.cos(aimYaw)) / d : 1
      if (c < AIM_CONE) continue
      const vis = lineOfSight(st, u, e)
      const s = Math.acos(Math.min(1, c)) * 30 + d * 0.15 + (vis ? 0 : 12) - (prefer === e.id ? 4 : 0)
      if (s < bestScore) { bestScore = s; best = e }
      continue
    }
    const facing = d > 0.01 ? (dx * Math.sin(u.yaw) + dz * Math.cos(u.yaw)) / d : 1
    const vis = lineOfSight(st, u, e)
    const s = d * (1.6 - facing * 0.6) + (vis ? 0 : 20) - (prefer === e.id ? 6 : 0)
    if (s < bestScore) { bestScore = s; best = e }
  }
  return best
}

// ---------------------------------------------------------------- 行動
function fire(st, u, target) {
  const gun = GUNS[u.gun] || GUNS.handgun, am = AMMO[u.ammo] || AMMO.normal
  u.en -= Math.min(gun.cost, u.en - 1) // ENが少ないときは手持ちの分だけで撃てる（自分の弾で脱出はしない）
  u.shootT = 0
  u.shootCd = gun.rate // 連射の間隔（自機も CPU も同じ）
  const v = gun.v * am.v
  const ox = u.x + Math.sin(u.yaw) * 0.4, oy = u.y + 1.45, oz = u.z + Math.cos(u.yaw) * 0.4
  let ax, ay, az
  if (target) {
    // 少し先読みして撃つ（完全には合わせない）
    const d = Math.hypot(target.x - ox, target.z - oz)
    const tt = d / v * 0.8
    ax = target.x + target.vx * tt - ox
    ay = target.y + 1.0 + target.vy * tt * 0.3 - oy
    az = target.z + target.vz * tt - oz
    if (gun.grav) ay += 0.5 * gun.grav * (d / v) * (d / v) // 弧を描く弾は落ちる分だけ上を狙う
  } else if (u.aimPoint) {
    // 狙う相手がいなければ、画面中央の照準が指している点へ撃つ
    ax = u.aimPoint.x - ox; ay = u.aimPoint.y - oy; az = u.aimPoint.z - oz
  } else if (u.aimYaw !== undefined) {
    ax = Math.sin(u.aimYaw) * Math.cos(u.aimPitch); ay = Math.sin(u.aimPitch); az = Math.cos(u.aimYaw) * Math.cos(u.aimPitch)
  } else {
    ax = Math.sin(u.yaw); ay = -0.05; az = Math.cos(u.yaw)
  }
  const al = Math.hypot(ax, ay, az) || 1
  // 曲射弾が向かう点（相手か、照準の先）
  const tp = target ? { x: target.x, y: target.y + 1, z: target.z } : { x: ox + ax / al * 30, y: oy + ay / al * 30, z: oz + az / al * 30 }
  ax /= al; ay /= al; az /= al
  const baseYaw = Math.atan2(ax, az), basePitch = Math.asin(Math.max(-1, Math.min(1, ay)))
  u.curveSide = -(u.curveSide || 1) // 曲射弾は左右交互にふくらむ
  // 散り: 基本 ＋ 撃ち続けた分（ライフル）＋ 走りながら（ハンドガンは散らない）
  const spread = gun.spread + (u.bloom || 0) + gun.move * 0.05 * Math.min(1, u.speed / RUN)
  u.bloom = Math.min(0.06, (u.bloom || 0) + gun.bloom)
  for (let i = 0; i < gun.n; i++) {
    // 散らばりは撃つ向き基準（世界の軸で散らすと撃つ向きで当たりやすさが変わる）
    let yw = baseYaw + (st.rand() - 0.5) * 2 * spread
    const pt = basePitch + (st.rand() - 0.5) * 2 * spread * 0.6
    if (am.curve) yw += u.curveSide * am.curve
    st.bullets.push({
      x: ox, y: oy, z: oz, vx: Math.sin(yw) * Math.cos(pt) * v, vy: Math.sin(pt) * v, vz: Math.cos(yw) * Math.cos(pt) * v,
      life: gun.life / am.v * (am.curve ? 1.25 : 1), team: u.team, owner: u.id, kind: u.ammo || 'normal',
      dmg: gun.dmg * am.dmg, grav: gun.grav || 0, blast: Math.max(gun.blast || 0, am.blast || 0), big: !!gun.blast,
      home: am.turn && target ? target.id : -1, turn: am.turn || 0, tp: am.curve ? tp : null, age: 0, slow: am.slow || 0, head: gun.head, kb: gun.kb,
    })
  }
  st.events.push({ type: 'shoot', id: u.id, x: ox, y: oy, z: oz, gun: u.gun, ammo: u.ammo })
}

function snipe(st, u, target) {
  const sp = sniperSpec(u)
  const charge = Math.min(1, u.snipeT / sp.charge)
  u.snipeCd = cdOf(st, u, sp.cd)
  u.en -= Math.min(sp.cost, u.en - 1)
  const ox = u.x + Math.sin(u.yaw) * 0.5, oy = u.y + 1.55, oz = u.z + Math.cos(u.yaw) * 0.5
  let dx, dy, dz
  if (u.aimPoint && u.player && !st.autoplay) {
    // 人が撃つ狙撃は、狙いの固定に関係なく画面中央の照準の先へ飛ぶ（固定した敵へ勝手に曲げない）
    dx = u.aimPoint.x - ox; dy = u.aimPoint.y - oy; dz = u.aimPoint.z - oz
  } else if (target) {
    const h = target.hist
    const p = h.length ? h[Math.max(0, h.length - 1 - sp.lag)] : target
    dx = p.x - ox; dy = p.y + 1.0 - oy; dz = p.z - oz
  } else if (u.aimPoint) {
    dx = u.aimPoint.x - ox; dy = u.aimPoint.y - oy; dz = u.aimPoint.z - oz
  } else if (u.aimYaw !== undefined) {
    dx = Math.sin(u.aimYaw) * Math.cos(u.aimPitch); dy = Math.sin(u.aimPitch); dz = Math.cos(u.aimYaw) * Math.cos(u.aimPitch)
  } else { dx = Math.sin(u.yaw); dy = 0; dz = Math.cos(u.yaw) }
  const l = Math.hypot(dx, dy, dz) || 1
  dx /= l; dy /= l; dz /= l
  // 建物か地面に当たるまで
  let len = SNIPE_RANGE, hitBlk = null, hitY = 0
  for (const b of st.blocks) { const t = rayBox(ox, oy, oz, dx, dy, dz, b); if (t < len) { len = t; hitBlk = b } }
  const blkLen = len
  if (dy < -1e-6) len = Math.min(len, -oy / dy)
  // 線に一番手前で触れた相手（体は足元から頭までの縦の線として測る）
  let hit = null
  for (const e of st.units) {
    if (!e.alive || e.team === u.team) continue
    const t = (e.x - ox) * dx + (e.y + 1.0 - oy) * dy + (e.z - oz) * dz
    if (t < 0 || t > len) continue
    const py = oy + dy * t
    const cy = Math.max(e.y, Math.min(e.y + UNIT_H, py))
    if (Math.hypot(ox + dx * t - e.x, py - cy, oz + dz * t - e.z) < SNIPE_HIT_R) { hit = e; len = t; hitY = cy }
  }
  if (hit) {
    const hl = Math.hypot(dx, dz) || 1
    const head = u.sense === 'precise' && hitY > hit.y + 1.45 ? PRECISE_HEAD : 1 // 精密: 頭は1.3倍
    if (damage(st, hit, (sp.dmin + (sp.dmax - sp.dmin) * charge) * head, sp.leak * (0.5 + 0.5 * charge), u, 'snipe', dx / hl, dz / hl)) {
      hit.vx += dx / hl * sp.kick * charge; hit.vz += dz / hl * sp.kick * charge
    }
  }
  if (!hit && hitBlk && len === blkLen) damageBlock(st, hitBlk, (sp.dmin + (sp.dmax - sp.dmin) * charge) * BLDG_DMG.snipe)
  st.events.push({ type: 'snipe', id: u.id, x: ox, y: oy, z: oz, hx: ox + dx * len, hy: oy + dy * len, hz: oz + dz * len, hit: hit ? hit.id : -1, charge, gun: u.sniper })
}

function usePad(st, u, mx, mz) {
  u.padCd = PAD_CD
  u.en -= PAD_COST
  const air = !u.grounded
  u.padAir++ // 着地までに出した回数（地上の1回も数える）
  const m = Math.hypot(mx, mz)
  const dx = m > 0.1 ? mx / m : Math.sin(u.yaw), dz = m > 0.1 ? mz / m : Math.cos(u.yaw)
  st.pads.push({ x: u.x, y: u.y, z: u.z, yaw: Math.atan2(dx, dz), t: 0, team: u.team })
  u.vy = (air ? PAD_AIR_V : PAD_V) * (1 - (u.slow || 0) * 0.5) // 重りが付いているとエアステップも低い
  const push = air ? PAD_AIR_PUSH : PAD_PUSH
  u.vx = dx * push; u.vz = dz * push
  u.grounded = false
  st.events.push({ type: 'pad', id: u.id, x: u.x, y: u.y, z: u.z })
}

// input: { mx, mz, jump, pad, blade, shoot(押した瞬間), lock(ロックオン切替) }
function stepUnit(st, u, input) {
  const dt = STEP
  u.shootCd = Math.max(0, u.shootCd - dt)
  u.padCd = Math.max(0, u.padCd - dt)
  u.bladeCd = Math.max(0, u.bladeCd - dt)
  if (u.shootT >= 0) { u.shootT += dt; if (u.shootT > 0.25) u.shootT = -1 }
  if (u.hurtT >= 0) { u.hurtT += dt; if (u.hurtT > 0.4) u.hurtT = -1 }
  u.stun = Math.max(0, u.stun - dt)
  u.shieldT = Math.max(0, u.shieldT - dt)

  // ロックオン: 自機は毎ステップ選び直す（今の相手を少し優先）。切替は今の相手を除いて選ぶ
  // 手動で切り替えた相手は3秒間は自動で選び直さない
  const aiming = input.aimYaw !== undefined
  if (aiming) { u.aimYaw = input.aimYaw; u.aimPitch = input.aimPitch || 0 }
  let target = st.units[u.targetId]
  u.lockHold = Math.max(0, (u.lockHold || 0) - dt)
  if (input.lock) { target = pickLock(st, u, -1, u.targetId) || target; u.lockHold = 3 }
  else if (aiming && (u.lockHold <= 0 || !target || !target.alive)) target = pickLock(st, u, u.targetId, -1, u.aimYaw)
  else if (!target || !target.alive || (u.player && !st.autoplay && u.lockHold <= 0)) target = pickLock(st, u, u.targetId)
  if (target && (!target.alive || !detectable(st, u.team, target))) target = null
  if (input.lockOff) target = null // 狙いの固定を外している: 攻撃は照準の先へ
  u.targetId = target ? target.id : -1
  u.aimPoint = input.aimPoint || null

  const stunned = u.stun > 0
  // 移動
  let mx = stunned ? 0 : input.mx || 0, mz = stunned ? 0 : input.mz || 0
  const mag = Math.hypot(mx, mz)
  if (mag > 1) { mx /= mag; mz /= mag }
  const slashing = u.bladeT >= 0
  const control = (u.snipeT >= 0 ? sniperSpec(u).slow : 1) * (u.shootT >= 0 && u.gun ? GUNS[u.gun].slow : 1) * (slashing && u.grounded ? 0.35 : 1) * (u.grounded ? 1 : 0.75)
  u.slowT = Math.max(0, (u.slowT || 0) - dt); if (u.slowT <= 0) { u.slow = 0; u.weights = 0 }
  u.kbT = Math.max(0, (u.kbT || 0) - dt)
  u.revealT = Math.max(0, (u.revealT || 0) - dt)
  u.bloom = Math.max(0, (u.bloom || 0) - dt * 0.08) // 撃つのをやめると散りが収まる
  const heavy = 1 - (u.slow || 0) // 重り弾の重さ
  const run = RUN * statSpd(u.stats.spd) * heavy * (adverse(u) ? ADVERSITY_SPD : 1)
  const tx = mx * run * control, tz = mz * run * control
  const k = (mag > 0.05 ? ACCEL : FRICTION) * dt * (u.grounded ? 1 : 0.35)
  const dvx = tx - u.vx, dvz = tz - u.vz
  const dl = Math.hypot(dvx, dvz)
  if (dl <= k) { u.vx = tx; u.vz = tz } else { u.vx += dvx / dl * k; u.vz += dvz / dl * k }

  // ステルスマント: 自機は押すたびに着脱、CPU は着たい状態を渡す
  const wasBag = u.bag
  const hasBag = u.trig.includes('bag')
  if (input.bag && hasBag) u.bag = !u.bag
  if (input.bagSet !== undefined && hasBag) u.bag = input.bagSet
  if (u.bag) {
    u.en -= BAG_DRAIN * dt
    if (u.en < 3) u.bag = false
  }
  if (u.bag !== wasBag) st.events.push({ type: 'bag', id: u.id, on: u.bag })

  // ミラージュ: 押すたびに着脱。攻撃すると解ける
  const wasCham = u.cham
  if (u.trig.includes('chameleon')) {
    if (input.cham) u.cham = !u.cham
    if (input.chamSet !== undefined) u.cham = input.chamSet
    if (input.blade || input.shoot || input.snipe) u.cham = false
    if (u.cham) { u.en -= CHAMELEON_DRAIN * dt; if (u.en < 3) u.cham = false }
  }
  if (u.cham !== wasCham) st.events.push({ type: 'cham', id: u.id, on: u.cham })

  // ブリンク: 進む向き（無ければ向いている方）へ。建物の手前で止まる
  u.teleCd = Math.max(0, u.teleCd - dt)
  if (!stunned && input.tele && u.trig.includes('teleport') && u.teleCd <= 0 && u.en > TELEPORT_COST + 1 && u.bladeT < 0 && u.snipeT < 0) {
    let dx = mx, dz = mz
    if (Math.hypot(dx, dz) < 0.1) { dx = Math.sin(u.yaw); dz = Math.cos(u.yaw) }
    const l = Math.hypot(dx, dz); dx /= l; dz /= l
    const fx = u.x, fy = u.y, fz = u.z
    let best = 0
    const lim = MAP_HALF - UNIT_R
    for (let t = 0.5; t <= TELEPORT_DIST; t += 0.5) {
      const x = fx + dx * t, z = fz + dz * t
      if (Math.abs(x) > lim || Math.abs(z) > lim) break
      if (st.blocks.some(b => u.y < b.h - 0.35 && u.y + UNIT_H > base(b) && Math.abs(x - b.x) < b.w / 2 + UNIT_R && Math.abs(z - b.z) < b.d / 2 + UNIT_R)) break
      best = t
    }
    if (best >= 1) {
      u.x = fx + dx * best; u.z = fz + dz * best
      u.vx *= 0.3; u.vz *= 0.3
      u.teleCd = TELEPORT_CD; u.en -= TELEPORT_COST
      st.events.push({ type: 'teleport', id: u.id, x: fx, y: fy, z: fz, tx: u.x, ty: u.y, tz: u.z })
    }
  }

  // ダッシュ
  u.dashCd = Math.max(0, u.dashCd - dt)
  if (!stunned && input.dash && u.dashCd <= 0 && u.dashT < 0 && u.bladeT < 0 && u.snipeT < 0) {
    let dx = mx, dz = mz
    if (Math.hypot(dx, dz) < 0.1) { dx = -Math.sin(u.yaw); dz = -Math.cos(u.yaw) } // 入力が無ければ後ろへ
    const l = Math.hypot(dx, dz)
    u.dashX = dx / l; u.dashZ = dz / l
    u.dashT = 0; u.dashCd = DASH_CD; u.revealT = 0.4 // ダッシュは EN を使わない（待ち時間だけ）。踏み出しの瞬間はミラージュがゆらめく
    st.events.push({ type: 'dash', id: u.id, x: u.x, y: u.y, z: u.z })
  }
  if (u.dashT >= 0) {
    u.dashT += dt
    u.vx = u.dashX * DASH_V; u.vz = u.dashZ * DASH_V
    if (u.dashT >= DASH_T) { u.dashT = -1; u.vx *= 0.45; u.vz *= 0.45 }
  }

  // 向き: 攻撃中と防御中は相手へ、ふだんは進む方へ
  const acting = slashing || u.shootT >= 0 || u.snipeT >= 0
  if (acting && target) u.yaw = angleLerp(u.yaw, Math.atan2(target.x - u.x, target.z - u.z), Math.min(1, TURN_RATE * 1.5 * dt))
  else if (acting && aiming) u.yaw = angleLerp(u.yaw, u.aimYaw, Math.min(1, TURN_RATE * 1.5 * dt))
  else if (mag > 0.05) u.yaw = angleLerp(u.yaw, Math.atan2(mx, mz), Math.min(1, TURN_RATE * dt))

  // ジャンプ・エアステップ
  if (!stunned && input.jump && u.grounded && !slashing) {
    u.vy = JUMP_V * statJmp(u.stats.jmp) * (1 - (u.slow || 0) * 0.8); u.grounded = false // 重りの分だけジャンプも低い
    st.events.push({ type: 'jump', id: u.id })
  }
  if (!stunned && input.pad && u.trig.includes('pad') && u.padCd <= 0 && u.en > PAD_COST + 1 && u.padAir < PAD_MAX) usePad(st, u, mx, mz)

  // ブレード
  const ml = MELEE[u.melee] || MELEE.blade
  if (!stunned && input.blade && u.melee && u.bladeT < 0 && u.bladeCd <= 0 && u.dashT < 0) {
    u.bladeT = 0
    u.bladeHit = []
    if (target) {
      const d = Math.hypot(target.x - u.x, target.z - u.z)
      u.yaw = Math.atan2(target.x - u.x, target.z - u.z)
      if (d < 5 && d > 1.2) { u.vx = Math.sin(u.yaw) * ml.lunge; u.vz = Math.cos(u.yaw) * ml.lunge }
    } else if (aiming) u.yaw = u.aimYaw
    st.events.push({ type: 'blade', id: u.id, melee: u.melee })
  }
  if (u.bladeT >= 0) {
    u.bladeT += dt
    if (u.bladeT >= ml.from && u.bladeT <= ml.to) {
      const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw)
      for (const e of st.units) {
        if (!e.alive || e.team === u.team || u.bladeHit.includes(e.id)) continue
        const dx = e.x - u.x, dz = e.z - u.z, d = Math.hypot(dx, dz)
        if (d > ml.range + UNIT_R || Math.abs(e.y - u.y) > 1.8) continue
        if (d > 0.01 && (dx * fx + dz * fz) / d < ml.arc) continue
        u.bladeHit.push(e.id)
        const nx = d > 0.01 ? dx / d : fx, nz = d > 0.01 ? dz / d : fz
        if (damage(st, e, ml.dmg, ml.leak, u, 'blade', nx, nz)) { e.vx += nx * 6; e.vz += nz * 6 }
        else { u.vx -= nx * 5; u.vz -= nz * 5 } // 防がれたら弾かれる
      }
    }
    if (u.bladeT >= ml.time) { u.bladeT = -1; u.bladeCd = cdOf(st, u, ml.cd) }
  }

  // シューター
  if (!stunned && input.shoot && u.gun && u.shootCd <= 0 && u.en > 1.2 && u.bladeT < 0 && u.snipeT < 0) fire(st, u, target)

  // 狙撃: 押している間ためて、離したら撃つ
  u.snipeCd = Math.max(0, u.snipeCd - dt)
  if (u.sniper) {
    const sp = sniperSpec(u)
    if (u.snipeT >= 0) {
      u.snipeT = Math.min(sp.charge, u.snipeT + dt)
      if (!input.snipe || stunned) {
        if (u.snipeT >= sp.min && !stunned) snipe(st, u, target)
        u.snipeT = -1
      }
    } else if (!stunned && input.snipe && u.snipeCd <= 0 && u.en > 1.2 && u.shootT < 0) {
      u.snipeT = 0
      st.events.push({ type: 'charge', id: u.id })
    }
  }

  // 物理
  if (!u.grounded) u.vy -= GRAVITY * dt * (Math.abs(u.vy) < 3.5 ? 0.6 : 1) // 頂点の近くは少しふわっと浮く
  const prevY = u.y
  u.x += u.vx * dt; u.z += u.vz * dt
  const lim = MAP_HALF - UNIT_R
  u.x = Math.max(-lim, Math.min(lim, u.x)); u.z = Math.max(-lim, Math.min(lim, u.z))
  collideBlocks(st, u)
  u.y += u.vy * dt
  // 天井: 上へ動いて頭が浮いた物（床・梁）の下面に入ったら止める
  if (u.vy > 0) for (const b of st.blocks) {
    const bb = base(b)
    if (!bb || oneWay(b) || prevY + UNIT_H > bb + 0.05 || u.y + UNIT_H <= bb) continue
    if (Math.abs(u.x - b.x) < b.w / 2 + UNIT_R * 0.5 && Math.abs(u.z - b.z) < b.d / 2 + UNIT_R * 0.5) { u.y = bb - UNIT_H; u.vy = 0 }
  }
  const g = groundAt(st, u.x, u.z, prevY)
  if (u.y <= g) {
    if (!u.grounded) st.events.push({ type: 'land', id: u.id, x: u.x, y: g, z: u.z, hard: u.vy < -12 })
    u.y = g; u.vy = 0; u.grounded = true; u.padAir = 0
  } else if (u.grounded && u.y > g + 0.02) {
    u.grounded = false // 屋根から歩いて落ちた
  }
  u.speed = Math.hypot(u.vx, u.vz)

  // 漏れ: 傷ごとに時間が来たら止まる
  if (u.wounds.length) {
    for (const w of u.wounds) w.t -= dt
    u.wounds = u.wounds.filter(w => w.t > 0)
    u.leak = Math.min(LEAK_MAX, u.wounds.reduce((a, w) => a + w.rate, 0))
  } else u.leak = 0
  if (u.leak > 0) {
    u.en -= u.leak * dt
    if (u.en <= 0) bailout(st, u)
  }
}

// ---------------------------------------------------------------- CPU
function steer(st, u, dx, dz) {
  const m = Math.hypot(dx, dz)
  if (m < 1e-6) return { mx: 0, mz: 0 }
  dx /= m; dz /= m
  const blocked = (ax, az) => {
    for (const r of [1.2, 2.4]) if (pointInBlock(st, u.x + ax * r, u.y + 0.3, u.z + az * r)) return true
    return false
  }
  if (!blocked(dx, dz)) return { mx: dx, mz: dz }
  for (const deg of [35, 70, 105, 140]) {
    for (const s of [u.ai.side, -u.ai.side]) {
      const a = deg * Math.PI / 180 * s
      const rx = dx * Math.cos(a) + dz * Math.sin(a), rz = -dx * Math.sin(a) + dz * Math.cos(a)
      if (!blocked(rx, rz)) return { mx: rx, mz: rz }
    }
  }
  return { mx: dx, mz: dz }
}

// 回り込み: u から (tx,tz) への直線を最初にさえぎる建物を探し、
// その建物の4つの角（少し外側）のうち「自分→角→目標」が最短で、自分から直接行ける角へ向かう
function routeTo(st, u, tx, tz) {
  const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz) || 1
  let block = null, bt = Infinity
  for (const b of st.blocks) {
    if (u.y >= b.h - 0.35 || oneWay(b) || u.y + UNIT_H <= base(b)) continue // 乗っている高さより低い物・浮いた床・頭上の梁はさえぎらない
    const t = rayBox(u.x, u.y + 1, u.z, dx / d, 0, dz / d, b)
    if (t < d && t < bt) { bt = t; block = b }
  }
  if (!block) { u.ai.wp = null; return [dx / d, dz / d] }
  // 一度決めた角は着くまで変えない（毎回選び直すと、2つの角の中間で行き先が入れ替わり続けて動けなくなる）
  const ai = u.ai
  if (ai.wp && ai.wpBlock === block.id) {
    const cx = ai.wp[0] - u.x, cz = ai.wp[1] - u.z, cl = Math.hypot(cx, cz)
    if (cl > 1.0) return [cx / cl, cz / cl]
    ai.wpDone = ai.wp // 着いた角は、この建物を回る間は二度と選ばない
  }
  if (ai.wpBlock !== block.id) ai.wpDone = null
  const m = 1.3
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [block.x + sx * (block.w / 2 + m), block.z + sz * (block.d / 2 + m)])
  let best = null, bs = Infinity
  for (const c of corners) {
    const cx = c[0] - u.x, cz = c[1] - u.z, cl = Math.hypot(cx, cz)
    if (cl < 1.0 || (ai.wpDone && ai.wpDone[0] === c[0] && ai.wpDone[1] === c[1])) continue
    // 自分から角へまっすぐ行けるか（その建物自身にさえぎられないか）
    if (rayBox(u.x, u.y + 1, u.z, cx / cl, 0, cz / cl, block) < cl - 0.1) continue
    const sc = cl + Math.hypot(tx - c[0], tz - c[1])
    if (sc < bs) { bs = sc; best = c }
  }
  if (!best) return [dx / d, dz / d]
  ai.wp = best; ai.wpBlock = block.id
  const cx = best[0] - u.x, cz = best[1] - u.z, cl = Math.hypot(cx, cz) || 1
  return [cx / cl, cz / cl]
}

// 建物 n の屋上へ登る入力: 壁ぎわまで回り込み、屋根の中心へ向けてエアステップ、上昇が止まったら2回目。
// 屋上に着いていたら null
function climbInput(st, u, n) {
  const inside = Math.abs(u.x - n.x) < n.w / 2 - 0.3 && Math.abs(u.z - n.z) < n.d / 2 - 0.3
  if (inside && u.y > n.h - 0.3) return null
  const px = Math.max(n.x - n.w / 2, Math.min(n.x + n.w / 2, u.x)), pz = Math.max(n.z - n.d / 2, Math.min(n.z + n.d / 2, u.z))
  const near = Math.hypot(px - u.x, pz - u.z)
  const tc = [n.x - u.x, n.z - u.z], tl = Math.hypot(tc[0], tc[1]) || 1
  if (near < 2.5) return { mx: tc[0] / tl, mz: tc[1] / tl, pad: u.grounded || (u.vy < 2 && u.y < n.h + 0.5) }
  if (!u.grounded && u.y > 2) return { mx: tc[0] / tl, mz: tc[1] / tl }
  const rr = routeTo(st, u, px, pz), sv = steer(st, u, rr[0], rr[1])
  return { mx: sv.mx, mz: sv.mz }
}
// 相手が乗っている建物（屋上にいなければ null）
function roofUnder(st, t) {
  if (t.y < 2) return null
  return st.blocks.find(b => !b.kind && Math.abs(t.x - b.x) <= b.w / 2 && Math.abs(t.z - b.z) <= b.d / 2 && Math.abs(t.y - b.h) < 0.6) || null
}

const canShootRole = u => !!u.gun && (u.role === 'allround' || u.role === 'shooter')
const gunRange = u => (GUNS[u.gun] || GUNS.handgun).range
// CPU の撃ち方: 1秒撃って0.6秒止める、をくり返す（押しっぱなしの人と同じ連射で、撃ち続けはしない）
function burst(st, ai) { ai.fireT = ((ai.fireT || st.rand() * 1.6) + STEP) % 1.6; return ai.fireT < 1.0 }

function aiInput(st, u) {
  const dt = STEP
  const ai = u.ai
  ai.think -= dt
  // 検証用: 思考を長く止めて狙う相手も外した CPU はその場で待機する（テストの的）
  if (ai.think > 60 && ai.targetId === -1) return {}
  const enemies = knownEnemies(st, u)
  // 見えている敵がいなければ、最後に見た場所（無ければ中央）へ向かう
  const search = () => {
    // 探索先: 最後に見た場所。無ければ街のどこか（着いたか12秒たったら選び直す）
    ai.patrolT = (ai.patrolT || 0) - dt
    if (!ai.patrol || ai.patrolT <= 0 || Math.hypot(ai.patrol.x - u.x, ai.patrol.z - u.z) < 3) {
      ai.patrol = { x: (st.rand() * 2 - 1) * (MAP_HALF - 10), z: (st.rand() * 2 - 1) * (MAP_HALF - 10) }
      ai.patrolT = 12
    }
    // スナイパーは狙撃場所（屋上に手すり壁のある建物）へ向かい、エアステップで上がって待つ。
    // 25秒だれとも撃ち合わなければ、別の狙撃場所へ移る
    // 味方がいなくなったら、または試合が半分を過ぎたら、陣取るのをやめて探しに出る（狙撃手どうしのにらみ合いで止まらないように）
    const mates = st.units.some(a => a.alive && a.team === u.team && a.id !== u.id)
    if (u.role === 'sniper' && u.trig.includes('pad') && st.mainMap && STAGES[st.stage].nests.length && mates && st.t < MATCH_TIME / 2) {
      const standing = n => st.blocks.some(b => b.id === n.id) // 崩れた狙撃場所は使わない
      if (ai.nest && !standing(ai.nest)) ai.nest = null
      if (!ai.nest || ai.nestT > 25) {
        const far = STAGES[st.stage].nests.filter(n => n !== ai.nest && standing(n))
        ai.nest = far.reduce((a, b) => Math.hypot(b.x - u.x, b.z - u.z) < Math.hypot(a.x - u.x, a.z - u.z) ? b : a)
        ai.nestT = 0
      }
      const c = climbInput(st, u, ai.nest)
      if (!c) { ai.nestT += dt; return { bagSet: u.en > 8 } } // 屋上で待つ
      return { ...c, bagSet: u.en > 8 }
    }
    // 出撃直後の12秒は、散らばって転送された味方と合流しに向かう
    const allies = st.units.filter(a => a.alive && a.team === u.team && a.id !== u.id)
    let g = ai.lastSeen || ai.patrol, pace = 0.8
    if (!ai.lastSeen && st.t < REGROUP_T && allies.length) {
      g = { x: allies.reduce((a, b) => a + b.x, 0) / allies.length, z: allies.reduce((a, b) => a + b.z, 0) / allies.length }
      pace = Math.hypot(g.x - u.x, g.z - u.z) < 6 ? 0 : 0.7
    }
    if (ai.lastSeen && Math.hypot(g.x - u.x, g.z - u.z) < 2) ai.lastSeen = null
    const r = routeTo(st, u, g.x, g.z)
    const sv = steer(st, u, r[0], r[1])
    return { mx: sv.mx * pace, mz: sv.mz * pace, bagSet: u.role === 'sniper' && u.en > 8 }
  }
  if (!enemies.length) return search()
  if (ai.think <= 0) {
    ai.think = 0.25 + st.rand() * 0.2
    let best = null, bs = Infinity
    for (const e of enemies) {
      const d = Math.hypot(e.x - u.x, e.z - u.z)
      const s = d + (lineOfSight(st, u, e) ? 0 : 12) - (e.id === ai.targetId ? 3 : 0) + e.en * 0.04
      if (s < bs) { bs = s; best = e }
    }
    ai.targetId = best.id
    if (st.rand() < 0.15) ai.strafe *= -1
    // 動けていなければ回り込む向きを変え、エアステップで越える
    const moved = Math.hypot(u.x - ai.lastX, u.z - ai.lastZ)
    ai.stuckT = moved < 0.4 ? ai.stuckT + ai.think : 0
    ai.lastX = u.x; ai.lastZ = u.z
    // 飛んでくる弾や振りかぶった相手を見て、少し遅れて横へ逃げる
    let threat = false
    for (const b of st.bullets) {
      if (b.team === u.team) continue
      const rx = u.x - b.x, rz = u.z - b.z, rd = Math.hypot(rx, rz)
      if (rd < 10 && (rx * b.vx + rz * b.vz) / (rd * Math.hypot(b.vx, b.vz) + 1e-6) > 0.93) { threat = true; break }
    }
    const meleeThreat = enemies.some(e => e.bladeT >= 0 && Math.hypot(e.x - u.x, e.z - u.z) < 3.2)
    if ((threat || meleeThreat) && ai.dodgeT <= 0 && st.rand() < 0.5) { ai.dodgeT = 0.35 + st.rand() * 0.25; ai.strafe *= -1 }
  }
  ai.dodgeT = Math.max(0, ai.dodgeT - dt)
  const t = st.units[ai.targetId]
  if (t && t.alive && t.cham && !detectable(st, u.team, t) && ai.lastSeen && !ai.lostCham) {
    // ミラージュで消えた相手は見失う: 最後に見た場所を大きくずらし、まっすぐ歩いてこないようにする
    const a = st.rand() * Math.PI * 2, r = 9 + st.rand() * 9
    ai.lastSeen = { x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r }; ai.lostCham = true
  }
  if (!t || !t.alive || !detectable(st, u.team, t)) return search()
  ai.lastSeen = { x: t.x, z: t.z }; ai.lostCham = false
  ai.nestT = 0
  u.targetId = t.id
  const dx = t.x - u.x, dz = t.z - u.z, d = Math.hypot(dx, dz) || 1
  const vis = lineOfSight(st, u, t)
  const inp = {}
  let wx = 0, wz = 0
  // 相手との間に建物があれば、その建物の角を経由して回り込む
  const toward = () => {
    // モールで相手が別の階にいる: 上なら近い階段の下り口へ行って上る。下なら吹き抜けへ向かって飛び降りる
    if (st.stage === 'mall' && Math.abs(t.y - u.y) > 2.5) {
      const lv = Math.round(u.y / FH)
      if (t.y > u.y) {
        const ss = MALL.stairs.filter(s => s.k === lv)
        if (ss.length) {
          const s = ss.reduce((a, b) => Math.hypot(b.x - u.x, b.z0 - u.z) < Math.hypot(a.x - u.x, a.z0 - u.z) ? b : a)
          const onStair = Math.abs(u.x - s.x) < s.w / 2 && (u.z - s.z0) * s.dir > -1.5 && (u.z - s.z0) * s.dir < NSTEP * STEP_D + 1
          if (onStair) { wx = (s.x - u.x) * 0.3; wz = s.dir; return }
          const ex = s.x, ez = s.z0 - s.dir * 1.5
          const r = routeTo(st, u, ex, ez); wx = r[0]; wz = r[1]; return
        }
      } else { const r = routeTo(st, u, 0, 0); wx = r[0]; wz = r[1]; return }
    }
    const r = routeTo(st, u, t.x, t.z)
    wx = r[0]; wz = r[1]
  }
  const away = () => {
    wx = -dx / d; wz = -dz / d
    // 場の縁では真っすぐ下がると角に詰まるので、縁に沿って逃げる
    const m = MAP_HALF - 3
    if (Math.abs(u.x) > m && Math.sign(wx) === Math.sign(u.x)) { wz += Math.sign(wz || ai.strafe) * Math.abs(wx); wx = 0 }
    if (Math.abs(u.z) > m && Math.sign(wz) === Math.sign(u.z)) { wx += Math.sign(wx || ai.strafe) * Math.abs(wz); wz = 0 }
    if (Math.abs(u.x) > m && Math.abs(u.z) > m) { wx = -Math.sign(u.x); wz = -Math.sign(u.z) * 0.3 } // 角からは出る
  }
  const strafe = (fwd = 0) => { wx = -dz / d * ai.strafe + dx / d * fwd; wz = dx / d * ai.strafe + dz / d * fwd }

  // 削られて不利なら、相手との間に建物を挟む位置へ下がる。
  // 傷の流出は時間で止まるので、隠れ続けると試合が動かなくなる。4秒隠れたら6秒は下がらずに戦う
  ai.hideT = ai.hideT || 0; ai.braveT = Math.max(0, (ai.braveT || 0) - dt)
  if (u.en < 22 && t.en > u.en + 15 && t.en > 25 && ai.braveT <= 0) {
    ai.hideT += dt
    if (ai.hideT > 4) { ai.hideT = 0; ai.braveT = 6 }
    if (vis) {
      away()
      if (d < 7 && st.rand() < 0.05) { inp.dash = true; inp.tele = true }
      if (u.grounded && d < 6 && st.rand() < 0.04) inp.pad = true
    } else {
      wx = 0; wz = 0
    }
    if (canShootRole(u) && vis && d < gunRange(u) && u.shootCd <= 0 && burst(st, ai) && u.en > 1.2) inp.shoot = true
    const s = steer(st, u, wx, wz)
    inp.mx = s.mx; inp.mz = s.mz
    inp.bagSet = u.en > 6 // 逃げるときはマントを着て見失わせる
    return inp
  }

  const canBlade = u.role === 'attacker' || u.role === 'allround'
  const canShoot = canShootRole(u)
  const reactOk = st.rand() < dt / ai.reaction  // 反応の遅れ（平均 reaction 秒）

  if (u.role === 'sniper') {
    // スナイパー: 離れた所から、見えていれば止まってためて撃つ。寄られたら逃げる。撃ったら場所を変える
    const perched = ai.nest && Math.abs(u.x - ai.nest.x) < ai.nest.w / 2 && Math.abs(u.z - ai.nest.z) < ai.nest.d / 2 && u.y > ai.nest.h - 0.3
    if (perched && d >= 12) { wx = 0; wz = 0 } // 狙撃場所からは動かない
    else if (d < 12) { away(); if (u.grounded && st.rand() < 0.03) inp.pad = true; if (d < 6 && st.rand() < 0.06) inp.dash = true }
    else if (!perched && (!vis || d > 60)) toward()
    else if (!perched && u.snipeT < 0 && u.snipeCd > 0.4) strafe()
    if (vis && d >= 8 && d < 70 && (u.snipeT >= 0 || (u.snipeCd <= 0 && reactOk && u.en > 1.2))) {
      if (u.snipeT < 0) { const sp = sniperSpec(u); ai.snipeAt = Math.max(sp.min + 0.02, sp.charge * (0.55 + st.rand() * 0.45)) }
      inp.snipe = u.snipeT < ai.snipeAt
    }
    if (ai.stuckT > 0.8) ai.side *= -1
  } else if ((u.role === 'attacker' || u.role === 'allround') && roofUnder(st, t) && u.y < t.y - 1.5 && d < 30) {
    // 相手が屋上にいる: その建物に登る（届く高さなら）
    const n = roofUnder(st, t)
    const c = n.h <= 26 ? climbInput(st, u, n) : null
    if (c) { if (c.pad) inp.pad = true; wx = c.mx; wz = c.mz; inp.raw = true } else toward()
  } else if (u.role === 'attacker' || (u.role === 'allround' && d < 4)) {
    toward()
    if (d < (MELEE[u.melee] || MELEE.blade).range + 0.3 && Math.abs(t.y - u.y) < 1.6 && reactOk) inp.blade = true
    if (d > 7 && d < 16 && vis && st.rand() < 0.01) inp.tele = true // ブリンクで間合いを詰める
    if (d > 9 && u.grounded && st.rand() < 0.012) inp.pad = true
    if (u.role === 'attacker' && d > 5 && d < 10 && vis && st.rand() < 0.02) inp.dash = true
    if (t.y > u.y + 1.5 && d < 7 && u.grounded) inp.pad = true
  } else if (u.role === 'shooter') {
    if (d > 17 || !vis) toward()
    else if (d < 9) away()
    else strafe()
    const closeMelee = enemies.find(e => (e.role === 'attacker' || e.role === 'allround') && Math.hypot(e.x - u.x, e.z - u.z) < 3.5)
    if (closeMelee && u.grounded && st.rand() < 0.03) { inp.pad = true; wx = (u.x - closeMelee.x); wz = (u.z - closeMelee.z) }
  } else {
    // オールラウンダー: 中距離で撃ち、寄られたら斬る
    if (d > 18 || !vis) toward()
    else strafe(d > 10 ? 0.5 : -0.2)
  }
  if (canShoot && vis && d < gunRange(u) && u.shootCd <= 0 && burst(st, ai) && !inp.blade && ai.dodgeT <= 0 && u.en > 1.2) inp.shoot = true
  if (!canBlade) inp.blade = false

  // 登っている間は壁へ真っすぐ向かうので、障害物よけを通さない
  const s = inp.raw ? { mx: wx, mz: wz } : steer(st, u, wx, wz)
  delete inp.raw
  inp.mx = s.mx; inp.mz = s.mz
  if (ai.stuckT > 0.8) {
    ai.side *= -1
    if (u.grounded) inp.pad = true
    ai.stuckT = 0
  }
  inp.bagSet = u.role === 'sniper' && u.en > 8 // スナイパーは基本的にマントを着て位置を隠す
  // ミラージュを持つ CPU: 近づく間だけ姿を消し、間合いに入ったら解いて攻撃（攻撃すると自動で解ける）
  if (u.trig.includes('chameleon') && u.role !== 'sniper') inp.chamSet = d > 5 && d < 45 && u.en > 25 && !inp.shoot && !inp.blade
  return inp
}

// ---------------------------------------------------------------- 1ステップ
// playerInput は自機への入力。autoplay のときは無視して AI が動かす
export function step(st, playerInput = {}) {
  const dt = STEP
  st.t += dt
  for (const u of st.units) if (!u.alive && u.outT >= 0) u.outT += dt
  for (const p of st.pads) p.t += dt
  st.pads = st.pads.filter(p => p.t < 1.2)
  if (st.phase !== 'play') {
    stepBullets(st)
    return
  }
  if (st.overtime) st.overtimeT += dt
  else st.timeLeft = Math.max(0, st.timeLeft - dt)
  for (const u of st.units) if (!u.alive && u.outT >= respawnT(u)) respawn(st, u)
  for (const u of st.units) { u.hist.push({ x: u.x, y: u.y, z: u.z }); if (u.hist.length > SNIPE_LAG + 1) u.hist.shift() }

  // 毎ステップ同じ順だと先に処理される隊が撃ち合い・斬り合いで常に先手を取るので、1ステップごとに順を入れ替える
  st.tick = (st.tick || 0) + 1
  const order = st.tick % 2 ? st.units : [...st.units].reverse()
  for (const u of order) {
    if (!u.alive) continue
    const inp = u.player && !st.autoplay ? playerInput : aiInput(st, u)
    u.lastMove = Math.hypot(inp.mx || 0, inp.mz || 0); u.lastInp = [inp.mx || 0, inp.mz || 0] // 動こうとしている向き（引っかかりの検査用）
    stepUnit(st, u, inp)
  }
  // 同士の押し合い
  for (let i = 0; i < st.units.length; i++) {
    const a = st.units[i]
    if (!a.alive) continue
    for (let j = i + 1; j < st.units.length; j++) {
      const b = st.units[j]
      if (!b.alive || Math.abs(a.y - b.y) > 1.5) continue
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz)
      if (d > 0 && d < UNIT_R * 2) {
        const push = (UNIT_R * 2 - d) / 2
        a.x -= dx / d * push; a.z -= dz / d * push
        b.x += dx / d * push; b.z += dz / d * push
      }
    }
  }
  // 押し合いで壁の中へ押し込まれないよう、もう一度建物から押し出す
  for (const u of st.units) if (u.alive) collideBlocks(st, u)
  stepBullets(st)

  // 決着: 時間切れで撃破数の多い方。同点なら延長戦（先に撃破した方が勝ち、最長 OVERTIME_MAX 秒）
  if (st.timeLeft <= 0) {
    if (st.score[0] !== st.score[1]) endMatch(st, st.overtime ? 'overtime' : 'time')
    else if (!st.overtime) { st.overtime = true; st.overtimeT = 0; st.events.push({ type: 'overtime' }) }
    else if (st.overtimeT >= OVERTIME_MAX) endMatch(st, 'time')
  }
}

function stepBullets(st) {
  const dt = STEP
  for (let i = st.bullets.length - 1; i >= 0; i--) {
    const b = st.bullets[i]
    b.life -= dt
    b.age = (b.age || 0) + dt
    if (b.grav) b.vy -= b.grav * dt
    // 追尾弾: 狙った相手（見えていれば）へ、動く先を読んで少しずつ曲がる。曲射弾: ふくらんでから撃った時の狙いの点へ曲がる
    const steerTo = (tx, ty, tz, rate) => {
      const v = Math.hypot(b.vx, b.vy, b.vz)
      let dx = tx - b.x, dy = ty - b.y, dz = tz - b.z
      const l = Math.hypot(dx, dy, dz) || 1
      const k = Math.min(1, rate * dt)
      b.vx += (dx / l * v - b.vx) * k; b.vy += (dy / l * v - b.vy) * k; b.vz += (dz / l * v - b.vz) * k
      const v2 = Math.hypot(b.vx, b.vy, b.vz) || 1
      b.vx *= v / v2; b.vy *= v / v2; b.vz *= v / v2
    }
    if (b.home >= 0) {
      const t = st.units[b.home]
      if (t && t.alive && !t.cham) {
        const lead = Math.hypot(t.x - b.x, t.z - b.z) / (Math.hypot(b.vx, b.vz) || 1) * 0.8
        steerTo(t.x + t.vx * lead, t.y + 1.0, t.z + t.vz * lead, b.turn)
      }
    }
    if (b.tp && b.age > 0.08) steerTo(b.tp.x, b.tp.y, b.tp.z, 7)
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt
    let gone = b.life <= 0
    const inBlk = !gone && pointInBlock(st, b.x, b.y, b.z)
    if (!gone && (b.y <= 0.02 || inBlk || Math.abs(b.x) > MAP_HALF + 5 || Math.abs(b.z) > MAP_HALF + 5)) {
      gone = true
      if (inBlk && !b.blast) damageBlock(st, inBlk, b.dmg * BLDG_DMG.bullet)
      if (b.life > 0 && !b.blast) st.events.push({ type: 'spark', x: b.x, y: Math.max(0.05, b.y), z: b.z })
    }
    if (!gone && st.phase === 'play') {
      for (const u of st.units) {
        if (!u.alive || u.team === b.team) continue
        if (b.y < u.y - 0.1 || b.y > u.y + UNIT_H) continue
        const hr = Math.hypot(b.x - u.x, b.z - u.z)
        const r = UNIT_R + (b.big ? 0.3 : 0.12)
        if (hr > r) continue
        const v = Math.hypot(b.vx, b.vz) || 1
        const owner = st.units[b.owner], precise = owner && owner.sense === 'precise'
        const headHit = (b.head > 1 || precise) && b.y > u.y + 1.45 // 頭（首から上）に当たった
        if (!b.blast && damage(st, u, b.dmg * (headHit ? (b.head || 1) * (precise ? PRECISE_HEAD : 1) : 1), BULLET_LEAK, st.units[b.owner], headHit ? 'head' : 'bullet', b.vx / v, b.vz / v)) {
          if (b.slow) { u.weights = (u.slowT > 0 ? u.weights || 0 : 0) + 1; u.slow = Math.min(WEIGHT_MAX, u.weights * b.slow); u.slowT = WEIGHT_T }
          if (b.kb) { u.vx += b.vx / v * b.kb; u.vz += b.vz / v * b.kb; u.kbHits = (u.kbT > 0 ? u.kbHits || 0 : 0) + 1; u.kbT = 0.12; if (u.kbHits >= 5) u.stun = Math.max(u.stun, 0.25) } // 散弾が多く当たるとよろめく
        }
        else if (u.id !== b.owner) damage(st, u, b.dmg * 0.4, BULLET_LEAK, st.units[b.owner], 'bullet', b.vx / v, b.vz / v) // 直撃の分（残りは爆風）
        gone = true
        break
      }
    }
    // 爆発する弾（グレネードランチャー・炸裂弾）: どこかに当たるか飛び切ったら爆発。近いほど痛い（壁の向こうには届かない）
    if (gone && b.blast) {
      const g = { radius: b.blast, dmg: b.dmg, leak: 0.5 }, src = st.units[b.owner]
      const ex = b.x - b.vx * dt * 0.5, ey = Math.max(0.3, b.y - b.vy * dt * 0.5), ez = b.z - b.vz * dt * 0.5
      st.events.push({ type: 'explode', x: ex, y: ey, z: ez, r: g.radius, team: b.team })
      // 爆風は近くの建物も削る（箱までの距離で減衰）
      for (const k of [...st.blocks]) {
        if (k.kind) continue
        const qx = Math.max(k.x - k.w / 2, Math.min(k.x + k.w / 2, ex)), qz = Math.max(k.z - k.d / 2, Math.min(k.z + k.d / 2, ez)), qy = Math.min(k.h, ey)
        const dd = Math.hypot(qx - ex, qy - ey, qz - ez)
        if (dd < g.radius) damageBlock(st, k, g.dmg * (1 - 0.6 * dd / g.radius) * BLDG_DMG.blast)
      }
      if (st.phase === 'play') for (const u of st.units) {
        if (!u.alive || u.team === b.team) continue
        const d = Math.hypot(u.x - ex, u.y + 1 - ey, u.z - ez)
        if (d > g.radius) continue
        if (st.blocks.some(k => segHitsBox(ex, ey, ez, u.x, u.y + 1, u.z, k))) continue
        const nx = (u.x - ex) / (d || 1), nz = (u.z - ez) / (d || 1)
        if (damage(st, u, g.dmg * (1 - 0.6 * d / g.radius), g.leak, src, 'blast', nx, nz)) { const kb = Math.min(7, g.dmg * 0.45); u.vx += nx * kb; u.vz += nz * kb; if (g.dmg > 8) { u.vy = Math.max(u.vy, 4); u.grounded = false } } // 小さな爆発は軽く押すだけ
      }
    }
    if (gone) st.bullets.splice(i, 1)
  }
}

function endMatch(st, reason) {
  st.phase = 'over'
  st.endReason = reason
  st.winner = st.score[0] > st.score[1] ? 0 : st.score[1] > st.score[0] ? 1 : -1
  st.events.push({ type: 'over', reason, winner: st.winner })
}

export function drainEvents(st) {
  const ev = st.events
  st.events = []
  return ev
}

// 自機が退場したあと、残りを一気に計算して決着させる
export function fastForward(st, maxSteps = 60 * 400) {
  let n = 0
  while (st.phase === 'play' && n < maxSteps) { step(st, {}); n++ }
  return n
}
