#!/usr/bin/env node
/**
 * 面板字段解析取证器 —— 打印运行时 `resolveParameterSchema()` 真正交给画布的字段长什么样
 * （含 `label` / `options` / `default` / `type`）。
 *
 * 与 probe-panel.mjs 的分工：
 *   probe-panel.mjs  只判「这个 key 的格子有没有」→ 抓「少一格」
 *   本脚本           打印「这一格最终长什么样」→ 抓「格子在了，但选项/标签是错的」
 *
 * 它抓的是**四关全拦不住**的一类静默失败：字段出来了、能选、能提交，但下拉里显示的是
 * 原始 value（`DEFAULT` / `LIGHT`）而不是你写在 uiSchemas 里的中文 label
 * —— 根因是 `limits.<key>.options` 覆盖了 uiSchemas 的 options。
 *
 * 实测（2026-09-16）：`protocolManifest.ts` 的 `applyLimitsToFields()`：
 *
 * ```ts
 * const options = limitOptions(rule)          // rule = limits[key]，读 options 或 values
 * if (options.length) next.options = options.map((value) =>
 *   typeof value === 'object' && value ? value : { label: String(value).toUpperCase(), value })
 * else if (Array.isArray(next.options) && (rule.min != null || rule.max != null)) { ... }
 * ```
 *
 * 也就是说：
 *   - `limits.<key>.options` 是**纯字符串数组**时 → label 被强制成 `值的大写`，uiSchemas 的 label **静默丢弃**；
 *   - `limits.<key>.options` 是**对象数组**时 → 原样透传（对象里的 label 有效）；
 *   - `limits` 里**没有**该 key → uiSchemas 的 `{label, value}` 才会被保留。
 * 结论：想显示中文 label，就别在 `limits` 里给同一个 key 写纯字符串 `options`。
 *
 * 用法:
 *   node --experimental-transform-types inspect-panel-options.mjs \
 *        <model.json> <provider.json> [--model <上游模型名>] [--intent <capability>] [--only <key>]
 *
 *   --model   不传则取该 intent 对应档案的 `match[0]`（与 probe-panel 同逻辑）
 *   --intent  不传则取协议 capabilities 里第一个 video.* / image.*
 *   --only    只打印指定 key 的字段（默认全部）
 *
 * 引擎目录自动探测（bin/dxos-paths.mjs）；可用 DXOS_ROOT / DXOS_SERVER / DXOS_ENGINE 覆盖。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolveEngineDir, resolveServerDir } from './dxos-paths.mjs'

const argv = process.argv.slice(2)
const positional = argv.filter((item) => !item.startsWith('--'))
const flag = (name) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}
if (positional.length < 2) {
  console.error('用法: node --experimental-transform-types inspect-panel-options.mjs <model.json> <provider.json> [--model <名>] [--intent <cap>] [--only <key>]')
  process.exit(2)
}

const engineDir = resolveEngineDir()
const serverDir = resolveServerDir()
const { validateProtocolV2 } = await import(pathToFileURL(path.join(engineDir, 'validator.ts')).href)

/** 与 protocol-engine/repository.ts 的 canonical()/protocolV2Hash 逐字节一致 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const protocolV2Hash = (value) => createHash('sha256').update(canonical(value)).digest('hex')

const model = validateProtocolV2(JSON.parse(fs.readFileSync(positional[0], 'utf8')))
const provider = validateProtocolV2(JSON.parse(fs.readFileSync(positional[1], 'utf8')))

// 仓库路径在模块加载时就被读取，所以必须先写文件、再 import protocolManifest.ts
const tmpStore = path.join(process.env.TEMP || '.', `inspect-panel-${process.pid}.json`)
const version = (protocol) => ({ 1: { version: 1, hash: protocolV2Hash(protocol), createdAt: Date.now(), protocol } })
fs.writeFileSync(tmpStore, JSON.stringify({
  format: 'dx-custom-protocols/v2',
  provider: { [provider.id]: { id: provider.id, kind: 'provider', activeVersion: 1, versions: version(provider) } },
  model: { [model.id]: { id: model.id, kind: 'model', activeVersion: 1, versions: version(model) } },
}, null, 2), 'utf8')
process.env.DX_PROTOCOL_V2_FILE = tmpStore

const { resolveProtocolModelProfile, resolveParameterSchema } = await import(pathToFileURL(path.join(serverDir, 'protocolManifest.ts')).href)

const intents = (model.capabilities || []).filter((capability) => capability.startsWith('video.') || capability.startsWith('image.'))
const intent = flag('intent') || intents[0]
if (!intent) {
  console.error('协议里没有 video.* / image.* capability，无法探测参数面板')
  process.exit(2)
}

function modelForIntent() {
  if (flag('model')) return String(flag('model'))
  const profiles = Object.entries(model.modelProfiles || {})
  const hit = profiles.find(([, profile]) => profile?.workflows && Object.prototype.hasOwnProperty.call(profile.workflows, intent))
  const chosen = hit || profiles[0]
  return (chosen?.[1]?.match || [])[0] || model.id
}

const name = modelForIntent()
const profileId = resolveProtocolModelProfile(model.id, name).profileId
console.log(`协议: ${model.id}   模型: ${name}   档案: ${profileId || '(未命中)'}   intent: ${intent}`)

const schema = resolveParameterSchema(model.id, name, intent)
if (!schema) {
  console.log('resolveParameterSchema() 返回 null → 画布参数面板一格都不显示（先查 modelProfiles[].match）')
  fs.unlinkSync(tmpStore)
  process.exit(1)
}

const only = flag('only')
const fields = Array.isArray(schema.fields) ? schema.fields : []
console.log(`schemaId: ${schema.schemaId}   source: ${schema.source}   字段数: ${fields.length}`)
console.log(`defaults: ${JSON.stringify(schema.defaults || {})}\n`)

const suppressed = Object.entries(schema.limits || {})
  .filter(([, rule]) => rule && rule.supported === false)
  .map(([key]) => key)
if (suppressed.length) console.log(`⚠️ limits.<key>.supported=false 会整格删掉: ${suppressed.join(', ')}\n`)

let mismatched = 0
for (const field of fields) {
  if (!field || !field.key) continue
  if (only && field.key !== only) continue
  console.log(JSON.stringify(field, null, 2))
  const rule = (schema.limits || {})[field.key]
  const rawOptions = rule && Array.isArray(rule.options) ? rule.options : undefined
  const hasPlainStringLimits = Array.isArray(rawOptions) && rawOptions.some((item) => typeof item !== 'object')
  if (Array.isArray(field.options) && field.options.some((option) => option && typeof option.label === 'string')) {
    const labels = field.options.map((option) => option.label)
    const values = field.options.map((option) => option.value)
    const allUpper = labels.every((label, index) => String(label) === String(values[index]).toUpperCase())
    if (hasPlainStringLimits && allUpper) {
      mismatched += 1
      console.log(`   ⚠️ 该字段的 label 似乎是 limits.${field.key}.options 自动生成的（= value 大写）——`)
      console.log(`      若 uiSchemas 里写了中文 label，它已被静默丢弃。改法：删掉 limits.${field.key}.options，`)
      console.log(`      或把它改成 [{label, value}] 对象数组。`)
    }
  }
  console.log('')
}

console.log(mismatched
  ? `=== 共 ${fields.length} 个字段，其中 ${mismatched} 个的 label 被 limits.options 覆盖 ===`
  : `=== 共 ${fields.length} 个字段，未发现 label 被 limits.options 覆盖 ===`)
fs.unlinkSync(tmpStore)
