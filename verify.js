#!/usr/bin/env node
// feature-test 本地自检:CI 质量门打包成一条命令(mock 基线/边界自测/玩具重放/敏感词双扫描)
// 背景:ci.yml 是 GitHub Actions 格式而仓在 gitee,云上不会跑——判定权收到本地,
// pre-push 钩子(githooks/)调用本脚本,不绿不放行。敏感词表单一来源=ci.yml,本脚本只提取不复制,
// 改词表只改 ci.yml 一处,本地与云不漂移。
// 退出码:0=四道全绿(可提交/push),1=有关卡未过,2=环境错误(node/git 异常)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const die = (msg) => { console.error(msg); process.exit(2); };
const log = (s) => console.log(s);

// ---------- 词表提取(单一来源:ci.yml) ----------
const CI_YML = path.join(ROOT, '.github', 'workflows', 'ci.yml');
if (!fs.existsSync(CI_YML)) die('缺 .github/workflows/ci.yml——敏感词表唯一来源在这,没了没法扫');
const ci = fs.readFileSync(CI_YML, 'utf8');
const workPat = (ci.match(/WORK_PAT='([^']+)'/) || [])[1];
const histPat = (ci.match(/HIST_PAT='([^']+)'/) || [])[1];
if (!workPat || !histPat) die('ci.yml 里没解析到 WORK_PAT/HIST_PAT——词表行格式被改过,先核对再跑');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function probe(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (_) { /* 未就绪,继续等 */ }
    await sleep(300);
  }
  return false;
}
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { /* 已退 */ }
  }
}

// ---------- 关1/关2:起服务 → 重放 → 判基线(判据与 ci.yml 逐字一致) ----------
async function replayGate(serverFile, probeUrl, port, args, expectSum, expectExit) {
  // 端口预检:已被占=有残留服务,拿它重放会误判,先清再自检
  try { await fetch(probeUrl); return { ok: false, msg: `端口 ${port} 已有服务在跑——先关掉残留进程(node ${serverFile})再自检` }; } catch (_) { /* 正常:没人占 */ }
  const srv = spawn('node', [serverFile], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    detached: process.platform !== 'win32', // linux/mac 起进程组,kill(-pid) 能带走子进程
  });
  try {
    if (!(await probe(probeUrl, 15000))) return { ok: false, msg: `${serverFile} 起不来(${probeUrl} 15 秒内未就绪)——看 node/端口后重试` };
    const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    if (r.error) return { ok: false, msg: `重放执行失败: ${r.error.message}` };
    const out = (r.stdout || '') + (r.stderr || '');
    const rc = r.status === null ? 99 : r.status; // 被信号杀掉也当失败
    const okSum = out.includes(expectSum);
    const okRc = rc === expectExit;
    if (okSum && okRc) return { ok: true, msg: `${expectSum},exit=${rc}` };
    const tail = out.trim().split(/\r?\n/).slice(-8).join('\n');
    return { ok: false, msg: `不符基线(${okSum ? '汇总符合' : `汇总缺「${expectSum}」`},exit=${rc} 期望 ${expectExit})\n---- 输出尾 8 行 ----\n${tail}` };
  } finally { killTree(srv); }
}

// ---------- 关3:敏感词双扫描(工作区 + git 全历史) ----------
function scanGate() {
  // 工作区:tracked + 未忽略的 untracked,排除词表文件自身;二进制跳过(词表是源码文本口径,
  // 第三方 jar 不做文本判定——与 CI 上 git grep 对 binary 的处理差异,如实登记在本注释)
  const ls = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  if (ls.status !== 0) die('git ls-files 失败: ' + (ls.stderr || ''));
  const re = new RegExp(workPat);
  const hits = [];
  for (const f of ls.stdout.split(/\r?\n/).filter(Boolean)) {
    if (f === '.github/workflows/ci.yml') continue; // 词表字面量在本文件,不是泄露
    const p = path.join(ROOT, f);
    let st; try { st = fs.statSync(p); } catch (_) { continue; }
    if (!st.isFile()) continue;
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) continue; // 二进制(jar 等)
    if (re.test(buf.toString('utf8'))) hits.push(f);
  }
  if (hits.length) return { ok: false, msg: `工作区命中: ${hits.join(', ')}` };

  // git 全历史(含未推送提交;--I 跳二进制,退出码 0=命中 1=干净)
  const revs = spawnSync('git', ['rev-list', '--all'], { cwd: ROOT, encoding: 'utf8' });
  if (revs.status !== 0) die('git rev-list 失败: ' + (revs.stderr || ''));
  const list = revs.stdout.trim().split(/\r?\n/).filter(Boolean);
  const g = spawnSync('git', ['grep', '-I', '-nE', histPat, ...list, '--', '.', ':(exclude).github/workflows/ci.yml'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (g.status === 0) return { ok: false, msg: `git 历史命中(前 10 条):\n${(g.stdout || g.stderr).split(/\r?\n/).slice(0, 10).join('\n')}` };
  if (g.status !== 1) return { ok: false, msg: `git grep 异常(exit=${g.status}): ${g.stderr}` };
  return { ok: true, msg: `工作区零命中 + git 全历史 ${list.length} 个提交零命中` };
}

(async () => {
  log(`feature-test 本地自检(四道检查,判据与 CI 同源:词表提取自 ci.yml)\n`);
  const gates = [];
  gates.push(['关1 mock 自测   ', await replayGate('test/mock-server.js', 'http://127.0.0.1:18901/ok', 18901,
    ['run-cases.js', 'test/mock.cases.json', '--token', 'test-token-abc', '--allow-write'], '7 PASS / 4 FAIL / 0 ERR', 1)]);
  // 关1b 边界自测(并入 mock 环节):预检零请求/零断言/filter 隔离/history 真实 env/无产物/脱敏/写门禁/零请求模式/env头字面量脱敏/key族头名脱敏;独立端口,起停自理
  {
    const r = spawnSync('node', ['test/boundary-test.js'], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    const out = r.error ? String(r.error.message) : (r.stdout || '') + (r.stderr || '');
    const rc = r.status === null ? 99 : r.status;
    gates.push(['关1b 边界自测   ', rc === 0 && out.includes('边界自测 10/10 全过')
      ? { ok: true, msg: '10/10 全过,exit=0' }
      : { ok: false, msg: `exit=${rc}\n---- 输出尾 8 行 ----\n${out.trim().split(/\r?\n/).slice(-8).join('\n')}` }]);
  }
  gates.push(['关2 玩具重放    ', await replayGate('examples/toy-library/server.js', 'http://127.0.0.1:9399/api/books', 9399,
    ['run-cases.js', 'examples/toy-library/cases/toy-library.json', '--allow-write'], '15 PASS / 0 FAIL / 0 ERR', 0)]);
  gates.push(['关3 敏感词双扫描', scanGate()]);
  let allOk = true;
  for (const [name, r] of gates) { log(`${r.ok ? '✓' : '✗'} ${name}: ${r.msg}`); if (!r.ok) allOk = false; }
  log(allOk ? '\n四道全绿:可提交/push' : '\n有关卡未过:按上方明细处理后重跑(修复前别 push)');
  process.exit(allOk ? 0 : 1);
})();
