#!/usr/bin/env node
// feature-test 用例重放 runner:读 cases.json,逐条发请求,机器判定断言,输出 PASS/FAIL 表
// 设计来源(全为实战坑):
//   - GET query 由本脚本做 UTF-8 编码(手工拼 URL / shell 变量 GBK 三坑由构造消灭)
//   - body 支持 UTF-8 文件(等价 curl --data-binary @file,自动带 application/json 头,自动剥 BOM)
//   - 断言机器判定(http 码 / 业务 code / msg 包含 / JSON 路径表达式),不再肉眼
//   - env 抽象:本地/网关切换只换 --env,不逐条改 URL;用例级 env 覆盖 defaultEnv
//   - 错误归因不污名:超时/连不上/用法错/断言写错各给专属提示,不把脚本错误说成"服务没起"
//   - 连不上/401/超时/占位符未解析/重定向 → 给下一步动作提示,不静默降级
//   - token 不落盘:报告与失败明细里的 token 回显统一替换为 {{TOKEN}}
//   - 写方法门禁:选中集含 POST/PUT/DELETE/PATCH 必须显式 --allow-write(写接口按轮确认落到执行器,不靠 id 命名约定)
//   - 零请求模式:--dry-run 打印选中清单(method+URL),--check-only 只报预检结论;两者都不发请求、不写产物
// 用法: node run-cases.js <cases.json> [--env 名称] [--filter TC01] [--token xxx] [--out 报告.md] [--history 目录] [--timeout 10000] [--allow-write] [--dry-run] [--check-only]
// 退出码: 0=全部通过(--dry-run/--check-only 预检通过即 0), 1=有 FAIL/ERR, 2=用法/文件错误(含构造预检:选中用例在首请求前离线全检,任一失败零请求退 2;含写方法用例未给 --allow-write)
'use strict';
const fs = require('fs');
const path = require('path');

const USAGE = '用法: node run-cases.js <cases.json> [--env 名称] [--filter TC01] [--token xxx] [--out 报告.md] [--history 目录] [--timeout 10000] [--allow-write] [--dry-run] [--check-only]';
function usageExit(msg) { console.error(msg + '\n' + USAGE); process.exit(2); }
// 可收集的用法错误:构造期校验抛它,预检整批收集逐条列出;执行期再抛=兜底,同样退 2
function usageErr(msg) { const e = new Error(msg); e.usage = true; return e; }

// ---------- CLI ----------
const args = process.argv.slice(2);
// 裸 flag 缺值要拦下:--filter 缺值=静默全量跑,--token 缺值=裸跑一片 401,都是静默错测
function argOf(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) usageExit(`${name} 缺少值(裸 flag 会静默退回默认)`);
  return v;
}

