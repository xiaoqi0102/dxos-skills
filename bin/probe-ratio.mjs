#!/usr/bin/env node
/**
 * ⑥ 尺寸取值矩阵回归探针（图片类档案）
 *
 * 抓的是「协议能编译、能出图，但用户选的参数被静默改成别的东西」这一类问题。
 * 典型案发现场（七牛 gpt-image-2，2026-09-11）：
 *   Canvas「系统参数」里选「原图比例」时 params.ratio === "source"，
 *   客户端 Xd() 把它换算成 GCD 约分后的**具体比**（如 1055:1491）塞进 params.aspect_ratio；
 *   分辨率则一律是**小写** "1k"/"2k"/"4k"。
 *   协议里 lookup 的 cases 只写了 10/11 个枚举值和 "1K"/"2K"，
 *   于是 aspect_ratio 落到 fallback=1 → 长宽相等 → 用户拿到正方形；
 *   resolution 落到兜底 literal → 2K 请求实际出 2880。
 *   **全程不报错**，只有对着成图量像素才发现。
 *
 * 检查项：
 *   A 回落检测  非标准比（source / 具体比）的输出必须与 1:1 不同 —— 相同 = 被静默回落
 *   B 分辨率生效 同一比例下 1k 与 2k 的输出必须不同 —— 相同 = 分辨率没传进去
 *   C 比例一致  输出若含 "WxH" / {width,height} 尺寸，其宽高比必须贴合注入比例（容差 3%）
 *   D 枚举合法  分辨率字段取值必须落在上游合法集合内（大小写敏感，画布传小写 "1k"）
 *   E 非标比处置 非标准比有三种合法归宿（实测于 2026-09-11，300×700 参考图 = 3:7）：
 *               ① `size:"auto"`      → aicost gpt 实测 822×1913，**精确跟随原图**（最优）
 *               ② 原样透传具体比      → change2pro 实测 3:7 → 768×1376（=9:16），**上游就近映射**
 *               ③ 省略 / "auto" 给枚举型上游 → 实测掉到 1:1，**等于没选**（劣）
 *               所以「非标准比原样透传」只作**提示**（依赖上游就近映射），不算错；
 *               但若输出被协议自己归一到 1:1（A 项）或分辨率越界（D 项）→ 判错。
 *
 * 兼容三种 body 形态：七牛 {image_size:{width,height}} / aicost-gpt {size:"WxH"} /
 *                    gemini 系 {generationConfig:{imageConfig:{imageSize,aspectRatio}}}
 *
 * 用法: node --experimental-transform-types probe-ratio.mjs <model.json> <provider.json>
 * 退出码: 0 全通过 / 1 有 FAIL
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveServerDir } from './dxos-paths.mjs'

const SERVER = resolveServerDir()
const { standardProtocolTaskFromAiTask } = await import(pathToFileURL(path.join(SERVER, 'ai-tasks/declarativeRouter.ts')).href)
const { compileProtocolPlan } = await import(pathToFileURL(path.join(SERVER, 'protocol-engine/compiler.ts')).href)

const [modelPath, providerPath] = process.argv.slice(2)
if (!modelPath || !providerPath) {
  console.error('用法: node --experimental-transform-types probe-ratio.mjs <model.json> <provider.json>')
  process.exit(2)
}
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'))
const providerProtocol = JSON.parse(fs.readFileSync(providerPath, 'utf8'))
const baseUrl = providerProtocol.baseUrl || providerProtocol.defaultBaseUrl || 'https://example.invalid'

// Canvas 本地素材（canvasAssets.ts:58-68 形状：只有 dataUrl/mime/name/bytes）
const SAMPLE = {
  kind: 'image',
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  mime: 'image/png',
  name: 'canvas-local.png',
  bytes: 70,
}
// 非标准比样例：Canvas「原图比例」会换算成这种 GCD 约分比，另加字面量 source 兜底
const ODD_RATIOS = ['source', '1055:1491']
const RES_LEVELS = [
  { upper: '1K', lower: '1k' },
  { upper: '2K', lower: '2k' },
]

const round = (n) => Number(n.toFixed(4))

function uiOptions(key) {
  for (const fields of Object.values(model.uiSchemas || {})) {
    const field = (fields || []).find((item) => item && item.key === key)
    const options = field?.options
    if (Array.isArray(options)) return options.map((o) => String(o?.value ?? o)).filter(Boolean)
  }
  return []
}
function uiHas(key) {
  for (const fields of Object.values(model.uiSchemas || {})) {
    if ((fields || []).some((item) => item && item.key === key)) return true
  }
  return false
}

/** 注入一份"画布真实形状"的 params：比例用 aspect_ratio+ratio 双键，分辨率大小写双键 */
function canvasParams(ratio, level) {
  return {
    aspect_ratio: ratio,
    ratio,
    image_size: level.upper,
    resolution: level.lower,
    quality: 'high',
    output_format: 'png',
    size: '1024x1024',
  }
}

