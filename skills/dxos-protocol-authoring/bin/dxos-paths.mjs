/**
 * DX OS 安装位置解析（四个校验脚本共用）
 *
 * 之前每个脚本都硬编码了具体的便携版安装路径，
 * DX OS 升级到 0.3.x 后整条链路直接 ERR_MODULE_NOT_FOUND 全挂。
 * 这里改为：自动扫描各盘的便携版目录 → 取版本号最大的 → 读
 * `.dx-runtime/.active-runtime` 定位真正的运行时。
 *
 * 覆盖方式（优先级从高到低）：
 *   DXOS_ENGINE = <...>/server/protocol-engine
 *   DXOS_SERVER = <...>/resources/app.asar.unpacked/server
 *   DXOS_ROOT   = <...>/DXOS-Portable-x.y.z-win-x64
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* ================= 用户环境自动探测 =================
 * 本项目会在不同电脑之间复制共享，各机器用户名不同（Admin / LYQ / ...），
 * 所以任何路径都不得写死用户名。以下函数统一从当前机器解析真实值。
 */

/** 当前机器的用户主目录（Windows 优先 USERPROFILE，其余走 os.homedir） */
export function resolveHomeDir() {
  return process.env.DXOS_HOME
    || process.env.USERPROFILE
    || os.homedir()
}

/** 当前机器的用户名（仅用于展示/兜底，不要在代码里写死） */
export function resolveUserName() {
  return process.env.DXOS_USER
    || process.env.USERNAME
    || process.env.USER
    || path.basename(resolveHomeDir())
}

/** 当前机器的技能目录（AI 助手加载技能的位置） */
export function resolveSkillsDir() {
  return process.env.DXOS_SKILLS_DIR
    || path.join(resolveHomeDir(), '.workbuddy', 'skills')
}

/** 当前机器的 Node 可执行文件路径（换成别的机器也能跑） */
export function resolveNodeBin() {
  return process.env.DXOS_NODE
    || process.execPath
}

/** 把路径里的 <用户名> / $HOME / ${HOME} / ~ 占位符替换成当前机器的真实值 */
export function expandUserPlaceholders(input) {
  const home = resolveHomeDir().replaceAll('\\', '/')
  return String(input)
    // $HOME / ${HOME}
    .replace(/\$\{HOME\}|\$HOME\b/gi, home)
    // <用户名> / <user> / <username> / ${USERNAME}
    .replace(/<用户名>|<user>|<username>|\$\{?USERNAME\}?/gi, () => resolveUserName())
    // 行首 ~
    .replace(/^~(?=[\\/]|$)/, home)
}

/** 让 Node 能直接打印一份当前机器的路径清单，便于排障 */
export function describeEnv() {
  return {
    home: resolveHomeDir(),
    user: resolveUserName(),
    skills: resolveSkillsDir(),
    node: resolveNodeBin(),
  }
}

function versionKey(name) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(name)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0]
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] - right[index]
  return 0
}

function portableRoots() {
  const found = []
  const bases = []
  for (const drive of ['C:', 'D:', 'E:', 'F:', 'G:']) {
    for (const sub of ['/Apps', '/Program Files', '/']) bases.push(`${drive}${sub}`)
  }
  for (const base of bases) {
    let names = []
    try { names = fs.readdirSync(base) } catch { continue }
    for (const name of names) {
      if (/^DXOS-Portable-.*-win-x64$/i.test(name)) found.push(path.join(base, name))
    }
  }
  return [...new Set(found)]
}

export function resolveDxosRoot() {
  if (process.env.DXOS_ROOT) return process.env.DXOS_ROOT
  const roots = portableRoots()
  if (!roots.length) {
    throw new Error('未找到 DX OS 便携版目录（DXOS-Portable-*-win-x64），请用环境变量 DXOS_ROOT 指定安装根目录')
  }
  roots.sort((left, right) => compareVersion(versionKey(path.basename(left)), versionKey(path.basename(right))))
  return roots[roots.length - 1]
}

function runtimeDirs(root) {
  const versionsDir = path.join(root, '.dx-runtime', 'versions')
  let names = []
  try { names = fs.readdirSync(versionsDir) } catch { return [] }
  return names.filter((name) => name.startsWith('runtime-')).map((name) => path.join(versionsDir, name))
}

export function resolveServerDir() {
  if (process.env.DXOS_SERVER) return process.env.DXOS_SERVER
  const root = resolveDxosRoot()
  const dirs = runtimeDirs(root)
  let active = ''
  try { active = fs.readFileSync(path.join(root, '.dx-runtime', '.active-runtime'), 'utf8').trim() } catch { /* 无指针时退回最大版本 */ }
  const picked = dirs.find((dir) => path.basename(dir) === active)
    || [...dirs].sort((left, right) => compareVersion(versionKey(path.basename(left)), versionKey(path.basename(right)))).pop()
  if (!picked) throw new Error(`未在 ${root} 找到 .dx-runtime/versions/runtime-* 目录`)
  return path.join(picked, 'resources', 'app.asar.unpacked', 'server')
}

export function resolveEngineDir() {
  return process.env.DXOS_ENGINE || path.join(resolveServerDir(), 'protocol-engine')
}

export function resolveDataDir() {
  return process.env.DXOS_DATA || path.join(resolveDxosRoot(), 'data')
}

/* ---- 直接运行本文件时，打印当前机器的环境解析结果 ---- */
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('dxos-paths.mjs')) {
  const info = describeEnv()
  console.log('当前机器环境解析：')
  console.log(`  用户名     ${info.user}`)
  console.log(`  主目录     ${info.home}`)
  console.log(`  技能目录   ${info.skills}`)
  console.log(`  Node       ${info.node}`)
  try {
    console.log(`  DXOS 根目录 ${resolveDxosRoot()}`)
    console.log(`  引擎目录   ${resolveEngineDir()}`)
    console.log(`  数据目录   ${resolveDataDir()}`)
  } catch (e) {
    console.log(`  DXOS 相关  未解析：${e.message}`)
  }
}