const casesPath = args[0];
if (!casesPath || casesPath.startsWith('--')) usageExit('缺少 cases.json 路径');
if (!fs.existsSync(casesPath)) { console.error(`用例文件不存在: ${casesPath}`); process.exit(2); }
// UTF-8 BOM(记事本/PowerShell Out-File 产物)会让 JSON.parse 报莫名其妙的 Unexpected token,读入即剥
function readText(p) { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); }
let spec;
try { spec = JSON.parse(readText(casesPath)); }
catch (e) { console.error(`cases.json 解析失败(检查 JSON 语法/是否存成 UTF-8 带 BOM/是否残留注释): ${e.message}`); process.exit(2); }
if (!Array.isArray(spec.cases) || spec.cases.length === 0) {
  console.error('cases.json 缺少非空 cases 数组'); process.exit(2);
}
// id 必填且唯一:缺失/重复会让失败明细附上另一条用例的请求,排查对不上
{
  const seen = new Set();
  for (const c of spec.cases) {
    if (!c.id) usageExit(`用例缺 id(name=${c.name || '?'})——失败明细无法定位请求`);
    if (seen.has(c.id)) usageExit(`用例 id 重复: ${c.id}——失败明细会附错用例的请求,先改 cases.json`);
    seen.add(c.id);
  }
}
// 用例级 env 覆盖 defaultEnv(文档承诺);envs 全量先校验,别让第 N 条用例跑到一半才炸
function envOf(c) {
  const name = c.env || cliEnv || spec.defaultEnv || Object.keys(spec.envs || {})[0];
  const e = (spec.envs || {})[name];
  if (!e) throw usageErr(`用例 ${c.id || '(启动校验)'} 的 env "${name}" 不存在。可用: ${Object.keys(spec.envs || {}).join(', ') || '(无)'}`);
  if (!e.baseURL) throw usageErr(`env "${name}" 缺 baseURL`);
  return [name, e];
}
// pathPrefix 唯一校验口:以 / 开头、不含 .. ? #(防 URL 归一化吞前缀/query/hash 逃逸);尾斜杠剥掉
function prefixOf(name, e) {
  const pp = e.pathPrefix || '';
  if (typeof pp !== 'string' || (pp !== '' && !pp.startsWith('/')) || /[?#]|\.\./.test(pp)) {
    throw usageErr(`env "${name}" 的 pathPrefix 非法: ${JSON.stringify(pp)}——以 / 开头(如 "/station"),不含 .. ? #,或删掉该字段`);
  }
  return pp.replace(/\/+$/, '');
}
// --env=CLI 级覆盖 defaultEnv(用例级 env 仍最优先);值不在 envs 里=用法错误退 2,绝不静默丢(R1)
const cliEnv = argOf('--env');
if (cliEnv !== undefined && !(spec.envs || {})[cliEnv]) {
  usageExit(`--env "${cliEnv}" 不在 envs 里。可用: ${Object.keys(spec.envs || {}).join(', ') || '(无)'}`);
}
for (const [name, e] of Object.entries(spec.envs || {})) {
  if (!e || !e.baseURL) usageExit(`env "${name}" 缺 baseURL`);
  if (!/^https?:\/\//.test(e.baseURL)) usageExit(`env "${name}" 的 baseURL 缺 http(s):// 前缀: ${e.baseURL}——不校验会静默拼出错地址`);
  try { prefixOf(name, e); } catch (err) { usageExit(err.message); } // pathPrefix 同样全量先校验,别让第 N 条用例跑到一半才炸(R2/R5)
}

// CLI 参数合法性前置校验(用法错误退 2,不降级成每条 ERR 伪装成"服务没起")
const filter = argOf('--filter');
if (filter) { try { new RegExp(filter); } catch (e) { usageExit(`--filter 非法正则: ${e.message}`); } }
const token = argOf('--token') || process.env.FT_TOKEN || '';
const timeoutRaw = argOf('--timeout');
const timeoutMs = timeoutRaw !== undefined ? Number(timeoutRaw) : 10000; // 默认 10s:本地接口毫秒级,网关+业务慢查询给足余量
if (timeoutRaw !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
  usageExit(`--timeout 需为正整数毫秒,收到 "${timeoutRaw}"(非法值会被 AbortSignal 拒收)`);
}
const outPath = argOf('--out');
// --history:每次跑完把逐用例结果追加成 JSONL(时间/结果/耗时/env/git),数据驱动回归选样的地基
// 目录不自动建:与 --out 同口径,路径写错要在开跑前退 2,不是跑完一半才发现没记上
const historyDir = argOf('--history');
if (historyDir !== undefined && !fs.existsSync(historyDir)) {
  usageExit(`--history 目录不存在: ${historyDir}(先 mkdir,与 --out 同口径)`);
}

// 裸 flag(不带值)
const allowWrite = args.includes('--allow-write');
const dryRun = args.includes('--dry-run');
const checkOnly = args.includes('--check-only');

// 未知参数一律退 2:手滑 --dryrun 若被静默忽略,就会把"以为的预演"变成真发请求;
// 手滑 --allow-writ 若被静默忽略,写门禁的拦截信息也指不到真正原因
{
  const VALUE_FLAGS = new Set(['--env', '--filter', '--token', '--out', '--history', '--timeout']);
  const BARE_FLAGS = new Set(['--allow-write', '--dry-run', '--check-only']);
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (BARE_FLAGS.has(a)) continue;
    if (VALUE_FLAGS.has(a)) { i++; continue; } // 值已由 argOf 校验(缺值/值以 -- 开头都已退 2)
    usageExit(a.startsWith('--')
      ? `未知参数: ${a}(可用: ${[...VALUE_FLAGS, ...BARE_FLAGS].join(' ')})`
      : `多余的参数: ${a}(只接受一个 cases.json 路径)`);
  }
}

// token 不落盘:响应回显 token(如 /whoami 形态)统一替换为 {{TOKEN}},报告才能直接粘
// 脱敏名单=CLI/FT_TOKEN + 各 env 显式写的 token 字面值(envs.*.token 不带 --token 跑时,回显的是 env
// 那个 token,只认 CLI 一个会漏脱);占位符形态 "{{TOKEN}}" 替换成 "{{TOKEN}}" 恒等,无副作用
// 另收 env/用例级显式写死的鉴权头值(F8):Authorization 等头里的字面量 token 被服务端回显时,
// 只认上面那个变量会漏脱。只收"名字像秘密"的头,且值长度 >=8——否则 "GET"/"application/json"
// 这类短值会被全局替换,报告读不成样。key 族(api-key/private-key/x-auth-key/access-key 等)
// 按子串收(P3-1:此前只精确列 x-api-key,同族其余写法全漏),宁可多脱不错漏
const SECRET_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|passw|key/i;
function secretHeaderValues(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!SECRET_HEADER_RE.test(k) || typeof v !== 'string') continue;
    for (const s of [v, resolveTpl(v)]) { // 原样 + 占位符展开后的值都脱(env 常写 "Bearer {{TOKEN}}")
      if (typeof s === 'string' && s.length >= 8 && !s.includes('{{')) out.push(s);
    }
  }
  return out;
}
// 按长度降序:短 token 是长 token 前缀时会先吃前缀留明文尾(CLI=abc+env=abcdef 实测漏出 "def")
const redactTokens = [...new Set([token,
  ...Object.values(spec.envs || {}).map(e => e && typeof e.token === 'string' ? e.token : null),
  ...Object.values(spec.envs || {}).flatMap(e => secretHeaderValues(e && e.headers)),
  ...spec.cases.flatMap(c => secretHeaderValues(c && c.request && c.request.headers)),
].filter(Boolean))].sort((a, b) => b.length - a.length);
function redact(s) {
  if (typeof s !== 'string' || redactTokens.length === 0) return s;
  return redactTokens.reduce((out, t) => out.split(t).join('{{TOKEN}}'), s);
}