function compileEdit(profileName, params) {
  const task = {
    format: 'dx-ai-task/v2',
    requestId: 'probe',
    context: { surface: 'canvas', workspace: { type: 'canvas', id: 'probe-canvas' } },
    intent: 'image.edit',
    provider: { platform: 'api', providerId: 'probe', model: profileName },
    prompt: 'keep composition, remove text',
    params,
    inputs: [{ assetId: 'n1', kind: 'image', source: { type: 'fs-node', id: 'n1' }, role: 'reference_image' }],
    output: { kind: 'image', count: 1 },
  }
  const protocolTask = standardProtocolTaskFromAiTask(task, model, new Map([['n1', { assetId: 'n1', ...SAMPLE }]]))
  if (!protocolTask) throw new Error('素材规则拒绝了 Canvas 本地素材（先看素材模式，不是尺寸问题）')
  const plan = compileProtocolPlan({ providerProtocol, modelProtocol: model, baseUrl, credential: 'sk-probe', task: protocolTask, redactSecrets: true })
  const submit = plan.steps.find((s) => s.id === 'submit')
  return submit.request.body
}

/** 深度收集 body 里所有 key/value（带路径），用于兼容任意嵌套 */
function fields(value, out = [], prefix = '') {
  if (Array.isArray(value)) {
    value.forEach((item, i) => fields(item, out, `${prefix}[${i}]`))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push({ key: k, value: v, path: prefix ? `${prefix}.${k}` : k })
      fields(v, out, prefix ? `${prefix}.${k}` : k)
    }
  }
  return out
}

const RATIO_KEYS = ['aspect_ratio', 'aspectRatio']
const RES_KEYS = ['resolution', 'imageSize']
const SIZE_KEYS = ['size', 'image_size']

/** 从 body 提取「比例形态」的尺寸（"WxH" 或 {width,height}） */
function sizeRatioOf(body) {
  for (const f of fields(body)) {
    if (!SIZE_KEYS.includes(f.key)) continue
    const v = f.value
    if (typeof v === 'string') {
      const m = /^(\d+)\s*x\s*(\d+)$/i.exec(v.trim())
      if (m) return { w: Number(m[1]), h: Number(m[2]), at: f.path }
    } else if (v && typeof v === 'object' && Number.isFinite(v.width) && Number.isFinite(v.height) && v.height > 0) {
      return { w: v.width, h: v.height, at: f.path }
    }
  }
  return null
}

let total = 0
let failures = 0
let infos = 0
const fail = (label, detail) => {
  failures += 1
  console.log(`  [FAIL] ${label}\n         ${detail}`)
}
const info = (label, detail) => {
  infos += 1
  console.log(`  [提示] ${label}\n         ${detail}`)
}

const declaredRatios = uiOptions('aspect_ratio').filter((r) => /^\d+:\d+$/.test(r))
const resKey = uiHas('image_size') ? 'image_size' : 'resolution'
const declaredResolutions = uiOptions(resKey)
const probeRatios = [...new Set(['1:1', ...declaredRatios.slice(0, 4), ...ODD_RATIOS])]

