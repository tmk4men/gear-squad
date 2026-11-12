// X（旧Twitter）のアプリ内ブラウザ対策。~/Desktop/claudecode/_shared/support.js の先頭の塊（支援リンクは入れない）。
// X の中と分かった時だけ <html class="inapp-x"> と --inapp-bot（下に逃がす高さ）を付ける。100svh が見えている高さより大きい時はその差も足す。
// 下に貼り付く操作は calc(env(safe-area-inset-bottom) + var(--inapp-bot,0px)) で逃がす。試験用に ?inapp=x / ?inapp=0
;(function () {
  var KEY = 'tm_inapp', BOT = '52px'
  var de = document.documentElement, ua = navigator.userAgent || '', on = null
  function store(v) { try { sessionStorage.setItem(KEY, v) } catch (e) {} }
  var m = /[?&]inapp=(x|0)(?:&|$)/.exec(location.search)
  if (m) { on = m[1] === 'x'; store(on ? 'x' : '0') }
  if (on === null) { try { var s = sessionStorage.getItem(KEY); if (s) on = s === 'x' } catch (e) {} }
  if (on === null) {
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    var other = /CriOS|FxiOS|EdgiOS|OPiOS|Line\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua)
    var ref = ''
    try { ref = document.referrer ? new URL(document.referrer).hostname : '' } catch (e) {}
    on = /\bTwitter/i.test(ua) || (ios && !other && /^(t\.co|(mobile\.)?(x|twitter)\.com)$/.test(ref))
    if (on) store('x')
  }
  if (on) de.classList.add('inapp-x')
  // 2026-11-12 X の別の形（上に帯・下に戻る/共有の列）では、100svh が見えている高さより大きく出て、
  // 画面の下に置いたボタン（開始など）が見えなくなった。100svh と実際の高さ（innerHeight）の差を測り、
  // 差がある時だけその分も --inapp-bot に足す。ふつうのブラウザでは差は0なので何も変わらない。
  var sent = false
  function apply() {
    var diff = 0
    try {
      var p = document.createElement('div')
      p.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:100svh;visibility:hidden;pointer-events:none'
      ;(document.body || de).appendChild(p)
      diff = Math.round(p.getBoundingClientRect().height - window.innerHeight)
      p.parentNode.removeChild(p)
    } catch (e) {}
    if (!(diff >= 2 && diff <= 400)) diff = 0
    var px = (on ? parseInt(BOT, 10) : 0) + diff
    if (px) de.style.setProperty('--inapp-bot', px + 'px'); else de.style.removeProperty('--inapp-bot')
    // どのブラウザでずれが出るかを後で見るため、ずれた時だけ計測に1回送る
    if (diff && !sent && window.dataLayer) { sent = true; try { window.dataLayer.push(['event', 'vh_short', { diff: diff, inapp: on ? 1 : 0, ih: window.innerHeight }]) } catch (e) {} }
  }
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', function () { setTimeout(apply, 300) })
})();