// 占位符替换:递归处理对象/数组,任何字符串值中的 {{TOKEN}} 用命令行/环境变量 token 填
function resolveTpl(v) {
  if (typeof v === 'string') return v.replace(/\{\{TOKEN\}\}/g, token);
  if (Array.isArray(v)) return v.map(resolveTpl);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = resolveTpl(x);
    return out;
  }
  return v;
}
function assertResolved(v, where) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s && s.includes('{{')) {
    throw usageErr(`${where} 存在未解析占位符(只支持 {{TOKEN}},用 --token 或 FT_TOKEN 提供): ${redact(String(s))}`);
  }
}

// ---------- 断言 ----------
function resolvePath(obj, p) {
  // "data.rows[0].ruleName" → 值;路径中断返回 undefined(由调用方判 FAIL)
  // hasOwnProperty 守卫:不许穿原型链(data.constructor 取到函数),只认自身属性
  if (typeof p !== 'string' || p === '') return undefined;
  const tokens = p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const t of tokens) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, t)) return undefined;
    cur = cur[t];
  }
  return cur;
}
function normScalar(s) {
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
}
// 表达式: =v  !=v  >n  <n  >=n  <=n  contains:s
function evalExpr(actual, expr) {
  const fail = (why) => ({ ok: false, why, actual: stringify(actual) });
  if (actual === undefined) return fail('路径不存在(值为 undefined)'); // 文档承诺:路径不存在=FAIL,含 != 负向断言
  if (expr.startsWith('contains:')) {
    const sub = expr.slice('contains:'.length);
    return actual != null && String(actual).includes(sub)
      ? { ok: true } : fail(`期望包含 "${sub}",实际 ${stringify(actual)}`);
  }
  const m = expr.match(/^(>=|<=|!=|>|<|=)(.*)$/);
  if (!m) return fail(`断言表达式无法解析: ${expr}`);
  const [, op, valRaw] = m;
  const expected = normScalar(valRaw.trim());
  // 字符串↔数字宽松是文档本意;数组/对象不许跨类型伪等值([1] 判 "=1" 一律不等)
  // 布尔例外:true/false 是布尔断言的唯一写法且无歧义(AjaxResult.data 常见布尔),放行字面量匹配
  const looseEq = (a, b) => {
    if ((typeof a === 'string' || typeof a === 'number') && (typeof b === 'string' || typeof b === 'number'))
      return String(a) === String(b);
    if (typeof a === 'boolean' && typeof b === 'string' && (b === 'true' || b === 'false'))
      return a === (b === 'true');
    return false;
  };
  switch (op) {
    case '=': {
      const ok = JSON.stringify(actual) === JSON.stringify(expected) || looseEq(actual, expected);
      return ok ? { ok: true } : fail(`期望 =${valRaw.trim()},实际 ${stringify(actual)}`);
    }
    case '!=':
      return !(JSON.stringify(actual) === JSON.stringify(expected) || looseEq(actual, expected))
        ? { ok: true } : fail(`期望 !=${valRaw.trim()},实际 ${stringify(actual)}`);
    case '>': case '<': case '>=': case '<=': {
      const a = Number(actual);
      const b = Number(expected);
      if (actual == null || Number.isNaN(a) || valRaw.trim() === '' || Number.isNaN(b)) {
        // 右侧写错(如 >abc)是断言表达式问题,不是服务的问题——归因要指对
        return fail(`断言表达式错误: ${expr} 两侧需为数值(路径实际值=${stringify(actual)})——检查 cases.json 用例写法`);
      }
      const ok = op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;
      return ok ? { ok: true } : fail(`期望 ${op}${valRaw.trim()},实际 ${a}`);
    }
  }
  return fail(`未知操作符: ${op}`);
}
function stringify(v) {
  if (v === undefined) return '(路径不存在)';
  if (v === null) return 'null';
  const full = redact(typeof v === 'string' ? v : JSON.stringify(v));
  return full.length > 120 ? full.slice(0, 117) + '...' : full;
}

