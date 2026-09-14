#!/usr/bin/env node
// ==========================================================
// DX OS Skills — 密钥扫描器（独立版，pre-commit 钩子共用同一套规则）
// ==========================================================
// 用法：
//   node scripts/scan-secrets.mjs              # 扫描本仓库全部已跟踪文件
//   node scripts/scan-secrets.mjs --staged     # 只扫描暂存区（钩子用）
//   node scripts/scan-secrets.mjs <路径...>     # 扫描指定文件/目录
//
// 退出码：0 = 干净；1 = 发现疑似密钥
// ==========================================================

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { execSync } from "node:child_process";

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip",
  ".mp3", ".mp4", ".woff", ".woff2", ".ttf", ".otf", ".exe", ".dll",
  ".so", ".dylib", ".bin", ".db", ".db-wal", ".db-shm",
]);

// ---------- 规则定义 ----------
const PLACEHOLDER = /YOUR_|<[^>]*>|\{\{|xxx|placeholder|example|sample|redacted|dummy|fake|test-key/i;

const RULES = [
  {
    name: "供应商密钥前缀",
    test: (l) => /\bsk-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{30,}|sk_live_[A-Za-z0-9]{16,}|sk_test_[A-Za-z0-9]{16,}|volc_[A-Za-z0-9]{16,}/.test(l),
  },
  {
    name: "Authorization/API-Key 赋值",
    test: (l) =>
      /(authorization|bearer|x-api-key|api[_-]?key)["']?\s*[:=]\s*["']?(bearer\s+)?[A-Za-z0-9_.-]{20,}/i.test(l),
  },
  {
    name: "JSON 密钥字段长字面量",
    test: (l) =>
      /"(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|access[_-]?key[_-]?secret|private[_-]?key|password|passwd|bearer)"\s*:\s*"[^"]{20,}"/i.test(l),
  },
  {
    name: "疑似高熵密钥串",
    test: (l) => /[A-Za-z0-9_-]{40,}/.test(l) && /(key|token|secret|auth|passwd|password|bearer|credential)/i.test(l),
  },
];

function scanText(text, file) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PLACEHOLDER.test(line)) continue;
    for (const rule of RULES) {
      if (rule.test(line)) {
        hits.push({ file, line: i + 1, rule: rule.name, snippet: line.trim().slice(0, 120) });
        break;
      }
    }
  }
  return hits;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// ---------- 收集待扫描文件 ----------
const args = process.argv.slice(2);
let files = [];
const cwd = process.cwd();

if (args.includes("--staged")) {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" });
  files = out.split(/\r?\n/).filter(Boolean).map((f) => join(cwd, f));
} else if (args.filter((a) => !a.startsWith("--")).length > 0) {
  for (const a of args.filter((x) => !x.startsWith("--"))) {
    const p = join(cwd, a);
    if (!existsSync(p)) continue;
    files.push(...(statSync(p).isDirectory() ? walk(p) : [p]));
  }
} else {
  // 全部已跟踪文件
  const out = execSync("git ls-files", { encoding: "utf8" });
  files = out.split(/\r?\n/).filter(Boolean).map((f) => join(cwd, f));
}

// ---------- 扫描 ----------
let all = [];
for (const f of files) {
  if (!existsSync(f)) continue;
  if (BINARY_EXT.has(extname(f).toLowerCase())) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  // 含 NUL 视为二进制
  if (text.includes("\0")) continue;
  all.push(...scanText(text, relative(cwd, f).replace(/\\/g, "/")));
}

if (all.length > 0) {
  console.error("");
  console.error("==========================================");
  console.error(" 检测到疑似 API Key / 密钥");
  console.error("==========================================");
  for (const h of all) {
    console.error(`  [${h.rule}] ${h.file}:${h.line}`);
    console.error(`      ${h.snippet}`);
  }
  console.error("");
  console.error(" 处理建议：");
  console.error('   1) 换成占位符，例如  "apiKey": "YOUR_API_KEY"');
  console.error("   2) 把文件移出仓库 / 加入 .gitignore");
  console.error("   3) 若这个密钥已被提交过，必须去服务商后台吊销并重新签发");
  console.error("");
  process.exit(1);
}

console.log(`密钥扫描通过：已检查 ${files.length} 个文件，未发现疑似密钥。`);
process.exit(0);
