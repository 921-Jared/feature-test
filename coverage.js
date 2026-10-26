#!/usr/bin/env node
// feature-test 分支覆盖率工具:配合 JaCoCo agent(tcpserver 模式)对本地被测服务取数并出报告
// 干两件事:
//   reset  —— 清零 agent 计数器(跑用例前调,保证取到的 exec 只含本次用例)
//   report —— 取数(dump)+ 生成 HTML/XML/CSV + 聚合分支覆盖率数字(全模块/业务层/--classes 匹配三档)
// 前提:被测服务以 -javaagent:<skill目录>/tools/jacoco/jacocoagent.jar=output=tcpserver,port=6300,address=localhost,includes=<业务包>.* 启动(详见 SKILL.md 覆盖率配方)
// 限制:只对本地 JVM 有效——agent 挂在被测进程里,走测试网关/远程实例取不到数,如实标注别硬跑
// 退出码: 0=成功, 2=用法/环境错误(agent 连不上/java 缺失/jar 缺失)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const USAGE = [
  '用法:',
  '  node coverage.js reset  --agent localhost:6300',
  '  node coverage.js report --agent localhost:6300 --classfiles <target/classes目录> --out <输出目录>',
  '                           [--classes 类名正则(第三档口径只算匹配的类)] [--sourcefiles <src目录>] [--label 标签名]',
].join('\n');
function usageExit(msg) { console.error(msg + '\n' + USAGE); process.exit(2); }

const CLI_JAR = path.join(__dirname, 'tools', 'jacoco', 'jacococli.jar');
if (!fs.existsSync(CLI_JAR)) { console.error(`缺 ${CLI_JAR}——jacoco 工具未随 skill 安装,对照 SKILL.md 覆盖率配方补齐`); process.exit(2); }

function argOf(name) {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) usageExit(`${name} 缺少值(裸 flag 会静默错跑)`);
  return v;
}
const cmd = process.argv[2];
if (cmd !== 'reset' && cmd !== 'report') usageExit('缺少子命令 reset|report');
const agent = argOf('--agent');
if (!agent || !agent.includes(':')) usageExit('缺 --agent <host:port>(agent 用 output=tcpserver 启动时的地址)');
const [host, port] = agent.split(':');

// java 包装:统一超时与报错归因——agent 连不上/java 不在 PATH 是两类最常见错,各给专属提示
function java(args) {
  try {
    return execFileSync('java', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, encoding: 'utf8' });
  } catch (e) {
    const err = (e.stderr || '') + (e.message || '');
    if (/Cannot connect|Connection refused|connect timed out/i.test(err)) {
      console.error(`连不上 agent ${agent}——被测服务没起,或启动参数没带 output=tcpserver,port=${port}(本地 JVM 才挂得上 agent,网关/远程取不到)`);
    } else if (e.code === 'ENOENT') {
      console.error('找不到 java——本机 PATH 需有 JDK/JRE(jacoco 取数与报告全靠 java -jar)');
    } else {
      console.error(`jacoco 工具执行失败:\n${err.slice(0, 2000)}`);
    }
    process.exit(2);
  }
}

if (cmd === 'reset') {
  // dump --reset = 丢弃存量数据并清零计数器;destfile 是必选项,数据无价值,落临时文件即删
  const tmp = path.join(os.tmpdir(), `ft-cov-reset-${Date.now()}.exec`);
  java(['-jar', CLI_JAR, 'dump', `--address=${host}`, `--port=${port}`, `--destfile=${tmp}`, '--reset']);
  try { fs.unlinkSync(tmp); } catch (_) { /* 临时文件清理失败不拦流程 */ }
  console.log(`agent 计数器已清零(${agent})——现在跑用例,跑完用 report 取数`);
  process.exit(0);
}

// ---------- report ----------
const classfiles = argOf('--classfiles');
const outDir = argOf('--out');
if (!classfiles) usageExit('缺 --classfiles(被测模块 target/classes 目录)');
if (!fs.existsSync(classfiles)) usageExit(`--classfiles 不存在: ${classfiles}`);
if (!outDir) usageExit('缺 --out(报告输出目录)');
if (!fs.existsSync(outDir)) usageExit(`--out 目录不存在: ${outDir}——先 mkdir(与 run-cases.js --out 同口径)`);
const srcDir = argOf('--sourcefiles');
const classRe = argOf('--classes');
const label = argOf('--label') || classfiles;
if (classRe) { try { new RegExp(classRe); } catch (e) { usageExit(`--classes 非法正则: ${e.message}`); } }

const execFile = path.join(outDir, 'jacoco.exec');
java(['-jar', CLI_JAR, 'dump', `--address=${host}`, `--port=${port}`, `--destfile=${execFile}`]);

const rptArgs = ['-jar', CLI_JAR, 'report', execFile, `--classfiles=${classfiles}`];
if (srcDir) rptArgs.push(`--sourcefiles=${srcDir}`);
rptArgs.push(`--html=${path.join(outDir, 'html')}`, `--xml=${path.join(outDir, 'jacoco.xml')}`, `--csv=${path.join(outDir, 'jacoco.csv')}`);
java(rptArgs);