// ---------- 请求 ----------
// 错误归因:超时/连不上/其他各给专属提示——不把脚本或用例错误污名为"服务没起"(误报纪律)
function classifyFetchError(e, url) {
  if (e.name === 'TimeoutError') return `超时 ${timeoutMs}ms——先探活(netstat 查端口),网关场景查网络(原始错误: ${e.message})`;
  // bad port 黑名单(127.0.0.1:1/7/21 等):undici 客户端侧直接拒发,TCP 都不发起,cause.code 为空——
  // 不单独归类就会落到下面的通用分支,把"端口选得不对"说成"用例写法有问题",指错方向
  if (e.cause && /bad port/i.test(String(e.cause.message || ''))) {
    return `端口被 fetch 拒绝(bad port 黑名单,客户端未发起连接,不是服务/网络问题)——env.baseURL 换普通端口再试,探测用未监听端口如 59999(原始错误: ${e.message})`;
  }
  const code = e.cause ? (e.cause.code || e.cause.name) : '';
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_FAILED'].includes(code)) {
    return `连不上 ${url.origin}——服务没起?本地先探活;网关场景确认端口/前缀(原始错误: ${e.message})`;
  }
  return `请求执行失败(原始错误: ${e.message})——先查用例写法(method/body/header 是否合法),不是连通性问题`;
}
// 构造请求(纯离线,不发):预检与执行共用同一条构造路径,单一事实源——
// 用法错误(env 引用/path/GET body/query 对象/bodyFile 不存在/占位符)在这里抛 usageErr,
// 预检期整批暴露零请求退 2;执行期再抛只剩兜底意义
function buildRequest(c) {
  const req = c.request || {};
  const [envName, envCase] = envOf(c); // 用例级 env 覆盖 defaultEnv,防悄悄打错环境
  const base = envCase.baseURL.replace(/\/+$/, ''); // 多个尾斜杠全剥://+path 会拼成 //path 静默 404(R6)
  // env 级路由前缀(网关场景:baseURL=网关,pathPrefix=模块路由如 /station);用例 path 保持服务本位写法,切环境不改用例
  const prefix = prefixOf(envName, envCase); // 与启动校验同一规则,双保险
  const method = (req.method || 'GET').toUpperCase();
  // 输入校验:打错地址/方法要在发请求前拦下,不是发出去再说
  if (typeof req.path !== 'string' || req.path === '') throw usageErr(`用例 ${c.id} 的 request.path 缺失(如 "/hyperthermia-setting/list")`);
  if (!req.path.startsWith('/')) throw usageErr(`用例 ${c.id} 的 request.path 不以 / 开头: "${req.path}"——baseURL 已去尾斜杠,缺 / 会拼成错地址`);
  if ((method === 'GET' || method === 'HEAD') && (req.bodyFile !== undefined || req.body !== undefined)) {
    throw usageErr(`用例 ${c.id} 是 ${method} 却带了 body——GET/HEAD 不允许请求体,undici 会直接拒发`);
  }
  const url = new URL(base + prefix + req.path);
  for (const [k, v] of Object.entries(resolveTpl(req.query) || {})) {
    if (v !== null && typeof v === 'object') throw usageErr(`用例 ${c.id} 的 query.${k} 是对象/数组——query 值需为标量,嵌套会被拼成 "[object Object]" 发脏请求`);
    assertResolved(v, `query ${k}`);
    url.searchParams.append(k, String(v)); // UTF-8 编码由 URL 完成,中文安全
  }
  const headers = Object.assign({}, resolveTpl(envCase.headers) || {}, resolveTpl(req.headers) || {});
  let body;
  if (req.bodyFile) {
    const p = path.isAbsolute(req.bodyFile) ? req.bodyFile : path.join(path.dirname(casesPath), req.bodyFile);
    if (!fs.existsSync(p)) throw usageErr(`用例 ${c.id} 的 bodyFile 不存在: ${p}`);
    body = readText(p); // UTF-8 文件直读(剥 BOM),绕开 shell 编码
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  } else if (req.body !== undefined) {
    body = JSON.stringify(resolveTpl(req.body));
    assertResolved(body, 'body'); // bodyFile 内容是业务数据不查,内联 body 是模板要查
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  // 用例已显式声明的同名头不覆写(鉴权负例/过期 token 例要保真),只补缺
  const authKey = Object.keys(headers).find(k => k.toLowerCase() === (envCase.tokenHeader || 'Authorization').toLowerCase());
  if (!authKey && (envCase.token !== undefined || token)) {
    headers[envCase.tokenHeader || 'Authorization'] = token || resolveTpl(envCase.token);
  }
  for (const [k, v] of Object.entries(headers)) assertResolved(v, `header ${k}`);
  return { url, method, headers, body, envName };
}

// 零断言拦截:expect 缺失/空对象/没有任何已知断言字段=http 200 即 PASS 的假绿,预检退 2。
// 只拦"零断言",不强制 http+code——单写 code/msg/json 的合法用例不动(mock 基线 TC02/TC05/TC06 就是)
function assertExpect(c) {
  const ex = c.expect;
  const has = ex && typeof ex === 'object' && (
    (ex.http !== undefined && ex.http !== null) ||
    (ex.code !== undefined && ex.code !== null) ||
    (ex.msgContains !== undefined && ex.msgContains !== null) ||
    (ex.json && typeof ex.json === 'object' && Object.keys(ex.json).length > 0)
  );
  if (!has) {
    throw usageErr(`用例 ${c.id} 的 expect 为零断言(${ex === undefined ? '缺失' : JSON.stringify(ex)})——HTTP 200 即 PASS 是假绿;至少写一类断言(http/code/msgContains/json)`);
  }
}

async function fire(c) {
  const { url, method, headers, body } = buildRequest(c);

  let res, text;
  try {
    // redirect:'manual':重定向(SSO 登录页等)意味着请求没到业务接口,原样返回由下方判 FAIL
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    text = await res.text();
  } catch (e) {
    throw new Error(classifyFetchError(e, url));
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`响应被重定向(${res.status} → ${res.headers.get('location') || '(无 Location)'})——请求没到业务接口,常见于网关跳 SSO 登录页;确认 URL 前缀/token,别对登录页断言`);
  }
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* 响应非 JSON,由断言定性 */ }
  // 大响应截断:json 照常全量解析供断言,文本只留前 200KB 供报告引用,防内存放大
  const kept = text.length > 200 * 1024 ? text.slice(0, 200 * 1024) + `\n...(响应过大已截断,完整长度 ${text.length})` : text;
  return { status: res.status, text: kept, json };
}

