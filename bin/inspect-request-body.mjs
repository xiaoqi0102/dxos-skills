#!/usr/bin/env node
/**
 * DX OS 真实请求体取证器 —— 把「你的真实输入」喂进协议引擎，打印**完整未截断**的 submit body。
 *
 * 与 verify-protocol.mjs 的分工：
 *   verify-protocol.mjs  用内置探针矩阵**压测取值合法性**（body 只截断显示前 300 字）
 *   本脚本                用真实 prompt + 真实素材 URL **还原「实际会发什么」**
 *                        → 完整 body、`images` 数组形态、prompt 里所有 `@引用`，逐项打印
 *
 * 典型用途（用户问「到底发了什么」时首选）：
 *   - 「结果没遵循参考图」→ 看 images 是裸 URL 还是带 type、数组顺序
 *   - 「提示词是不是没上传」→ 看 body.prompt 是否与原文全等
 *   - 「参数有没有生效」→ 看 duration/ratio/resolution 的最终取值
 *
 * 用法:
 *   node --experimental-transform-types inspect-request-body.mjs \
 *        <provider.json> <model.json> <fixture.json> \
 *        [--intent <capability>] [--model <上游模型名>] [--base <baseUrl>] [--only <name 子串>]
 *
 * fixture.json 与 verify-protocol.mjs 的 --tasks 同格式：
 *   [
 *     {
 *       "intent": "video.multi_reference",
 *       "name": "真实任务 78082d75（2 图多参考）",
 *       "prompt": "…姜离@图片2、顾廷辞@图片1…",
 *       "params": { "duration": 15, "aspect_ratio": "16:9", "resolution": "720p", "face": "false" },
 *       "inputs": {
 *         "images": [{ "kind": "image", "role": "reference_image", "name": "a.png", "url": "https://…" }],
 *         "videos": [], "audios": []
 *       }
 *     }
 *   ]
 *
 *   内置样例见 references/request-fixture.example.json（四 intent × 带图+带音频，验 audios 规则）。
 *   ⚠️ 真实任务的 fixture 常含**会过期的临时素材 URL**（如 api.dx-os.com 的 24h 链接），
 *      属一次性取证材料，不要长期留存 / 提交。
 *
 * 引擎目录自动探测（bin/dxos-paths.mjs）；可用 DXOS_ROOT / DXOS_SERVER / DXOS_ENGINE 覆盖。
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveEngineDir } from './dxos-paths.mjs'

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1]
    else positional.push(argv[i])
  }
  return { positional, flags }
}

const { positional, flags } = parseArgs(process.argv.slice(2))
if (positional.length < 3) {
  console.error('用法: node --experimental-transform-types inspect-request-body.mjs <provider.json> <model.json> <fixture.json> [--intent <cap>] [--model <name>] [--base <url>] [--only <substr>]')
  process.exit(2)
}

const engineDir = resolveEngineDir()
const { compileProtocolPlan } = await import(pathToFileURL(path.join(engineDir, 'compiler.ts')).href)

const provider = JSON.parse(fs.readFileSync(positional[0], 'utf8'))
const model = JSON.parse(fs.readFileSync(positional[1], 'utf8'))
let fixture = JSON.parse(fs.readFileSync(positional[2], 'utf8'))
if (!Array.isArray(fixture)) fixture = [fixture]

/** 按 intent 找「真正声明了该 workflow」的档案，取它的 match[0] 当模型名（与 verify-protocol 同逻辑） */
function modelForIntent(intent) {
  if (flags.model) return String(flags.model)
  const profiles = Object.entries(model.modelProfiles || {})
  const hit = profiles.find(([, p]) => p?.workflows && Object.prototype.hasOwnProperty.call(p.workflows, intent))
  const chosen = hit || profiles[0]
  return (chosen?.[1]?.match || [])[0] || model.id
}

const EMPTY_GROUPS = { images: [], videos: [], audios: [], files: [] }
let printed = 0

for (const c of fixture) {
  if (flags.only && !String(c.name || '').includes(flags.only)) continue
  const intent = flags.intent || c.intent
  if (!intent) {
    console.log(`[跳过] ${c.name || '(未命名)'} —— fixture 缺 intent 且未传 --intent`)
    continue
  }
  printed += 1
  const task = {
    requestId: 'inspect',
    intent,
    model: modelForIntent(intent),
    prompt: c.prompt || '',
    params: c.params || {},
    inputs: { ...EMPTY_GROUPS, ...(c.inputs || {}) },
  }
  let plan
  try {
    plan = compileProtocolPlan({
      providerProtocol: provider,
      modelProtocol: model,
      baseUrl: flags.base || 'https://example.invalid',
      credential: 'probe-key',
      task,
      redactSecrets: false,
    })
  } catch (e) {
    console.log(`\n=== [编译失败] ${c.name || intent}  intent=${intent}`)
    console.log(`    ${e.message}`)
    continue
  }
  const submit = plan.steps.find((s) => s.id === 'submit')
  if (!submit) {
    console.log(`\n=== [无 submit 步骤] ${c.name || intent}  intent=${intent}`)
    continue
  }
  const body = submit.request.body
  console.log('\n' + '='.repeat(78))
  console.log(`case  : ${c.name || intent}`)
  console.log(`intent: ${intent}    model: ${task.model}    profile: ${plan.protocol?.profile ?? '—'}`)
  console.log(`request: ${submit.request.method} ${submit.request.url}`)
  console.log('-' .repeat(78))
  console.log('完整 body:')
  console.log(JSON.stringify(body, null, 2))

  // 三样最常被问的：images 形态 / prompt 引用 / 保留字段核对
  if (body && typeof body === 'object') {
    if ('images' in body) {
      console.log('\nimages 形态:')
      console.log(JSON.stringify(body.images, null, 2))
      const kinds = (Array.isArray(body.images) ? body.images : []).map((it) =>
        it && typeof it === 'object' ? `{url,${'type' in it ? `type=${it.type}` : '无type'}${'name' in it ? `,name=${it.name}` : ''}}` : '裸URL')
      console.log(`  → 共 ${kinds.length} 项：[${kinds.join(', ')}]`)
    }
    const prompt = body.prompt
    if (typeof prompt === 'string') {
      const refs = prompt.match(/@[^\s，。、,;；）)]+/g) || []
      console.log(`\nprompt: ${prompt.length} 字 | 引用标记 ${refs.length} 个: ${JSON.stringify(refs)}`)
    }
    for (const k of ['audios', 'videos']) {
      if (k in body) console.log(`${k}: ${JSON.stringify(body[k])}`)
      else if (k === 'audios') console.log('audios: （未下发）')
    }
  }
}

console.log(`\n=== 共输出 ${printed} 组 ===`)
console.log('提示：本脚本只还原协议编译结果，不代表上游一定接受；取值合法性请用 verify-protocol.mjs 压测。')
