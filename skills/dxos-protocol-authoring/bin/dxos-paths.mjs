/**
 * DX OS 安装位置解析（四个校验脚本共用）
 *
 * 之前每个脚本都硬编码了 `D:/Apps/DXOS-Portable-0.2.0-win-x64/...`，
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
import path from 'node:path'

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
