#!/usr/bin/env node
/**
 * DX OS v2 协议语义体检（静态分析）
 *
 * 为什么需要它：verify-protocol.mjs 依赖官方引擎的 schema 校验 + 真机编译，
 * 能拦住「装不进去」和「编译不过」。但有一类问题两者都抓不到 —— 能装、能编译，
 * 功能却是坏的（静默失败）。本脚本专门查这一类：
 *   · 档案级 uiSchemas 写成字典   → 参数面板一格不显示，覆盖率仍全绿
 *   · response 里写了引擎不认识的键 → 静默丢弃
 *   · 空方括号 selector `$.a[].b`  → 0.3.3 完全不解析
 *   · 点号通配模板 `{{inputs.images.*.url}}` → 非法
 *   · $cardinality 缺 one 分支    → 装不进去
 *   · workflow 引用不存在的 operation / capability 无人实现
 *   · path 占位符既不是模板根变量也不是任何 capture 键
 *   · 需要 Data URL 的链路却声明 public_url（或反之）
 *   · 素材规则是 public_url / remote_name，但 Canvas 本地素材只有 dataUrl
 *     → 本地图片必被 409「unsupported_local_input」拦住（本地图生图的头号坑）
 *   · 声明了 upload_operation 却没有 workflow.uploads 上传步骤
 *   · limits.references 平铺写法（读不到）
 *
 * 规则与 runtime-0.3.3 validator.ts 逐条对齐（ID/SELECTOR/模板正则、原语字段集）。
 *
 * 用法：
 *   node audit-semantics.mjs [协议根目录]
 *   # 默认 C:/Users/<用户名>/Desktop/新api接口-dxos，也可用环境变量 PROTO_BASE
 *
 * 退出码：0 = 无问题；1 = 发现问题（可直接接进批处理）
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = path.resolve(process.argv[2] || process.env.PROTO_BASE || 'C:/Users/<用户名>/Desktop/新api接口-dxos')

/* ---- 与 validator.ts 完全一致的正则与常量 ---- */
const ID_RE = /^[a-z0-9][a-z0-9:_-]{1,63}$/
const SEL_RE = /^\$(?:\.[A-Za-z0-9_-]+|\[(?:\d+|\*)\])*$/
const TPL_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[(?:\*|\d+)\]))*$/
const ROOTS = new Set(['model', 'prompt', 'params', 'inputs', 'provider', 'captures', 'derived'])
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const REQ_MODES = new Set(['json', 'query', 'path', 'multipart', 'binary'])
const RESP_MODES = new Set(['json', 'text', 'binary', 'sse'])
const RESP_KEYS = new Set(['taskId', 'status', 'progress', 'resultUrl', 'resultUrls', 'resultData',
  'resultMimeTypes', 'errorCode', 'errorMessage', 'data', 'assetUrl', 'text', 'usage', 'output'])
const ASSET_KINDS = new Set(['images', 'videos', 'audios', 'files'])
const ASSET_MODES = new Set(['data_url', 'public_url', 'remote_name', 'upload_operation'])
const WF_KEYS = new Set(['uploads', 'submit', 'poll', 'download', 'result'])
const RESULT_KINDS = new Set(['image', 'video', 'audio', 'text', 'file'])
const RESULT_SOURCES = new Set(['response', 'resultUrl', 'binary'])
const CARD_ALLOWED = new Set(['from', 'zero', 'one', 'two', 'many'])
const CARD_REQUIRED = ['from', 'zero', 'one', 'many']
const PRIMITIVES = new Set(['$map', '$concat', '$merge', '$coalesce', '$cardinality', '$keyValue', '$dataUrlBase64', '$files', '$binary'])

const problems = []
const seen = new Set()
const notes = new Map()
const stats = { files: 0, sites: 0, models: 0, workflows: 0, operations: 0, assetChecks: 0 }

