#!/usr/bin/env node
// 边界自测:预检零请求/零断言拦截/--filter 隔离/history 真实 env/预检无产物/token 脱敏/写门禁/零请求模式/env头字面量脱敏
// 不依赖任何真实服务:自起 mock(独立端口,MOCK_PORT 覆盖)+ 临时用例件(finally 删)。
// 判据输出:末行「边界自测 9/9 全过」+ 退出码 0——verify.js 关1b 与 ci.yml mock job 以此为准
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'run-cases.js');
const PORT = Number(process.env.BOUNDARY_PORT) || 18902; // 与基线 mock(18901)分开,接着跑不撞端口
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function killTree(child) { // Windows 下 child.kill 常杀不干净(实测残留),taskkill /T 兜底
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { /* 已退 */ } }
}
async function count() {
  const r = await fetch(`${BASE}/count`);
  const j = await r.json();
  return j.data.count;
}
function runRunner(args) {
  const r = spawnSync(process.execPath, [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  return { rc: r.status === null ? 99 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}

(async () => {
  // 端口预检:已被占=有残留服务,拿它计数会误判,先清再测
  try { await count(); console.error(`端口 ${PORT} 已有服务(残留 mock?),先清理再跑`); process.exit(2); } catch (_) { /* 正常:没人占 */ }
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-server.js')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, MOCK_PORT: String(PORT) },
    detached: process.platform !== 'win32', // linux/mac 起进程组,kill(-pid) 能带走子进程
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-boundary-'));
  const results = [];
  const check = (name, ok, why) => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' — ' + why}`); };
  try {
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) { try { await count(); ready = true; } catch (_) { await sleep(300); } }
    if (!ready) { console.error('mock 15 秒未就绪'); process.exitCode = 2; return; } // exitCode+return 落到 finally 清理;process.exit 会跳过 finally

    const W = (name, obj) => { const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); return p; };
    const OK = (id, env) => ({ id, name: id, ...(env ? { env } : {}), request: { method: 'GET', path: '/ok' }, expect: { code: 200 } });
    const envs = { b1: { baseURL: BASE }, b2: { baseURL: BASE } };

    // S1 构造错误类(env 引用不存在/bodyFile 不存在)→ 预检整体退 2 且 mock 收到的请求数不变
    {
      const f = W('s1.json', { envs, defaultEnv: 'b1', cases: [
        OK('B1'),
        { id: 'B2', env: 'nope', request: { method: 'GET', path: '/ok' }, expect: { code: 200 } },
        { id: 'B3', request: { method: 'POST', path: '/echo', bodyFile: 'no-such-file.json' }, expect: { code: 200 } },
      ] });
      const before = await count();
      const r = runRunner([f]);
      const after = await count();
      check('S1 预检退2+零请求', r.rc === 2 && after === before && r.out.includes('构造预检未过') && r.out.includes('bodyFile 不存在'),
        `rc=${r.rc} 请求数 ${before}→${after}`);
    }
    // S2 零断言类(expect:{} / 只有拼错的未知 key / json:{}) → 预检退 2,零请求
    {
      const f = W('s2.json', { envs, defaultEnv: 'b1', cases: [
        { id: 'Z1', request: { method: 'GET', path: '/ok' }, expect: {} },
        { id: 'Z2', request: { method: 'GET', path: '/ok' }, expect: { codde: 200 } }, // 断言 key 拼错=未知字段,同样算零断言
        { id: 'Z3', request: { method: 'GET', path: '/ok' }, expect: { json: {} } },
      ] });
      const before = await count();
      const r = runRunner([f]);
      const after = await count();
      check('S2 零断言退2+零请求', r.rc === 2 && after === before && r.out.includes('零断言'),
        `rc=${r.rc} 请求数 ${before}→${after}`);
    }
    // S3 --filter 选中合法用例,不被未选中的构造错误用例阻断(G2 缺 path)
    {
      const f = W('s3.json', { envs, defaultEnv: 'b1', cases: [OK('G1'), { id: 'G2', request: {}, expect: { code: 200 } }] });
      const before = await count();
      const r = runRunner([f, '--filter', 'G1']);
      const after = await count();
      check('S3 filter隔离', r.rc === 0 && after - before === 1 && r.out.includes('1 PASS'),
        `rc=${r.rc} 请求数 ${before}→${after}`);
    }
    // S4 混合 env:history 逐行=各自真实 env,终端汇总与 --out 均仍是合集
    {
      const histDir = path.join(tmp, 'hist'); fs.mkdirSync(histDir);
      const out = path.join(tmp, 's4-out.md');
      const f = W('s4.json', { envs, defaultEnv: 'b1', cases: [OK('H1'), OK('H2', 'b2'), OK('H3')] });
      const r = runRunner([f, '--history', histDir, '--out', out]);
      const rows = fs.readFileSync(path.join(histDir, 's4.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      const envById = Object.fromEntries(rows.map(l => [l.id, l.env]));
      const union = r.out.includes('env=b1+b2');
      const outUnion = fs.readFileSync(out, 'utf8').includes('b1+b2');
      check('S4 history真实env', r.rc === 0 && envById.H1 === 'b1' && envById.H2 === 'b2' && envById.H3 === 'b1' && union && outUnion,
        `rc=${r.rc} env=${JSON.stringify(envById)} 终端合集=${union} out合集=${outUnion}`);
    }
    // S5 预检失败:--out/--history 都不产生文件
    {
      const out = path.join(tmp, 's5-out.md');
      const histDir = path.join(tmp, 's5hist'); fs.mkdirSync(histDir);
      const f = W('s5.json', { envs, defaultEnv: 'b1', cases: [{ id: 'X1', env: 'nope', request: { method: 'GET', path: '/ok' }, expect: { code: 200 } }] });
      const r = runRunner([f, '--out', out, '--history', histDir]);
      const noOut = !fs.existsSync(out);
      const noHist = !fs.existsSync(path.join(histDir, 's5.jsonl'));
      check('S5 预检失败无产物', r.rc === 2 && noOut && noHist,
        `rc=${r.rc} out未建=${noOut} hist未建=${noHist}`);
    }
    // S6 token 脱敏不回归:FAIL 明细带 token 回显,落盘件只见 {{TOKEN}}
    {
      const histDir = path.join(tmp, 'hist6'); fs.mkdirSync(histDir);
      const out = path.join(tmp, 's6-out.md');
      const f = W('s6.json', { envs, defaultEnv: 'b1', cases: [{ id: 'T1', request: { method: 'GET', path: '/whoami' }, expect: { code: 500 } }] });
      const r = runRunner([f, '--token', 'secret-x-99', '--out', out, '--history', histDir]);
      const outTxt = fs.readFileSync(out, 'utf8');
      const histTxt = fs.readFileSync(path.join(histDir, 's6.jsonl'), 'utf8');
      const leak = outTxt.includes('secret-x-99') || histTxt.includes('secret-x-99');
      check('S6 token脱敏', r.rc === 1 && !leak && outTxt.includes('{{TOKEN}}'),
        `rc=${r.rc} 泄露=${leak}`);
    }

    // S7 写门禁:选中集含 POST 未给 --allow-write → 零请求退 2;给了才执行
    {
      const f = W('s7.json', { envs, defaultEnv: 'b1', cases: [
        OK('W1'),
        { id: 'W2', name: '写用例', request: { method: 'POST', path: '/echo', body: { a: 1 } }, expect: { code: 200 } },
      ] });
      const before = await count();
      const blocked = runRunner([f]);
      const mid = await count();
      const allowed = runRunner([f, '--allow-write']);
      const after = await count();
      check('S7 写门禁', blocked.rc === 2 && mid === before
        && blocked.out.includes('--allow-write') && blocked.out.includes('W2')
        && allowed.rc === 0 && after - mid === 2,
        `未授权 rc=${blocked.rc} 请求数 ${before}→${mid};授权 rc=${allowed.rc} 请求数 ${mid}→${after}`);
    }
    // S8 零请求模式:--dry-run 打印 method+URL 清单、--check-only 只报预检结论,两者都不发请求
    {
      const f = W('s8.json', { envs, defaultEnv: 'b1', cases: [
        OK('D1'),
        { id: 'D2', request: { method: 'POST', path: '/echo', body: { a: 1 } }, expect: { code: 200 } },
      ] });
      const before = await count();
      const dry = runRunner([f, '--dry-run']);
      const chk = runRunner([f, '--check-only']);
      const after = await count();
      check('S8 零请求模式', dry.rc === 0 && chk.rc === 0 && after === before
        && dry.out.includes('GET') && dry.out.includes('/ok') && dry.out.includes('POST') && dry.out.includes('--allow-write')
        && chk.out.includes('构造预检通过 2 条'),
        `dry rc=${dry.rc} check rc=${chk.rc} 请求数 ${before}→${after}`);
    }
    // S9 env 头字面量脱敏:env.headers 写死 Authorization 字面量,服务端回显后终端/报告/history 均零明文
    {
      const histDir = path.join(tmp, 'hist9'); fs.mkdirSync(histDir);
      const out = path.join(tmp, 's9-out.md');
      const SECRET = 'Bearer env-literal-secret-99';
      const f = W('s9.json', {
        envs: { b1: { baseURL: BASE, headers: { Authorization: SECRET } } }, defaultEnv: 'b1',
        cases: [{ id: 'H1', name: 'env头字面量', request: { method: 'GET', path: '/whoami' }, expect: { code: 500 } }],
      });
      const r = runRunner([f, '--out', out, '--history', histDir]);
      const outTxt = fs.readFileSync(out, 'utf8');
      const histTxt = fs.readFileSync(path.join(histDir, 's9.jsonl'), 'utf8');
      const leak = r.out.includes(SECRET) || outTxt.includes(SECRET) || histTxt.includes(SECRET);
      check('S9 env头字面量脱敏', r.rc === 1 && !leak && outTxt.includes('{{TOKEN}}'),
        `rc=${r.rc} 泄露=${leak}`);
    }

    const pass = results.filter(Boolean).length;
    console.log(`\n边界自测 ${pass}/${results.length}${pass === results.length ? ' 全过' : ' 有未过项'}`);
    process.exitCode = pass === results.length ? 0 : 1; // 用 exitCode 不用 exit:让 finally 的 killTree/临时目录删除照常执行
  } finally {
    killTree(mock);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 尽力清理 */ }
  }
})();
