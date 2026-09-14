#!/usr/bin/env node
/**
 * DX OS 自定义协议「真机编译」校验器
 *
 * 直接把协议丢进 DX OS 运行时自己的 protocol-engine 里编译一遍，
 * 用 Canvas（「API 生成」面板）真实会发出的参数组合去压测，
 * 打印最终会发到上游 API 的 body，提前暴露
 * 「UI 能选、但上游不接受」的取值（例如 resolution=1k 打到只支持 720p/480p 的视频模型）。
 *
 * 用法:
 *   node verify-protocol.mjs <provider.json> <model.json> [--intent <capability>] [--tasks task.json]
 *
 * 引擎目录自动探测（扫描各盘 DXOS-Portable-*-win-x64，取版本最高者 + .active-runtime），
 * 可用环境变量 DXOS_ROOT / DXOS_SERVER / DXOS_ENGINE 覆盖。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { resolveEngineDir } from './dxos-paths.mjs'

// Canvas「API 生成」面板真实提供的选项（从 canvas 应用 bundle 抽取，2026-09）
const CANVAS = {
  videoResolution: ['', '480p', '720p', '1080p'],
  imageResolution: ['1k', '2k', '4k'],
  videoRatio: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', 'keep_ratio', 'adaptive'],
  imageRatio: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21', 'source'],
  duration: [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30],
  quality: ['auto', 'low', 'medium', 'high'],
  outputFormat: ['png', 'jpeg', 'webp'],
}

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
if (positional.length < 2) {
  console.error('用法: node verify-protocol.mjs <provider.json> <model.json> [--intent <capability>] [--tasks task.json]')
  process.exit(2)
}

const engineDir = resolveEngineDir()
const { compileProtocolPlan } = await import(pathToFileURL(path.join(engineDir, 'compiler.ts')).href)
const { validateProtocolV2 } = await import(pathToFileURL(path.join(engineDir, 'validator.ts')).href)

const provider = JSON.parse(fs.readFileSync(positional[0], 'utf8'))
const model = JSON.parse(fs.readFileSync(positional[1], 'utf8'))

/**
 * 第一关：schema 校验 —— DX OS 安装协议时用的就是这一步。
 * 这一步失败 = 协议根本装不进去，跟「编译压测」是两回事，必须单独报告，
 * 否则容易被误读成「编译没问题、协议没问题」。
 * 典型漏网：provider 缺 models 段（models 在 v2 schema 里是必填）。
 */
function schemaCheck(label, value) {
  try {
    validateProtocolV2(value)
    console.log(`  [通过] ${label}`)
    return true
  } catch (e) {
    const issues = Array.isArray(e?.issues) ? e.issues : [e?.message || String(e)]
    console.log(`  [失败] ${label}  —— ${issues.length} 条问题`)
    for (const issue of issues) console.log(`         - ${issue}`)
    return false
  }
}

console.log('########## 第一关：schema 校验（DX OS 安装协议时执行）')
const providerOk = schemaCheck(`provider「${provider.id}」`, provider)
const modelOk = schemaCheck(`model「${model.id}」`, model)
if (!providerOk || !modelOk) {
  console.log('\n>>> 协议未通过 schema 校验，后面的编译压测没有意义，已终止。')
  process.exit(1)
}

const isVideo = (cap) => String(cap).startsWith('video.')
const isImage = (cap) => String(cap).startsWith('image.')
const isAudio = (cap) => String(cap).startsWith('audio.')

function matrixFor(intent) {
  const cases = []
  if (isVideo(intent)) {
    for (const resolution of CANVAS.videoResolution) {
      for (const aspect_ratio of CANVAS.videoRatio) {
        cases.push({
          name: `res=${resolution || '(空)'} ratio=${aspect_ratio}`,
          params: { duration: 5, aspect_ratio, ratio: aspect_ratio, resolution },
        })
      }
    }
    for (const duration of CANVAS.duration) cases.push({ name: `duration=${duration}`, params: { duration } })
    // 图片页残留值泄漏到视频页的真实案例
    for (const resolution of CANVAS.imageResolution) {
      cases.push({ name: `[泄漏] 图片页 resolution=${resolution}`, params: { duration: 5, aspect_ratio: '16:9', resolution } })
    }
  } else if (isImage(intent)) {
    for (const resolution of CANVAS.imageResolution) {
      for (const aspect_ratio of CANVAS.imageRatio) {
        cases.push({ name: `res=${resolution} ratio=${aspect_ratio}`, params: { resolution, aspect_ratio, quality: 'high', num_images: 1, output_format: 'png' } })
      }
    }
    for (const quality of CANVAS.quality) cases.push({ name: `quality=${quality}`, params: { quality } })
    for (const output_format of CANVAS.outputFormat) cases.push({ name: `format=${output_format}`, params: { output_format } })
  } else {
    cases.push({ name: 'default', params: {} })
  }
  return cases
}

const intents = flags.intent
  ? [flags.intent]
  : (Array.isArray(model.capabilities) ? model.capabilities : [''])

const profiles = Object.entries(model.modelProfiles || {})

/**
 * 按 intent 挑真正声明了该 workflow 的模型档案。
 * 不能直接取「第一个档案的 match[0]」——图片档案会被拿去编译视频 workflow，
 * 而 compiler 在档案未映射该 intent 时会静默回退到通用顶层 workflow，
 * 跑出一个「模型名与链路不匹配」的 body，属于假阳性。
 */
function profileForModel(name) {
  const normalized = String(name).toLowerCase()
  return profiles.find(([id, p]) => id.toLowerCase() === normalized
    || (p?.match || []).some((pattern) => normalized.startsWith(String(pattern).toLowerCase())))
}