function add(kind, loc, msg) {
  const key = `${kind}\u0000${loc}\u0000${msg}`
  if (seen.has(key)) return
  seen.add(key)
  problems.push({ kind, loc, msg })
}
function note(cat, msg) {
  if (!notes.has(cat)) notes.set(cat, [])
  notes.get(cat).push(msg)
}
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

/* ---- 递归收集模板表达式 + 原语 + inputs.<kind> 引用 ---- */
function scanTemplates(value, loc, out, depth = 0, roots = ROOTS) {
  if (depth > 20) return
  if (typeof value === 'string') {
    for (const m of value.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
      const expr = m[1].trim()
      out.expr.push([loc, expr])
      if (!TPL_RE.test(expr)) add('模板-非法', loc, `非法模板表达式 ${JSON.stringify(expr)}`)
      else if (!roots.has(expr.split('.')[0])) add('模板-越权', loc, `未授权模板变量 ${JSON.stringify(expr)}`)
      const mm = /^inputs\.([A-Za-z_][A-Za-z0-9_]*)/.exec(expr)
      if (mm) out.kinds.add(mm[1])
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanTemplates(v, `${loc}[${i}]`, out, depth + 1, roots))
    return
  }
  if (!isObj(value)) return
  for (const k of Object.keys(value)) if (PRIMITIVES.has(k)) out.prim.add(k)
  if ('$dataUrlBase64' in value) {
    scanTemplates(value.$dataUrlBase64, `${loc}.$dataUrlBase64`, out, depth + 1, roots)
    return
  }
  if ('$map' in value) {
    const mp = isObj(value.$map) ? value.$map : {}
    scanTemplates(mp.from, `${loc}.$map.from`, out, depth + 1, roots)
    scanTemplates(mp.template, `${loc}.$map.template`, out, depth + 1, new Set([...roots, 'item']))
    for (const k of Object.keys(value)) if (k !== '$map') scanTemplates(value[k], `${loc}.${k}`, out, depth + 1, roots)
    return
  }
  if ('$cardinality' in value) {
    const cd = isObj(value.$cardinality) ? value.$cardinality : {}
    const keys = new Set(Object.keys(cd))
    const missing = CARD_REQUIRED.filter((k) => !keys.has(k))
    const extra = [...keys].filter((k) => !CARD_ALLOWED.has(k))
    if (missing.length) add('原语-$cardinality', loc, `缺少必需分支 [${missing.join(',')}]（schema 必填，会导致装不进去）`)
    if (extra.length) add('原语-$cardinality', loc, `含非法分支 [${extra.join(',')}]`)
    scanTemplates(cd.from, `${loc}.$cardinality.from`, out, depth + 1, roots)
    scanTemplates(cd.zero, `${loc}.$cardinality.zero`, out, depth + 1, roots)
    const br = new Set([...roots, 'item', 'items'])
    for (const b of ['one', 'two', 'many']) if (b in cd) scanTemplates(cd[b], `${loc}.$cardinality.${b}`, out, depth + 1, br)
    for (const k of Object.keys(value)) if (k !== '$cardinality') scanTemplates(value[k], `${loc}.${k}`, out, depth + 1, roots)
    return
  }
  for (const op of ['$merge', '$coalesce', '$concat']) {
    if (op in value) {
      for (const k of Object.keys(value)) if (k !== op) scanTemplates(value[k], `${loc}.${k}`, out, depth + 1, roots)
      scanTemplates(value[op], `${loc}.${op}`, out, depth + 1, roots)
      return
    }
  }
  if ('$keyValue' in value) {
    scanTemplates(value.$keyValue, `${loc}.$keyValue`, out, depth + 1, roots)
    for (const k of Object.keys(value)) if (k !== '$keyValue') scanTemplates(value[k], `${loc}.${k}`, out, depth + 1, roots)
    return
  }
  for (const [k, v] of Object.entries(value)) scanTemplates(v, `${loc}.${k}`, out, depth + 1, roots)
}

/* ---- path / query 里的 {占位符} ---- */
function opRefs(op) {
  const names = new Set()
  for (const m of String(op?.path ?? '').matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) names.add(m[1])
  if (isObj(op?.queryTemplate)) {
    for (const m of JSON.stringify(op.queryTemplate).matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) names.add(m[1])
  }
  return names
}

