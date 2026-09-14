/**
 * 路由级回归测试：模拟 Canvas「本地图片」输入，看协议能不能被声明式路由接受。
 *
 * 复现链路（runtime-0.3.3）：
 *   Canvas 本地图片 → canvasAssets.resolveCanvasLocalAsset() 只产出 dataUrl（无公开 url）
 *   → declarativeRouter.standardProtocolTaskFromAiTask() 里的 protocolAsset() 按素材规则判定
 *   → 规则是 public_url 时返回 null → resolveDeclarativeRoute() 返回 legacy/unsupported_local_input
 *   → index.ts:3773 直接 409「Canvas Surface 只允许已精确启用的声明式协议」
 *
 * 这里直接调用运行时自己的 standardProtocolTaskFromAiTask()，用真实 Canvas 本地素材形态
 * （只有 dataUrl / mime / name / bytes，没有 url、没有 remoteName）跑一遍，再编译出真实 body。
 *
 * 用法: node --experimental-transform-types probe-local-input.mjs <model.json> <provider.json>
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveServerDir } from './dxos-paths.mjs'

const SERVER = resolveServerDir()
const { standardProtocolTaskFromAiTask } = await import(pathToFileURL(path.join(SERVER, 'ai-tasks/declarativeRouter.ts')).href)
const { compileProtocolPlan } = await import(pathToFileURL(path.join(SERVER, 'protocol-engine/compiler.ts')).href)

const model = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const providerProtocol = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))

// Canvas 本地素材：canvasAssets.ts:58-68 的形状（dataUrl + mime + name + bytes）
const SAMPLE = {
  kind: 'image',
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  mime: 'image/png',
  name: 'canvas-local.png',
  bytes: 70,
}

const baseUrl = 'https://api.qnaigc.com'

let total = 0
let bad = 0
for (const [profileId, profile] of Object.entries(model.modelProfiles || {})) {
  const modelName = (profile.match || [])[0] || profileId
  for (const intent of ['image.generate', 'image.edit']) {
    if (profile.workflows && !Object.prototype.hasOwnProperty.call(profile.workflows, intent)) continue
    total += 1
    const inputs = intent === 'image.edit'
      ? [{ assetId: 'n1', kind: 'image', source: { type: 'fs-node', id: 'n1' }, role: 'reference_image' }]
      : []
    const task = {
      format: 'dx-ai-task/v2',
      requestId: 'probe',
      context: { surface: 'canvas', workspace: { type: 'canvas', id: 'probe-canvas' } },
      intent,
      provider: { platform: 'api', providerId: 'qiniu', model: modelName },
      prompt: 'keep composition, remove text',
      params: { aspect_ratio: '1:1', resolution: '2K', quality: 'high', output_format: 'png' },
      inputs,
      output: { kind: 'image', count: 1 },
    }
    const label = `${profileId} / ${intent}`

    const protocolTask = standardProtocolTaskFromAiTask(task, model, new Map([['n1', { assetId: 'n1', ...SAMPLE }]]))
    if (!protocolTask) {
      bad += 1
      console.log(`[FAIL] ${label}`)
      console.log('       本地素材过不了素材规则 → 路由回落 legacy → Canvas 直接 409 unsupported_local_input')
      continue
    }
    const plan = compileProtocolPlan({
      providerProtocol, modelProtocol: model, baseUrl,
      credential: 'sk-probe', task: protocolTask, redactSecrets: true,
    })
    const submit = plan.steps.find((s) => s.id === 'submit')
    const urls = intent === 'image.edit' ? submit.request.body?.image_urls : null
    const okShape = !urls || (Array.isArray(urls) && urls.length === 1 && String(urls[0]).startsWith('data:image/'))
    if (!okShape) {
      bad += 1
      console.log(`[FAIL] ${label} -> ${plan.workflow} / ${submit.operation}`)
      console.log(`       image_urls 形态不对: ${JSON.stringify(urls).slice(0, 160)}`)
      continue
    }
    console.log(`[ok  ] ${label} -> ${plan.workflow} / ${submit.operation}`)
    console.log(`       body: ${JSON.stringify(submit.request.body).slice(0, 220)}`)
  }
}

console.log(bad
  ? `\n>>> ${bad}/${total} 条链路在「Canvas 本地素材」下不可用`
  : `\n>>> ${total} 条链路全部接受 Canvas 本地素材`)
process.exit(bad ? 1 : 0)