// ---------- 断言执行 ----------
function check(c, r) {
  const fails = [];
  const ex = c.expect || {};
  if (ex.http !== undefined && r.status !== Number(ex.http)) { // cases.json 手写 "200" 字符串也算数,口径与 json 断言一致
    // 401/403 给专属下一步动作:别带死 token 硬跑(与 SKILL.md 红线一致)
    fails.push(r.status === 401 || r.status === 403
      ? `HTTP 码期望 ${ex.http},实际 ${r.status}——登录态失效/无权限:先向用户要新 token(F12 复制),带死 token 只会一片 401`
      : `HTTP 码期望 ${ex.http},实际 ${r.status}`);
  }
  if (ex.http === undefined && (r.status === 401 || r.status === 403)) {
    fails.push(`HTTP ${r.status}(用例未声明 http 期望)——登录态失效/无权限:先向用户要新 token(F12 复制),带死 token 只会一片 401`);
  }
  if (ex.code !== undefined) {
    // 非 JSON 的原文进失败明细=会带走响应里的一切(含 token 回显),过 stringify 统一 redact
    if (r.json == null) fails.push(`业务 code 无法断言:响应非 JSON(前 120 字: ${stringify(r.text.slice(0, 120))})`);
    else if (r.json.code !== Number(ex.code)) fails.push(`业务 code 期望 ${ex.code},实际 ${r.json.code}`);
  }
  if (ex.msgContains !== undefined) {
    const msg = r.json ? r.json.msg : r.text;
    if (msg == null || !String(msg).includes(ex.msgContains)) {
      fails.push(`msg 期望包含 "${ex.msgContains}",实际 ${stringify(msg)}`);
    }
  }
  for (const [p, expr] of Object.entries(ex.json || {})) {
    const actual = r.json == null ? undefined : resolvePath(r.json, p);
    const verdict = evalExpr(actual, expr);
    if (!verdict.ok) fails.push(`JSON ${p}: ${verdict.why}`);
  }
  return fails;
}

