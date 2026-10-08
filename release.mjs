// 公開の前に、読み込むファイルへキャッシュバスター（?v=日時）を付け直す。node release.mjs
import { readFileSync, writeFileSync } from 'node:fs'
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
const files = { 'index.html': /(\.\/src\/main\.js)(\?v=\w+)?/g, 'src/main.js': /(\.\/(?:city|game)\.js|\.\/models\/RobotExpressive\.glb)(\?v=\w+)?/g }
for (const [f, re] of Object.entries(files)) {
  const s = readFileSync(f, 'utf8'), out = s.replace(re, `$1?v=${v}`)
  writeFileSync(f, out)
  console.log(f, (s.match(re) || []).length, 'refs ->', v)
}