/* ---- 递归找 json ---- */
function walkJson(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkJson(p))
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out
}

/* ================= 主流程 ================= */
const providers = new Map()
const models = new Map()

let files
try {
  files = walkJson(BASE).sort()
} catch (e) {
  console.error(`无法读取目录：${BASE}\n${e.message}`)
  process.exit(2)
}
if (!files.length) { console.error(`目录下没有 .json：${BASE}`); process.exit(2) }

for (const f of files) {
  const rel = path.relative(BASE, f).replaceAll('\\', '/')
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (e) {
    add('JSON', rel, `解析失败 ${e.message}`)
    continue
  }
  stats.files++
  if (doc.schemaVersion !== 'dx-protocol/v2') add('基础', rel, `schemaVersion 应为 dx-protocol/v2，实际 ${JSON.stringify(doc.schemaVersion)}`)
  const dir = path.dirname(rel)
  if (doc.kind === 'provider') providers.set(dir, { rel, doc })
  else if (doc.kind === 'model') models.set(dir, { rel, doc })
  else add('基础', rel, `kind 非法 ${JSON.stringify(doc.kind)}`)
}

/* ---- 目录级配对 ---- */
for (const d of [...new Set([...providers.keys(), ...models.keys()])].sort()) {
  if (!providers.has(d)) { add('配对', d, '缺少 provider 协议'); continue }
  if (!models.has(d)) { add('配对', d, '缺少 model 协议'); continue }
  const pd = providers.get(d).doc
  const md = models.get(d).doc
  if (pd.id !== md.id) add('配对', d, `provider.id=${JSON.stringify(pd.id)} 与 model.id=${JSON.stringify(md.id)} 不一致（不会自动绑定）`)
  else stats.sites++
}

/* ---- provider ---- */
for (const [d, { rel, doc }] of [...providers.entries()].sort()) {
  const execu = doc.executor ?? {}
  if (execu.type !== 'declarative') add('executor', rel, 'executor.type 应为 declarative')
  const auth = doc.auth ?? {}
  if (!['bearer', 'api_key_header', 'google_api_key', 'none'].includes(auth.type)) add('auth', rel, `auth.type 非法 ${JSON.stringify(auth.type)}`)
  const mseg = doc.models
  if (!isObj(mseg)) {
    add('provider-models', rel, 'models 段缺失（schema 必填 → 装不进去）')
  } else {
    if (!METHODS.has(String(mseg.method ?? '').toUpperCase())) add('provider-models', rel, `models.method 不受支持 ${JSON.stringify(mseg.method)}`)
    const p = String(mseg.path ?? '')
    if (!p || !p.startsWith('/')) add('provider-models', rel, `models.path 应为相对路径（以 / 开头），实际 ${JSON.stringify(p)}`)
    const rm = mseg.response
    if (!isObj(rm)) add('provider-models', rel, 'models.response 缺失')
    else {
      for (const k of Object.keys(rm)) if (!RESP_KEYS.has(k)) add('provider-models', rel, `models.response 含未知键 ${JSON.stringify(k)}`)
      if (!('data' in rm)) add('provider-models', rel, 'models.response.data 缺失（schema 必填）')
      for (const [k, v] of Object.entries(rm)) {
        const arr = typeof v === 'string' ? [v] : Array.isArray(v) ? v : []
        for (const s of arr) if (typeof s !== 'string' || !SEL_RE.test(s)) add('selector', rel, `models.response.${k} 非法 selector ${JSON.stringify(s)}`)
      }
    }
  }
  for (const [oid, op] of Object.entries(doc.operations ?? {})) {
    const loc = `${rel}:${oid}`
    if (!ID_RE.test(oid.replaceAll('.', '_'))) add('operation-id', loc, `operation id 非法（须全小写 ^[a-z0-9][a-z0-9:_-]{1,63}$，点会转下划线）`)
    if (!METHODS.has(String(op?.method ?? '').toUpperCase())) add('operation', loc, `method 非法 ${JSON.stringify(op?.method)}`)
    if (op?.requestMode != null && !REQ_MODES.has(op.requestMode)) add('operation', loc, `requestMode 非法 ${JSON.stringify(op.requestMode)}`)
    if (op?.responseMode != null && !RESP_MODES.has(op.responseMode)) add('operation', loc, `responseMode 非法 ${JSON.stringify(op.responseMode)}`)
    scanTemplates(op, loc, { expr: [], prim: new Set(), kinds: new Set() })
  }
}

