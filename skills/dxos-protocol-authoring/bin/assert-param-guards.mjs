#!/usr/bin/env node
/**
 * DX OS 协议「参数取值白名单断言」。
 *
 * verify-protocol.mjs 证明的是「协议能编译、引用没写错」；
 * 本脚本证明的是「编译出来的取值确实落在上游文档允许的集合内」——
 * 这才是真正防 400 的那一步（编译通过 ≠ 取值合法）。
 *
 * 用法:
 *   MSYS_NO_PATHCONV=1 node --experimental-transform-types assert-param-guards.mjs <config.json>
 *
 * config.json 格式（见 references/param-guards.example.json）:
 * {
 *   "baseDir": "$HOME/Desktop/新api接口-dxos",   // 支持 $HOME/<用户名>/~ 占位符，留空用 CWD
 *   "canvas": { ...可选，覆盖面板真实选项集... },
 *   "targets": [
 *     {
 *       "label": "展示用名字",
 *       "provider": "aicost/aicost.provider.json",   // 相对 baseDir
 *       "model": "aicost/aicost.model.json",
 *       "modelId": "seedance2.5",                    // 必须是 modelProfiles[].match 里的值
 *       "intents": ["video.text_to_video", "..."],
 *       "allow": {
 *         "resolution": ["720p", "1080p"] | null,    // null = 上游不接受该字段，出现即失败
 *         "ratio": ["16:9", "9:16", "1:1"],
 *         "duration": { "min": 1, "max": 30 }
 *       }
 *     }
 *   ]
 * }
 *
 * 断言范围：递归扫描编译后 body（含 metadata.payload 这类 JSON 字符串）里
 * 出现的 resolution / ratio / aspect_ratio / aspectRatio / duration / seconds。
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveEngineDir, expandUserPlaceholders } from './dxos-paths.mjs'

// Canvas「API 生成」面板真实提供的选项（从 canvas 应用 bundle 抽取，2026-09）
const DEFAULT_CANVAS = {
  videoResolution: ['', '480p', '720p', '1080p'],
  imageResolution: ['1k', '2k', '4k'],
  videoRatio: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', 'keep_ratio', 'adaptive'],
  imageRatio: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21', 'source'],
  duration: [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30],
}

const configPath = process.argv[2]
if (!configPath) {
  console.error('用法: node --experimental-transform-types assert-param-guards.mjs <config.json>')
  process.exit(2)
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
// baseDir 支持占位符（$HOME / <用户名> / ~），换电脑无需改配置；
// 留空则退回当前工作目录。也可用 PROTO_BASE 环境变量覆盖。
const rawBase = process.env.PROTO_BASE || config.baseDir || '.'
const baseDir = path.resolve(expandUserPlaceholders(rawBase))
const CANVAS = { ...DEFAULT_CANVAS, ...(config.canvas || {}) }
const engineDir = resolveEngineDir()
const { compileProtocolPlan } = await import(pathToFileURL(path.join(engineDir, 'compiler.ts')).href)

const RANGE_KEYS = new Set(['duration', 'seconds'])
const RATIO_KEYS = new Set(['ratio', 'aspect_ratio', 'aspectRatio'])

/** 覆盖「图片页残留值泄漏到视频页」的两类真实污染：全分辨率 × 全比例 交叉，再加时长与空值。 */
function casesFor() {
  const cases = []
  for (const resolution of [...CANVAS.videoResolution, ...CANVAS.imageResolution]) {
    for (const aspect_ratio of [...CANVAS.videoRatio, ...CANVAS.imageRatio]) {
      cases.push({ duration: 5, aspect_ratio, ratio: aspect_ratio, resolution })
    }
  }
  for (const duration of CANVAS.duration) cases.push({ duration })
  cases.push({})
  return cases
}

/** 递归收集目标键；遇到 JSON 字符串（如 metadata.payload）再解析一层。 */
function collect(node, out, depth = 0) {
  if (depth > 6) return
  if (Array.isArray(node)) return node.forEach((v) => collect(v, out, depth + 1))
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v !== 'object' && (RATIO_KEYS.has(k) || RANGE_KEYS.has(k) || k === 'resolution')) out.push([k, String(v)])
      collect(v, out, depth + 1)
    }
    return
  }
  if (typeof node === 'string' && /^\s*[[{]/.test(node)) {
    try { collect(JSON.parse(node), out, depth + 1) } catch { /* 非完整 JSON，忽略 */ }
  }
}

let totalFailures = 0
let totalChecks = 0

for (const target of config.targets) {
  const provider = JSON.parse(fs.readFileSync(path.resolve(baseDir, target.provider), 'utf8'))
  const model = JSON.parse(fs.readFileSync(path.resolve(baseDir, target.model), 'utf8'))
  const cases = target.cases || casesFor()
  const bad = new Map()
  let checks = 0

  for (const intent of target.intents) {
    for (const params of cases) {
      let plan
      try {
        plan = compileProtocolPlan({
          providerProtocol: provider,
          modelProtocol: model,
          baseUrl: 'https://example.invalid',
          credential: 'probe-key',
          task: {
            requestId: 'guard-0000',
            model: target.modelId,
            intent,
            prompt: 'param guard assertion probe',
            inputs: target.inputs || {
              images: [{ kind: 'image', url: 'https://example.com/a.jpg', role: 'reference_image' }],
              videos: [{ kind: 'video', url: 'https://example.com/a.mp4' }],
              audios: [{ kind: 'audio', url: 'https://example.com/a.mp3' }],
              files: [],
            },
            params,
          },
          redactSecrets: true,
        })
      } catch (e) {
        bad.set(`编译失败: ${e.message}`, `${intent} / ${JSON.stringify(params)}`)
        continue
      }
      const submit = plan.steps.find((s) => s.id === 'submit')
      const pairs = []
      collect(submit.request.body, pairs)
      for (const [key, value] of pairs) {
        checks += 1
        const where = `${intent} / ${JSON.stringify(params)}`
        if (RATIO_KEYS.has(key)) {
          if (target.allow.ratio && !target.allow.ratio.includes(value)) bad.set(`${key}=${value}`, where)
        } else if (key === 'resolution') {
          if (target.allow.resolution === null) bad.set(`${key}=${value}`, '上游不接受 resolution，但协议下发了')
          else if (target.allow.resolution && !target.allow.resolution.includes(value)) bad.set(`${key}=${value}`, where)
        } else if (RANGE_KEYS.has(key)) {
          const n = Number(value)
          const { min, max } = target.allow.duration || { min: -Infinity, max: Infinity }
          if (!Number.isFinite(n) || n < min || n > max) bad.set(`${key}=${value}`, where)
        }
      }
    }
  }

  totalChecks += checks
  console.log(`\n########## ${target.label}  (模型=${target.modelId}，${cases.length} 组参数 × ${target.intents.length} 个意图)`)
  if (bad.size === 0) {
    console.log(`  [通过] ${checks} 项取值断言，无越界`)
  } else {
    totalFailures += bad.size
    console.log(`  [失败] ${bad.size} 项越界取值：`)
    for (const [value, where] of bad) console.log(`         - ${value}   <- ${where}`)
  }
}

console.log(`\n=== 断言完成：共 ${totalChecks} 项取值检查，越界 ${totalFailures} 项 ===`)
if (totalFailures) process.exit(1)
