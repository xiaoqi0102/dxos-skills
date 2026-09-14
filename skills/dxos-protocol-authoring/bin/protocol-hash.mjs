#!/usr/bin/env node
/**
 * DX OS 协议 hash 工具
 *
 * 用法：
 *   # 1) 算单份（或多份）协议 JSON 的 hash
 *   node --experimental-transform-types protocol-hash.mjs <protocol.json> [...]
 *
 *   # 2) 体检协议仓库：逐条核对 hash，找出「会被静默丢弃」的版本
 *   node --experimental-transform-types protocol-hash.mjs --verify-store "<data/custom-protocols-v2.json>"
 *
 * 背景：repository.ts 的 parseEntry() 会重算 hash，
 *   `if (versionObject.hash && String(versionObject.hash) !== hash) continue`
 * 对不上就静默丢弃整个版本 —— 表现是「导入成功但版本没出现」。
 * 所以写入仓库前一定要先在这里核对 hash。
 *
 * hash 算法（与 repository.ts 的 canonical() 完全一致）：
 *   对象按 key localeCompare 排序、数组保序，拼成 {"k":v} / [a,b] 后 sha256。
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function protocolV2Hash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

const argv = process.argv.slice(2)
if (!argv.length) {
  console.error('用法: protocol-hash.mjs <protocol.json> [...] | --verify-store <store.json>')
  process.exit(2)
}

if (argv[0] === '--verify-store') {
  const storePath = argv[1]
  if (!storePath) {
    console.error('--verify-store 需要传入 custom-protocols-v2.json 路径')
    process.exit(2)
  }
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  if (store.format !== 'dx-custom-protocols/v2') {
    console.error(`format 不是 dx-custom-protocols/v2（实际 ${store.format}）→ 整个仓库都会被忽略`)
    process.exit(1)
  }
  let total = 0
  let bad = 0
  for (const kind of ['provider', 'model']) {
    for (const [id, entry] of Object.entries(store[kind] || {})) {
      for (const [verKey, ver] of Object.entries(entry?.versions || {})) {
        total += 1
        const actual = protocolV2Hash(ver.protocol)
        const ok = !ver.hash || String(ver.hash) === actual
        if (!ok) {
          bad += 1
          console.log(`[丢弃] ${kind}/${id} v${ver.version ?? verKey}`)
          console.log(`       仓库 hash: ${ver.hash}`)
          console.log(`       实算 hash: ${actual}`)
        }
      }
      const versions = Object.keys(entry?.versions || {}).map(Number).sort((a, b) => a - b)
      const active = Number(entry?.activeVersion)
      if (versions.length && !versions.includes(active)) {
        console.log(`[警告] ${kind}/${id} activeVersion=${active} 不存在，运行时会回落到 v${versions[versions.length - 1]}`)
      }
    }
  }
  console.log(`\n体检完成：${total} 个版本，${bad} 个 hash 对不上（会被静默丢弃）`)
  process.exit(bad ? 1 : 0)
}

let failed = 0
for (const file of argv) {
  try {
    const protocol = JSON.parse(fs.readFileSync(file, 'utf8'))
    console.log(`${protocolV2Hash(protocol)}  ${protocol.kind || '?'}/${protocol.id || '?'}  ${file}`)
  } catch (error) {
    failed += 1
    console.log(`[读取失败] ${file} -> ${error.message}`)
  }
}
process.exit(failed ? 1 : 0)