function modelForIntent(intent) {
  // 显式指定模型时同样要解析出档案，否则拿不到档案级素材规则（见 runtime 的 declarativeRouter.ts:49）
  if (flags['model-id']) {
    const explicit = String(flags['model-id'])
    const hit = profileForModel(explicit)
    return { name: explicit, profileId: hit?.[0] || '(未匹配到档案)', profile: hit?.[1] }
  }
  const hit = profiles.find(([, p]) => p?.workflows && Object.prototype.hasOwnProperty.call(p.workflows, intent))
  if (hit) return { name: (hit[1].match || [])[0] || model.id, profileId: hit[0], profile: hit[1] }
  const first = profiles[0]
  return { name: (first?.[1]?.match || [])[0] || model.id, profileId: first?.[0] || '(无档案)', profile: first?.[1], generic: true }
}

// 探针素材：同一份内容同时准备 url / dataUrl / name 三种形态，按规则取用。
const PROBE_SAMPLES = {
  images: {
    url: 'https://example.com/probe.jpg',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    mime: 'image/png',
    name: 'probe.png',
  },
  videos: { url: 'https://example.com/probe.mp4', dataUrl: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=', mime: 'video/mp4', name: 'probe.mp4' },
  audios: { url: 'https://example.com/probe.mp3', dataUrl: 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA', mime: 'audio/mpeg', name: 'probe.mp3' },
}

/**
 * 按「该档案的有效素材规则」构造探针输入。
 * 运行时（server/ai-tasks/declarativeRouter.ts:49）取的是 profile.assets[kind] || protocol.assets[kind]，
 * 且只有 mode=data_url 时才会把素材物化成 Data URL（assetResolvers.ts:71）。
 * 所以探针必须跟着规则变：
 *   - data_url / upload_operation → 给 dataUrl+mime+name（否则 $dataUrlBase64 / $files 必然报错，纯属假阳性）
 *   - public_url                  → 给 url
 *   - remote_name                 → 给 name
 *   - 没有规则                    → 该类型素材不下发
 */
function ruleForAsset(profile, key) {
  return profile?.assets?.[key] || model.assets?.[key]
}

function probeInputs(profile) {
  const build = (key, kind, role) => {
    const rule = ruleForAsset(profile, key)
    // 档案显式声明了 assets 却没覆盖该类型 → 运行时直接丢弃该素材（declarativeRouter.ts:93）
    if (!rule && profile?.assets) return []
    const sample = PROBE_SAMPLES[key]
    const asset = { kind, ...(role ? { role } : {}) }
    if (rule?.mode === 'remote_name') return [{ ...asset, name: sample.name }]
    if (rule?.mode && rule.mode !== 'public_url') return [{ ...asset, dataUrl: sample.dataUrl, mime: sample.mime, name: sample.name }]
    // public_url，以及「完全没有 assets 规则」时的旧默认行为：透传 url
    return [{ ...asset, url: sample.url }]
  }
  return {
    images: build('images', 'image', 'reference_image'),
    videos: build('videos', 'video'),
    audios: build('audios', 'audio'),
    files: [],
  }
}

let total = 0
let failed = 0
const seen = new Map()

for (const intent of intents) {
  const cases = flags.tasks
    ? JSON.parse(fs.readFileSync(flags.tasks, 'utf8')).filter((t) => !t.intent || t.intent === intent)
    : matrixFor(intent)
  if (!cases.length) continue

  const picked = modelForIntent(intent)
  const baseTask = {
    requestId: 'verify-0000',
    prompt: 'protocol verification probe',
    inputs: probeInputs(picked.profile),
  }
  console.log(`\n########## intent: ${intent}  (${cases.length} 组)`)
  console.log(`  模型=${picked.name}   档案=${picked.profileId}`)
  const modes = ['images', 'videos', 'audios']
    .map((key) => `${key}=${ruleForAsset(picked.profile, key)?.mode || '—'}`)
    .join('  ')
  console.log(`  素材交付模式: ${modes}`)
  if (picked.generic) {
    console.log('  警告：没有声明该 intent 的模型档案，编译会回退到通用顶层 workflow。')
    console.log('        这只证明语法/引用可用，不代表该模型的真实链路可用。')
  }

  for (const c of cases) {
    total += 1
    if (flags.tasks) {
      for (const group of ['images', 'videos', 'audios']) {
        if (c.inputs && c.inputs[group]) baseTask.inputs[group] = c.inputs[group]
      }
    }
    try {
      const plan = compileProtocolPlan({
        providerProtocol: provider,
        modelProtocol: model,
        baseUrl: flags.base || 'https://example.invalid',
        credential: 'probe-key',
        task: { ...baseTask, model: picked.name, intent, params: c.params, ...(c.prompt ? { prompt: c.prompt } : {}) },
        redactSecrets: true,
      })
      const submit = plan.steps.find((s) => s.id === 'submit')
      const body = JSON.stringify(submit.request.body)
      const key = body
      if (seen.has(key)) {
        console.log(`  ok   | ${c.name}  (与「${seen.get(key)}」同 body)`)
      } else {
        seen.set(key, c.name)
        console.log(`  ok   | ${c.name}`)
        console.log(`         body: ${body.length > 300 ? `${body.slice(0, 300)}…` : body}`)
      }
    } catch (e) {
      failed += 1
      console.log(`  ERR  | ${c.name} -> ${e.message}`)
    }
  }
}

console.log(`\n=== 共 ${total} 组，编译失败 ${failed} 组 ===`)
console.log('提示：编译通过只代表协议语法/引用无误；请人工核对上面打印的 body 取值是否落在上游 API 允许集合内。')
if (failed) process.exit(1)
