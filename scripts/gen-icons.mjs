// 从 icon.svg 生成各尺寸 PNG 图标（PWA manifest + iOS apple-touch-icon）
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'fs'

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8')

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-180.png', size: 180 },
]

for (const { name, size } of targets) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  const png = resvg.render().asPng()
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), png)
  console.log('已生成', name, `(${size}x${size})`)
}