/* ---- model ---- */
for (const [d, { rel, doc }] of [...models.entries()].sort()) {
  const ops = doc.operations ?? {}
  const wfs = doc.workflows ?? {}
  const caps = Array.isArray(doc.capabilities) ? doc.capabilities : []
  const profs = doc.modelProfiles ?? {}
  const topUi = doc.uiSchemas
  const topAssets = doc.assets ?? {}

  if (topUi != null && !isObj(topUi)) add('uiSchemas', rel, `顶层 uiSchemas 必须是「字典」(schemaId -> 字段数组)，实际 ${Array.isArray(topUi) ? 'array' : typeof topUi}`)
  else if (isObj(topUi)) for (const [sid, fields] of Object.entries(topUi)) if (!Array.isArray(fields)) add('uiSchemas', rel, `uiSchemas[${JSON.stringify(sid)}] 必须是数组`)

  if (!caps.length) add('capabilities', rel, 'capabilities 为空（无法被 UI 识别）')

  const scopes = [['顶层', topAssets], ...Object.entries(profs).map(([pid, pr]) => [`档案 ${pid}`, pr.assets ?? {}])]
  for (const [scope, rules] of scopes) {
    if (!isObj(rules)) continue
    for (const [kind, rule] of Object.entries(rules)) {
      if (!ASSET_KINDS.has(kind)) add('assets', rel, `${scope} assets 含非法素材类型 ${JSON.stringify(kind)}`)
      if (!isObj(rule)) { add('assets', rel, `${scope} assets.${kind} 应为对象`); continue }
      if (!ASSET_MODES.has(rule.mode)) add('assets', rel, `${scope} assets.${kind}.mode 非法 ${JSON.stringify(rule.mode)}`)
      if (rule.maxBytes != null) {
        const mv = Number(rule.maxBytes)
        if (!Number.isInteger(mv) || mv < 1 || mv > 500 * 1024 * 1024) add('assets', rel, `${scope} assets.${kind}.maxBytes 越界 ${JSON.stringify(rule.maxBytes)}`)
      }
      if (rule.maxDimension != null) {
        const mv = Number(rule.maxDimension)
        if (!Number.isInteger(mv) || mv < 64 || mv > 16384) add('assets', rel, `${scope} assets.${kind}.maxDimension 越界 ${JSON.stringify(rule.maxDimension)}`)
      }
    }
  }

  const allCaptures = new Set()
  for (const op of Object.values(ops)) for (const k of Object.keys(op?.response ?? {})) allCaptures.add(k)

  for (const [oid, op] of Object.entries(ops).sort()) {
    const loc = `${rel}:${oid}`
    if (!ID_RE.test(oid.replaceAll('.', '_'))) add('operation-id', loc, 'operation id 非法（须全小写 ^[a-z0-9][a-z0-9:_-]{1,63}$，点会转下划线）')
    if (!METHODS.has(String(op?.method ?? '').toUpperCase())) add('operation', loc, `method 非法 ${JSON.stringify(op?.method)}`)
    if (!String(op?.path ?? '')) add('operation', loc, 'path 为空')
    if (op?.requestMode != null && !REQ_MODES.has(op.requestMode)) add('operation', loc, `requestMode 非法 ${JSON.stringify(op.requestMode)}`)
    if (op?.responseMode != null && !RESP_MODES.has(op.responseMode)) add('operation', loc, `responseMode 非法 ${JSON.stringify(op.responseMode)}`)
    if (op?.response != null) {
      if (!isObj(op.response)) add('operation', loc, 'response 应为对象')
      else for (const [k, v] of Object.entries(op.response)) {
        if (!RESP_KEYS.has(k)) add('response-key', loc, `response 含未知键 ${JSON.stringify(k)}（引擎不识别，静默丢弃）`)
        const arr = typeof v === 'string' ? [v] : Array.isArray(v) ? v : null
        if (arr === null) { add('selector', loc, `response.${k} 必须是字符串或字符串数组`); continue }
        for (const s of arr) {
          if (typeof s !== 'string') add('selector', loc, `response.${k} 含非字符串项`)
          else if (!SEL_RE.test(s)) {
            const hint = s.includes('[]') ? '（空方括号 [] 在 0.3.3 不被解析，须写 [*] 或 [N]）' : ''
            add('selector', loc, `response.${k} 非法 selector ${JSON.stringify(s)}${hint}`)
          }
        }
      }
    }
    // pathValue() 先试裸模板根变量，再试 captures.<key>
    for (const name of [...opRefs(op)].sort()) {
      if (!ROOTS.has(name) && !allCaptures.has(name)) {
        add('占位符', loc, `path/query 使用 {${name}}，既不是模板根变量(${[...ROOTS].sort().join('/')})也不是任何 response capture 键`)
      }
    }
    const scanned = { expr: [], prim: new Set(), kinds: new Set() }
    scanTemplates(op, loc, scanned)
    // 画布「系统参数」的取值范围比协议声明的枚举更宽：
    //   aspect_ratio：选「原图比例」时 params.ratio==="source"，客户端会先换算成 GCD 约分后的
    //                 **具体比**（实测 1055:1491）再填进 params.aspect_ratio，不是字面量 source；
    //   resolution  ：一律小写 "1k"/"2k"/"4k"。
    // 直接透传给上游就会落到枚举之外 —— 轻则被上游忽略（用户以为选了 2K，实际出默认档），
    // 重则 400。必须经 derive 归一：比例走 lookup 白名单 + fallback "auto"，
    // 分辨率走 upper / 大小写双写。
    for (const expr of new Set(scanned.expr.map(([, e]) => e))) {
      if (expr === 'params.aspect_ratio' || expr === 'params.resolution') {
        note('画布取值直传', `${loc} 直接透传 {{${expr}}}：画布发的是枚举外的值`
          + `（比例选「原图比例」时是具体比如 1055:1491；分辨率是小写 1k/2k/4k），`
          + '须经 derive 归一（lookup 白名单 → fallback auto / upper 转大写）')
      }
    }
    stats.operations++
  }

  for (const [wid, wf] of Object.entries(wfs).sort()) {
    const loc = `${rel}:workflow[${wid}]`
    if (!isObj(wf)) { add('workflow', loc, '应为对象'); continue }
    const extra = Object.keys(wf).filter((k) => !WF_KEYS.has(k))
    if (extra.length) add('workflow', loc, `含无效键 [${extra.join(',')}]（引擎不识别；本地文件上传应写 uploads）`)
    if (!('submit' in wf)) add('workflow', loc, '缺少必需键 submit')
    if (typeof wf.submit === 'string' && !(wf.submit in ops)) add('workflow', loc, `submit 引用了不存在的 operation ${JSON.stringify(wf.submit)}`)
    const pol = wf.poll
    if (pol != null) {
      if (!isObj(pol)) add('workflow', loc, 'poll 应为对象')
      else {
        if (typeof pol.operation === 'string' && !(pol.operation in ops)) add('workflow', loc, `poll.operation 引用了不存在的 operation ${JSON.stringify(pol.operation)}`)
        const st = pol.status
        if (!isObj(st) || !Array.isArray(st.pending) || !st.pending.length || !Array.isArray(st.success) || !st.success.length || !Array.isArray(st.failure) || !st.failure.length) {
          add('workflow', loc, 'poll.status 必须同时有非空 pending/success/failure')
        }
        if (!(Number(pol.intervalMs) > 0)) add('workflow', loc, 'poll.intervalMs 必须为正数')
      }
    }
    if (typeof wf.download === 'string' && !(wf.download in ops)) add('workflow', loc, `download 引用了不存在的 operation ${JSON.stringify(wf.download)}`)
    if (wf.result == null) add('workflow', loc, 'result 缺失 → 产物类型 undefined')
    else if (!isObj(wf.result)) add('workflow', loc, 'result 应为对象')
    else {
      if (!RESULT_KINDS.has(wf.result.kind)) add('workflow', loc, `result.kind 非法/缺失 ${JSON.stringify(wf.result.kind)} → 产物类型 undefined`)
      if ('source' in wf.result && !RESULT_SOURCES.has(wf.result.source)) add('workflow', loc, `result.source 非法 ${JSON.stringify(wf.result.source)}`)
      if (typeof wf.result.operation === 'string' && !(wf.result.operation in ops)) add('workflow', loc, `result.operation 引用不存在 ${JSON.stringify(wf.result.operation)}`)
    }
    for (const [i, up] of (Array.isArray(wf.uploads) ? wf.uploads : []).entries()) {
      const ul = `${loc}:uploads[${i}]`
      if (!isObj(up)) { add('workflow', ul, '应为对象'); continue }
      if (!ASSET_KINDS.has(up.inputs)) add('workflow', ul, `inputs 非法 ${JSON.stringify(up.inputs)}`)
      if (typeof up.operation === 'string' && !(up.operation in ops)) add('workflow', ul, `operation 引用不存在 ${JSON.stringify(up.operation)}`)
      const r = up.result
      if (!isObj(r) || !r.source || !['url', 'remoteName'].includes(r.target)) add('workflow', ul, 'result 必须含 source 且 target ∈ {url, remoteName}')
    }
    stats.workflows++
  }

  const matchOwner = new Map()
  for (const [pid, pr] of Object.entries(profs).sort()) {
    const loc = `${rel}:profile[${pid}]`
    const pcaps = pr.capabilities
    if (!Array.isArray(pcaps) || !pcaps.length) add('profile', loc, 'capabilities 缺失或为空')
    else {
      const unknown = pcaps.filter((c) => caps.length && !caps.includes(c))
      if (unknown.length) add('profile', loc, `capabilities 含顶层未声明的 [${unknown.join(',')}]`)
    }
    const pui = pr.uiSchemas
    if (pui == null) note('档案未写 uiSchemas（沿用顶层默认）', `${rel} ${pid}`)
    else if (!Array.isArray(pui) || !pui.every((x) => typeof x === 'string')) {
      add('uiSchemas', loc, `档案级 uiSchemas 必须是「字符串数组」(字段名列表)，实际 ${Array.isArray(pui) ? 'array' : typeof pui} → 参数面板可能一格不显示`)
    } else for (const sid of pui) if (isObj(topUi) && !(sid in topUi)) add('uiSchemas', loc, `uiSchemas 引用不存在的 schema ${JSON.stringify(sid)}`)

    const pws = pr.workflows ?? {}
    for (const [intent, wfid] of Object.entries(pws)) {
      const refs = Array.isArray(wfid) ? wfid : [wfid]
      if (!refs.every((r) => typeof r === 'string')) { add('profile', loc, `workflows[${intent}] 必须是字符串或字符串数组`); continue }
      for (const r of refs) if (!(r in wfs)) add('profile', loc, `workflows[${intent}] 引用不存在的 workflow ${JSON.stringify(r)}`)
    }
    for (const mname of (pr.match ?? [])) {
      if (matchOwner.has(mname) && matchOwner.get(mname) !== pid) add('profile-match', loc, `模型名 ${JSON.stringify(mname)} 与档案 ${JSON.stringify(matchOwner.get(mname))} 重复匹配 → 解析歧义`)
      matchOwner.set(mname, pid)
    }
    const lim = pr.limits
    if (isObj(lim) && 'references' in lim) {
      const rr = lim.references
      if (!isObj(rr)) add('limits', loc, 'limits.references 必须是对象')
      else for (const [k, v] of Object.entries(rr)) {
        if (!ASSET_KINDS.has(k)) add('limits', loc, `limits.references 含非法键 ${JSON.stringify(k)}`)
        else if (!isObj(v)) add('limits', loc, `limits.references.${k} 必须嵌套为对象（平铺写法谁也读不到）`)
      }
    }
    // 素材交付模式 vs 操作原语（档案级优先，declarativeRouter.ts:49）
    const eff = { ...topAssets, ...(pr.assets ?? {}) }
    const wfSeen = new Set()
    for (const wfid of Object.values(pws)) {
      for (const wfid1 of (Array.isArray(wfid) ? wfid : [wfid])) {
        if (wfSeen.has(wfid1) || !(wfid1 in wfs)) continue
        wfSeen.add(wfid1)
        const wf = wfs[wfid1] ?? {}
        const ids = [wf.submit]
        if (isObj(wf.poll)) ids.push(wf.poll.operation)
        if (typeof wf.download === 'string') ids.push(wf.download)
        if (isObj(wf.result)) ids.push(wf.result.operation)
        for (const u of (wf.uploads ?? [])) if (isObj(u)) ids.push(u.operation)
        for (const oid of ids.filter((i) => typeof i === 'string' && i in ops)) {
          const op = ops[oid]
          const o = { expr: [], prim: new Set(), kinds: new Set() }
          scanTemplates(op, `${loc}:${oid}`, o)
          const isMultipart = op.requestMode === 'multipart'
          const needsB64 = isMultipart || o.prim.has('$dataUrlBase64') || o.prim.has('$files')
          // 模板里直接读 inputs.<kind>[*].dataUrl 时，data_url 就是正确模式，不算冗余
          const readsDataUrl = o.expr.some(([, e]) => /\.dataUrl\b/.test(String(e)))
          for (const kind of [...o.kinds].sort()) {
            const rule = eff[kind]
            const mode = isObj(rule) ? rule.mode : undefined
            if (needsB64 && mode !== 'data_url') {
              const why = [isMultipart ? 'multipart' : null, ...(o.prim.has('$dataUrlBase64') ? ['$dataUrlBase64'] : []), ...(o.prim.has('$files') ? ['$files'] : [])].filter(Boolean).join('+')
              add('素材模式', `${loc} → ${oid}`, `使用了 ${why}（要求 Data URL）但 ${kind} 的有效交付模式是 ${JSON.stringify(mode)}（须 data_url，否则运行时报错）`)
            }
            if (!needsB64 && !readsDataUrl && mode === 'data_url') note('可能冗余 data_url（会白白下载转 base64）', `${rel} ${pid}.${kind}`)
            if (rule == null) note('素材无交付规则（引擎默认透传 url）', `${rel} ${pid}.${kind}`)
            // public_url / remote_name 只认带公网 url 的素材，而本地素材（canvasAssets.ts:58-68）
            // 默认只有 dataUrl + mime + name + bytes。
            // url 只在画布「素材传输 = URL（图床）」时才有（canvas 1.0.112 的 Z3()：媒体 mode
            // 必须是 url，且 /canvas/public-media 上传成功，状态 valid/expiring）。
            // 任务库实证（2026-09-11）：素材形态由协议声明决定 —— public_url 时期落库 inputs 是
            // {url}，data_url 时期是 {dataUrl:"<local-asset:...>"}；同一分钟两条不同协议即分叉。
            // 所以这条按「用户走 Base64 方式」的条件成立：此时 protocolAsset 判 null
            //（declarativeRouter.ts:94-105）→ 路由回落 legacy → index.ts:3773 直接 409
            // 「Canvas Surface 只允许已精确启用的声明式协议：unsupported_local_input」。
            if ((mode === 'public_url' || mode === 'remote_name') && !isMultipart) {
              add('素材模式', `${loc} → ${oid}`,
                `${kind} 的有效交付模式是 ${mode}（只认带公网 url 的素材）。`
                + '用户走画布「素材传输 = URL」（图床）时正常；走 Base64 方式时本地素材只有 dataUrl，'
                + '过不了规则 → 409 unsupported_local_input。'
                + '图片建议改 data_url；体积大的视频/音频若坚持 public_url，'
                + '交付说明须写明「参考素材要走画布的 URL 方式」')
            }
            if (mode === 'upload_operation') {
              const uploads = Array.isArray(wf.uploads) ? wf.uploads.filter(isObj) : []
              if (!uploads.some((u) => u.inputs === kind)) {
                add('素材模式', `${loc} → ${wfid1}`,
                  `${kind} 声明了 upload_operation 但 workflow 没有对应的 uploads 步骤（uploads[].inputs=${kind}）→ 本地素材永远不会被上传，提交时拿不到 URL`)
              }
            }
          }
          stats.assetChecks++
        }
      }
    }
  }

  // capability 覆盖
  const covered = new Set()
  for (const pr of Object.values(profs)) for (const intent of Object.keys(pr.workflows ?? {})) covered.add(intent)
  for (const c of caps) if (!covered.has(c) && !(c in wfs)) add('capability', rel, `capabilities 声明了 ${JSON.stringify(c)}，但没有任何档案/顶层 workflow 提供实现`)
  for (const [pid, pr] of Object.entries(profs).sort()) {
    const pws = pr.workflows ?? {}
    for (const c of (pr.capabilities ?? [])) if (!(c in pws)) add('capability', `${rel}:profile[${pid}]`, `档案 capabilities 声明了 ${JSON.stringify(c)} 但没有对应 workflow 映射`)
  }

  // 孤儿 operation
  const used = new Set()
  for (const wf of Object.values(wfs)) {
    if (!isObj(wf)) continue
    for (const x of [wf.submit, wf.download]) if (typeof x === 'string') used.add(x)
    if (isObj(wf.poll) && typeof wf.poll.operation === 'string') used.add(wf.poll.operation)
    if (isObj(wf.result) && typeof wf.result.operation === 'string') used.add(wf.result.operation)
    for (const u of (wf.uploads ?? [])) if (isObj(u) && typeof u.operation === 'string') used.add(u.operation)
  }
  const orphan = Object.keys(ops).filter((o) => !used.has(o)).sort()
  if (orphan.length) note('孤儿 operation（无 workflow 引用）', `${rel}: ${orphan.join(', ')}`)
  stats.models++
}