// ---------- CSV 聚合(列序:GROUP,PACKAGE,CLASS,INSTR_MISSED,INSTR_COVERED,BRANCH_MISSED,BRANCH_COVERED,...) ----------
// 口径三档,全部只看 BRANCH 列;业务层口径 = 包名含 service/controller 段,且类名排除装配/模型类
// (Req/Resp/Vo/Entity/Dto/Bo 等的"分支"多为 lombok equals/hashCode,Convert/Assembler/Registry/Config/Enum 是装配分发,计入分母会把业务数字稀释成噪音)
const BUSINESS_EXCLUDE = /(Req|Resp|Vo|VO|Entity|Dto|DTO|Bo|BO|Convert|Assembler|Registry|Config|Enum)$/;
const isBusiness = (pkg, cls) => /(^|\.)(service|controller)(\.|$)/.test(pkg) && !BUSINESS_EXCLUDE.test(cls);
const rows = fs.readFileSync(path.join(outDir, 'jacoco.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.split(','));
function agg(pred) {
  let m = 0, c = 0;
  for (const r of rows) if (pred(r)) { m += Number(r[5]); c += Number(r[6]); }
  return { m, c, pct: (m + c) === 0 ? null : (c * 100 / (m + c)) };
}
const totalAll = agg(() => true);
const totalBiz = agg(r => isBusiness(r[1], r[2]));
const totalCls = classRe ? agg(r => isBusiness(r[1], r[2]) && new RegExp(classRe).test(r[2])) : null;

// ---------- XML 方法级明细:哪些方法还有分支没走到(补用例的直接线索) ----------
// 自闭合 <class name="..."/> 守卫:零覆盖类是自闭合标签,普通 [^>]*> 会把 "/>" 当开标签收尾一路吞到
// 别的类的 </class>(实测 113 个自闭合标签吞出 4 个错位块,方法归错类)——负向前瞻排除;勿写成
// [^>]*[^\/]?>,那里的 ? 把否定类变成可选等于没修
const CLASS_BLOCK = /<class name="[^"]+"(?![^>]*\/>)[^>]*>[\s\S]*?<\/class>/g;
const METHOD_BLOCK = /<method name="[^"]+"(?![^>]*\/>)[^>]*>[\s\S]*?<\/method>/g;
// 注释兜底:JaCoCo 官方产物不带 <!-- -->,但人工拼接/二次加工过的 XML 里注释含 </class> 字面会提前截断块、
// 含 <class 残片会生成脏块——读入即剥注释,一行换掉整类场景(2026-10-26 二轮复核实证)
const xml = fs.readFileSync(path.join(outDir, 'jacoco.xml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const methods = [];
for (const clsBlock of xml.match(CLASS_BLOCK) || []) {
  const cls = clsBlock.match(/<class name="([^"]+)"/)[1];
  const pkg = cls.replace(/\//g, '.').replace(/\.[^.]+$/, '');
  const shortCls = cls.split('/').pop();
  if (!isBusiness(pkg, shortCls)) continue;
  if (classRe && !new RegExp(classRe).test(shortCls)) continue;
  for (const mBlock of clsBlock.match(METHOD_BLOCK) || []) {
    const br = mBlock.match(/<counter type="BRANCH" missed="(\d+)" covered="(\d+)"/);
    if (!br) continue; // 无分支的方法不列
    const missed = Number(br[1]), covered = Number(br[2]);
    if (missed + covered === 0) continue;
    methods.push({ shortCls, nm: unescapeXml(mBlock.match(/<method name="([^"]+)"/)[1]), ln: (mBlock.match(/ line="(\d+)"/) || [])[1] || '?', missed, covered });
  }
}
methods.sort((a, b) => b.missed - a.missed);

// ---------- 输出 ----------
const fmt = (t) => t.pct === null ? '无分支' : `${t.c}/${t.c + t.m} = ${t.pct.toFixed(1)}%`;
console.log(`\n=== 分支覆盖率(${label}) ===`);
console.log(`全模块: ${fmt(totalAll)}`);
console.log(`业务层(service+controller,已排除 Req/Resp/Vo/Entity/Dto 等装配/模型类): ${fmt(totalBiz)}`);
if (totalCls) console.log(`--classes /${classRe}/ 匹配类(业务层口径,Req/Resp 的 lombok 分支不计分母): ${fmt(totalCls)}`);
const lines = [
  `# 分支覆盖率(${label})`, ``,
  `- agent: ${agent}  classfiles: ${classfiles}  时间: ${new Date().toLocaleString('zh-CN')}`,
  `- 全模块分支: ${fmt(totalAll)}`,
  `- 业务层分支: ${fmt(totalBiz)}`,
];
if (totalCls) lines.push(`- 匹配 /${classRe}/ 类分支: ${fmt(totalCls)}`);
lines.push(`- 口径: 只看 BRANCH 计数;业务层=包名含 service/controller 段且排除装配/模型类(Req/Resp/Vo/Entity/Dto/Bo/Convert/Assembler/Registry/Config/Enum)`, ``, `## 未覆盖分支 TOP20(按漏分支数排序,方法级)`, ``, `| 类 | 方法 | 起始行 | 漏/总 |`, `|----|------|--------|-------|`);
for (const m of methods.slice(0, 20)) {
  const row = `| ${m.shortCls} | ${m.nm} | ${m.ln} | ${m.missed}/${m.missed + m.covered} |`;
  lines.push(row);
}
if (methods.length > 20) lines.push(``, `...(共 ${methods.length} 个方法有分支,TOP20 之外见 html 报告)`);
lines.push(``, `完整 HTML(逐行红绿标记): ${path.join(outDir, 'html', 'index.html')}`);
fs.writeFileSync(path.join(outDir, 'coverage.md'), lines.join('\n') + '\n', 'utf8');
console.log(`\n未覆盖分支 TOP20:`);
for (const m of methods.slice(0, 20)) console.log(`  ${m.shortCls}.${m.nm} (line ${m.ln})  漏 ${m.missed}/${m.missed + m.covered}`);
console.log(`\n覆盖率节已写: ${path.join(outDir, 'coverage.md')}`);
console.log(`完整报告: ${path.join(outDir, 'html')}`);