for (const [pid, profile] of Object.entries(model.modelProfiles || {})) {
  const workflows = profile.workflows || {}
  if (!workflows['image.edit'] && !workflows['image.generate']) continue
  const profileName = (profile.match || [])[0] || pid
  console.log(`\n=== 档案 ${pid} (${profileName}) ===`)
  console.log(`    声明比例 ${JSON.stringify(declaredRatios)} | 分辨率键 ${resKey} ${JSON.stringify(declaredResolutions)}`)

  const bodies = {}
  for (const ratio of probeRatios) {
    for (const level of RES_LEVELS) {
      total += 1
      const tag = `${ratio}@${level.lower}`
      try {
        const body = compileEdit(profileName, canvasParams(ratio, level))
        bodies[tag] = body
        const sz = sizeRatioOf(body)
        const shown = JSON.stringify({
          size: sz ? `${sz.w}x${sz.h}` : undefined,
          aspectRatio: fields(body).find((f) => RATIO_KEYS.includes(f.key))?.value,
          imageSize: fields(body).find((f) => RES_KEYS.includes(f.key))?.value,
        })
        console.log(`  [body] ${tag.padEnd(18)} -> ${shown}`)
      } catch (error) {
        bodies[tag] = null
        console.log(`  [ERR ] ${tag.padEnd(18)} -> ${error.message}`)
      }
    }
  }

  const at = (ratio, lower) => bodies[`${ratio}@${lower}`]
  const base = at('1:1', '1k')
  if (!base) {
    fail(`${pid} 1:1@1k 拿不到编译结果`, '后续检查跳过')
    continue
  }

  // A 回落检测
  for (const ratio of ODD_RATIOS) {
    const odd = at(ratio, '1k')
    if (!odd) continue
    if (JSON.stringify(odd) === JSON.stringify(base)) {
      fail(`${pid} 非标准比「${ratio}」被静默回落`,
        `输出与 1:1 完全相同（${JSON.stringify({ s: sizeRatioOf(base), a: fields(base).find((f) => RATIO_KEYS.includes(f.key))?.value })}）——`
        + '画布的「原图比例」正是走这条路，用户会拿到 1:1 正方形或原样非法值')
    }
  }

  // B 分辨率生效
  for (const ratio of ['1:1', ...declaredRatios.slice(0, 1)]) {
    const a = at(ratio, '1k')
    const b = at(ratio, '2k')
    if (!a || !b) continue
    const dims = (body) => JSON.stringify([sizeRatioOf(body), fields(body).find((f) => RES_KEYS.includes(f.key))?.value])
    if (dims(a) === dims(b)) {
      fail(`${pid} 「${ratio}」下 1k 与 2k 输出相同`, `均为 ${dims(a)} —— 分辨率没有生效`)
    }
  }

  // C 比例一致（仅对声明的标准比）
  for (const ratio of declaredRatios) {
    const body = at(ratio, '2k') || at(ratio, '1k')
    if (!body) continue
    const sz = sizeRatioOf(body)
    if (!sz || !sz.h) continue
    const [w, h] = ratio.split(':').map(Number)
    const want = w / h
    const got = sz.w / sz.h
    if (Math.abs(got - want) / want > 0.03) {
      fail(`${pid} 「${ratio}」输出尺寸比例不符`,
        `${sz.at} = ${sz.w}×${sz.h}（${round(got)}），期望 ≈ ${round(want)}`)
    }
  }

  // D 枚举合法：对**全部**注入值（含 source / 具体比）检查回给上游的值
  for (const ratio of probeRatios) {
    for (const level of RES_LEVELS) {
      const body = at(ratio, level.lower)
      if (!body) continue
      const where = `${pid} 「${ratio}@${level.lower}」`
      for (const f of fields(body)) {
        if (RATIO_KEYS.includes(f.key) && typeof f.value === 'string' && f.value !== '' && f.value !== 'auto') {
          if (!declaredRatios.includes(f.value)) {
            if (f.value === ratio) {
              info(`${where} ${f.path} 原样透传非标准比「${f.value}」`,
                'Gemini 系 / 自研 relay 会把非标准比**就近映射**到最接近的标准比'
                + '（实测 change2pro 3:7 → 9:16 = 0.5581，参考图 0.4286）；协议不归一是保留该能力。'
                + '若换到严格校验枚举的上游，同值会 400，需重新实测')
            } else {
              fail(`${where} 透传给上游的 ${f.path} 超出声明枚举`,
                `得到「${f.value}」（既不是声明值、也不是原样透传）—— 疑似被错误改写`
                + `（声明集合 ${JSON.stringify(declaredRatios)}）`)
            }
          }
        }
        if (RES_KEYS.includes(f.key) && typeof f.value === 'string' && declaredResolutions.length) {
          if (!declaredResolutions.includes(f.value)) {
            fail(`${where} 透传给上游的 ${f.path} 超出声明枚举`,
              `得到「${f.value}」，声明集合 ${JSON.stringify(declaredResolutions)}`
              + '（大小写敏感：画布传的是小写 "1k"，上游枚举是大写 "1K"）')
          }
        }
      }
    }
  }
}

const tail = infos ? `，${infos} 条提示（见上，非错误）` : ''
console.log(failures
  ? `\n>>> 共 ${total} 组，${failures} 项 FAIL${tail}`
  : `\n>>> 共 ${total} 组，尺寸取值全部随用户选择正确变化${tail}`)
process.exit(failures ? 1 : 0)