/* ---- 报告 ---- */
const line = '='.repeat(100)
console.log(line)
console.log(`DX OS v2 协议语义体检   baseDir=${BASE}`)
console.log(`文件 ${stats.files} 个 | 站点配对 ${stats.sites} 组 | model ${stats.models} | workflow ${stats.workflows} | operation ${stats.operations} | 素材链路检查 ${stats.assetChecks}`)
console.log(line)

if (problems.length) {
  const grouped = new Map()
  for (const p of problems) {
    if (!grouped.has(p.kind)) grouped.set(p.kind, [])
    grouped.get(p.kind).push(p)
  }
  console.log(`\n发现 ${problems.length} 个问题：\n`)
  for (const kind of [...grouped.keys()].sort()) {
    const arr = grouped.get(kind)
    console.log(`### ${kind}  (${arr.length})`)
    for (const p of arr) console.log(`   - ${p.loc}  ${p.msg}`)
    console.log()
  }
} else {
  console.log('\n[通过] 未发现结构/语义问题。\n')
}

if (notes.size) {
  console.log('-'.repeat(100))
  console.log('提示级（非错误）：')
  for (const cat of [...notes.keys()].sort()) {
    const vals = notes.get(cat)
    console.log(`  · ${cat} (${vals.length}):`)
    for (const v of vals.slice(0, 8)) console.log(`       ${v}`)
    if (vals.length > 8) console.log(`       ... 另有 ${vals.length - 8} 条`)
  }
}

process.exit(problems.length ? 1 : 0)