// ---------- 主循环 ----------
(async () => {
  const selected = filter ? spec.cases.filter(c => new RegExp(filter).test(c.id)) : spec.cases;
  if (selected.length === 0) { console.error(`--filter "${filter}" 没匹配到任何用例`); process.exit(2); }

  // 构造预检:本次选中的用例逐条离线全检(env 引用/path/query 对象/GET 带 body/bodyFile 存在/占位符/零断言),
  // 任一失败=零请求、整体退 2、不产生用例行、--out/--history 均不写——写坏的用例文件不能带着已发出的请求半途而废。
  // --filter 只要求选中用例过预检:未选中的坏用例不阻断单条回归
  const preErrs = [];
  for (const c of selected) {
    try { buildRequest(c); assertExpect(c); }
    catch (e) { if (!e.usage) throw e; preErrs.push(`${c.id || '(无名)'}: ${e.message}`); }
  }
  if (preErrs.length) {
    console.error(`构造预检未过,共 ${preErrs.length} 条(零请求已发出,--out/--history 未写):`);
    for (const m of preErrs) console.error(`  - ${m}`);
    process.exit(2);
  }

  // 写方法门禁(F7):选中集含 POST/PUT/DELETE/PATCH 而未给 --allow-write → 零请求退 2。
  // "写接口按轮确认"是红线,执行器要有落点:不靠 id 命名约定(新用例起名 T 开头就能绕),
  // 而是按 method 判。--dry-run/--check-only 本身零请求,不做门禁(dry-run 会提示实际执行需 --allow-write)
  const WRITE_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];
  const writeCases = selected.filter(c => WRITE_METHODS.includes(((c.request || {}).method || 'GET').toUpperCase()));
  if (writeCases.length && !allowWrite && !dryRun && !checkOnly) {
    console.error(`选中集含 ${writeCases.length} 条写方法用例,未给 --allow-write,零请求已拦截(--out/--history 未写):`);
    for (const c of writeCases) {
      const req = c.request || {};
      console.error(`  - ${c.id} ${(req.method || 'GET').toUpperCase()} ${req.path || ''} ${c.name || ''}`);
    }
    console.error('写接口须按轮确认:确认本轮可写后重跑并加 --allow-write;只想离线预检加 --check-only;只想看选中清单加 --dry-run');
    process.exit(2);
  }

  // 零请求模式:预检通过即停,--out/--history 不写(写用例入库前的机检、死端口预检都靠它)
  if (checkOnly || dryRun) {
    if (dryRun) {
      console.log(`--dry-run:构造预检通过 ${selected.length} 条,选中清单如下(零请求,--out/--history 未写):`);
      for (const c of selected) {
        const { method, url } = buildRequest(c); // 纯构造,不发请求
        console.log(`  ${method.padEnd(6)} ${redact(url.toString())}  ${c.id} ${c.name || ''}`);
      }
      if (writeCases.length && !allowWrite) console.log(`注意:含 ${writeCases.length} 条写方法用例,实际执行需 --allow-write`);
    } else {
      console.log(`--check-only:构造预检通过 ${selected.length} 条(零请求,--out/--history 未写)`);
    }
    process.exit(0);
  }

  const results = [];
  for (const c of selected) {
    const row = { id: c.id, name: c.name || '', env: envOf(c)[0], fails: [], error: null }; // env=该条实际环境,history 逐行真实 env(汇总另算合集)
    const t0 = Date.now();
    try {
      const r = await fire(c);
      row.fails = check(c, r);
      row.resp = r;
    } catch (e) {
      if (e.usage) { console.error(e.message); process.exit(2); } // 预检过了理论上到不了这,兜底别把用法错伪装成 ERR
      row.error = e.message;
    }
    row.ms = Date.now() - t0;
    results.push(row);
    const mark = row.error ? 'ERR' : row.fails.length ? 'FAIL' : 'PASS';
    console.log(`[${mark}] ${c.id} ${c.name || ''}${row.error ? ' — ' + row.error : ''}`);
    if (!row.error) for (const f of row.fails) console.log(`       ${f}`);
  }

  const pass = results.filter(r => !r.error && !r.fails.length).length;
  const fail = results.filter(r => !r.error && r.fails.length).length;
  const err = results.filter(r => r.error).length;
  // 混合 env 文件别只标默认 env:标实际跑过的全部 env,报告归档才不误导(R7)
  const envsUsed = [...new Set(results.map(r => r.env))].join('+'); // 终端汇总/--out 仍标合集;history 逐行已记真实 env
  console.log(`\n汇总: ${pass} PASS / ${fail} FAIL / ${err} ERR,共 ${results.length} 条(env=${envsUsed}${filter ? `, filter=${filter}` : ''})`);

  // --history 落盘:一行一用例,run 字段标识同一次执行;fail 明细走 redact,token 不进历史文件
  if (historyDir) {
    const { execFileSync } = require('child_process');
    let gitSha = null;
    try {
      gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.dirname(path.resolve(casesPath)), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch (_) { /* 用例库不是 git 仓/没装 git:记 null 不拦跑,git 是历史记录的可选维度 */ }
    const runId = new Date().toISOString();
    const base = path.basename(casesPath).replace(/\.[^.]+$/, '');
    const hp = path.join(historyDir, `${base}.jsonl`);
    const recs = results.map(r => JSON.stringify({
      run: runId, spec: base, env: r.env, git: gitSha, // 每行=该用例实际 env(混合环境可追溯),不再记合集
      id: r.id, name: r.name,
      result: r.error ? 'ERR' : r.fails.length ? 'FAIL' : 'PASS',
      ms: r.ms,
      fail: redact(String(r.error || r.fails[0] || '')).slice(0, 200) || null,
    }));
    try {
      fs.appendFileSync(hp, recs.join('\n') + '\n', 'utf8');
      console.log(`执行记录已追加: ${hp}(${recs.length} 行)`);
    } catch (e) {
      console.error(`执行记录写入失败(${hp}): ${e.message}`);
      process.exit(2);
    }
  }

  if (outPath) {
    // 单元格转义:换行让表格错行、反引号撑破围栏,粘进报告前先清
    const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/`/g, '\\`').slice(0, 300);
    // 围栏选比响应里现成反引号串更长的,``` 不会撑破围栏
    const fenceOf = (s) => { let n = 3; while (s.includes('`'.repeat(n))) n++; return '`'.repeat(n); };
    const lines = [
      `# 用例重放结果(自动生成)`, ``,
      `- 用例文件: \`${casesPath}\`  env: \`${envsUsed}\`  时间: ${new Date().toLocaleString('zh-CN')}`,
      `- 汇总: ${pass} PASS / ${fail} FAIL / ${err} ERR,共 ${results.length} 条`, ``,
      `| 用例 | 名称 | 结果 | 明细 |`, `|------|------|------|------|`,
      ...results.map(r => {
        const mark = r.error ? 'ERR' : r.fails.length ? 'FAIL' : 'PASS';
        const detail = r.error || r.fails.join(';') || '—';
        return `| ${r.id} | ${cell(r.name)} | ${mark} | ${cell(detail)} |`;
      }),
    ];
    // FAIL 明细附请求与响应(截断),供报告直接引用;token 回显统一 {{TOKEN}}
    for (const r of results.filter(x => x.error || x.fails.length)) {
      lines.push('', `## ${r.id} ${r.name}`, '');
      if (r.resp) {
        const c = spec.cases.find(x => x.id === r.id); // id 已校验唯一,不会附错用例
        const reqJson = redact(JSON.stringify(c.request, null, 2));
        const f1 = fenceOf(reqJson);
        lines.push(`${f1}json`, reqJson, f1);
        const respText = redact(r.resp.text).slice(0, 1500);
        const f2 = fenceOf(respText);
        lines.push(``, `HTTP ${r.resp.status},响应前 1500 字:`, f2, respText, f2);
      }
    }
    try {
      fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
      console.log(`报告片已写: ${outPath}`);
    } catch (e) {
      console.error(`报告片写入失败(${outPath}): ${e.message}——目录是否存在?`);
      process.exit(2);
    }
  }
  process.exit(fail + err > 0 ? 1 : 0);
})().catch(e => { console.error(`runner 未捕获异常: ${e.stack || e}`); process.exit(1); });
