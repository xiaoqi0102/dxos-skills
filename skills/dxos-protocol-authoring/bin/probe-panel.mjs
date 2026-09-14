/**
 * 第 4 层校验：画布「API 生成」参数面板逐格核对。
 *
 * 抓的是前三关（schema / 编译 / 语义体检）和 probe-local-input / probe-ratio 都拦不住的一类问题：
 * **协议能装、能编译、覆盖率 100%，但画布工具条上就是少格子甚至一格都没有**。
 * 根因通常是 `modelProfiles[].match` 没覆盖站点里真实的模型名 —— 档案匹配不上时
 * `resolveParameterSchema()` 直接返回 null，界面上连时长/分辨率都不显示，且不报任何错。
 *
 * 本脚本直接调用运行时自己的 `resolveProtocolModelProfile()` / `resolveParameterSchema()`，
 * 并按 Canvas 工具条的真实判定规则（逐格判 key 是否存在）输出「有 / 无」。
 *
 * 用法:
 *   node --experimental-transform-types probe-panel.mjs <model.json> <provider.json> [--models a,b,c]
 *
 * 候选模型名默认从已安装的 `data/providers.json` 里读（绑定到该模型协议的站点模型），
 * 这样核对的就是用户在界面上真正会选到的那份清单。找不到时可显式用 --models 指定。
 *
 * 退出码: 0 全通过 / 1 有模型解析不出参数面板
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolveDataDir, resolveEngineDir, resolveServerDir } from './dxos-paths.mjs'

const argv = process.argv.slice(2)
const positional = argv.filter((item) => !item.startsWith('--'))
const flag = (name) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}
if (positional.length < 2) {
  console.error('用法: node --experimental-transform-types probe-panel.mjs <model.json> <provider.json> [--models a,b,c]')
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
const tmpStore = path.join(process.env.TEMP || '.', `probe-panel-${process.pid}.json`)
const version = (protocol) => ({ 1: { version: 1, hash: protocolV2Hash(protocol), createdAt: Date.now(), protocol } })
fs.writeFileSync(tmpStore, JSON.stringify({
  format: 'dx-custom-protocols/v2',
  provider: { [provider.id]: { id: provider.id, kind: 'provider', activeVersion: 1, versions: version(provider) } },
  model: { [model.id]: { id: model.id, kind: 'model', activeVersion: 1, versions: version(model) } },
}, null, 2), 'utf8')
process.env.DX_PROTOCOL_V2_FILE = tmpStore

const { resolveProtocolModelProfile, resolveParameterSchema } = await import(pathToFileURL(path.join(serverDir, 'protocolManifest.ts')).href)

/** Canvas 工具条白名单（canvas 1.0.127 bundle 抽取） */
const VIDEO_TOOLBAR = ['duration', 'aspect_ratio', 'size', 'resolution', 'generate_audio']
const IMAGE_TOOLBAR = ['size', 'quality', 'n', 'aspect_ratio', 'resolution']

function candidateModels() {
  const explicit = flag('models')
  if (explicit) return explicit.split(',').map((item) => item.trim()).filter(Boolean)
  const names = new Set()
  try {
    const sites = JSON.parse(fs.readFileSync(path.join(resolveDataDir(), 'providers.json'), 'utf8'))
    for (const site of Array.isArray(sites) ? sites : []) {
      for (const entry of site.models || []) {
        const protocolId = String(entry.protocol || site.protocol || '').trim()
        if (protocolId === model.id) names.add(String(entry.model || '').trim())
      }
    }
  } catch { /* 读不到就退回档案 match */ }
  if (!names.size) {
    for (const profile of Object.values(model.modelProfiles || {})) for (const pattern of profile.match || []) names.add(pattern)
  }
  return [...names].filter(Boolean)
}

const models = candidateModels()
const intents = (model.capabilities || []).filter((capability) => capability.startsWith('video.') || capability.startsWith('image.'))
console.log(`协议: ${model.id}   站点绑定到该协议的模型: ${models.length} 个`)
console.log('工具条顺序: [模式] [生成音频] [时长] [画面比例] [分辨率] [更多参数]\n')

let failures = 0
for (const name of models) {
  const profileId = resolveProtocolModelProfile(model.id, name).profileId
  if (!profileId) {
    failures += 1
    console.log(`[档案未命中] ${name}`)
    console.log('      模型名不以任何 modelProfiles[].match 值开头 → 参数面板一格都不显示（本条即 FAIL）')
    console.log(`      当前档案: ${Object.entries(model.modelProfiles || {}).map(([id, item]) => `${id}(${(item.match || []).join('|')})`).join(' / ')}`)
    continue
  }
  let hasSchema = false
  const lines = []
  for (const intent of intents) {
    const schema = resolveParameterSchema(model.id, name, intent)
    if (!schema) continue
    hasSchema = true
    const keys = schema.fields.map((field) => field.key)
    const toolbar = intent.startsWith('video.') ? VIDEO_TOOLBAR : IMAGE_TOOLBAR
    const cells = toolbar.map((key) => `${key}=${keys.includes(key) ? '有' : '无'}`).join(' ')
    const extra = keys.filter((key) => key !== 'prompt' && !toolbar.includes(key))
    lines.push(`      ${intent.padEnd(24)} [${cells}]  更多参数=[${extra.join(',')}]`)
  }
  if (!hasSchema) failures += 1
  console.log(`[${hasSchema ? 'ok' : '空的'}] ${name}  → 档案 ${profileId}`)
  if (!hasSchema) console.log('      有档案但解析不出参数面板（uiSchemas 是否指向了不存在的 id？）')
  for (const line of lines) console.log(line)
}

fs.rmSync(tmpStore, { force: true })
console.log(`\n>>> ${models.length} 个模型中 ${failures} 个解析不出参数面板`)
process.exit(failures ? 1 : 0)
