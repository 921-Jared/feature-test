// 高温计费多套规则 接口 Apifox 导入文件生成器
// 数据源: 本地被测服务(显示名见 info.description) /v2/api-docs
// 产出: OUT 指定路径 (可直接拖进 Apifox 团队项目导入;目录由 CLI 第 1 参传入,实测值见本地项目档案)
// 接口面: 前端接口文档 §1-§8 的 8 个接口; DELETE/{ids} 与 POST/export 按文档 §10 排除
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.argv[2] || '.'; // 产出目录: CLI 第 1 参传入(实测值见本地项目档案,勿把真实路径写入本文件)
const OUT = path.join(OUT_DIR, '高温计费-多套规则接口.json');
const PORT = 9301;
const KEEP_PATH = /^\/hyperthermia-setting/;
const DROP = new Set(['delete:/hyperthermia-setting/{ids}', 'post:/hyperthermia-setting/export']);
const TAG = '高温计费设置相关操作接口';
const SUMMARY = {
  'get:/hyperthermia-setting/list': '列表页',
  'get:/hyperthermia-setting/info': '详情回填(编辑页)',
  'post:/hyperthermia-setting': '新增',
  'put:/hyperthermia-setting': '修改',
  'get:/hyperthermia-setting/history': '历史版本列表',
  'get:/hyperthermia-setting/history-detail': '历史详情(版本快照,只读)',
  'get:/hyperthermia-setting/check-name': '名称查重',
  'get:/hyperthermia-setting/available-rules': '可选计费规则(编辑页选择器数据源)',
};

function fetchJson(port, probePath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: probePath, timeout: 5000 }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`port ${port}${probePath} 返回非JSON: ${body.slice(0, 120)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`port ${port} 连接超时`)); });
  });
}

// 从 schema 递归收集 $ref 引用到的 definitions
function walkSchemas(schema, keep, allDefs) {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) { schema.forEach(s => walkSchemas(s, keep, allDefs)); return; }
  if (schema.$ref) {
    const name = decodeURIComponent(schema.$ref.split('/').pop());
    if (allDefs[name] && !keep.has(name)) {
      keep.add(name);
      walkSchemas(allDefs[name], keep, allDefs);
    }
  }
  for (const v of Object.values(schema)) walkSchemas(v, keep, allDefs);
}

(async () => {
  const src = await fetchJson(PORT, '/v2/api-docs');
  const paths = {};
  const keepDefs = new Set();

  for (const [p, ops] of Object.entries(src.paths || {})) {
    if (!KEEP_PATH.test(p)) continue;
    const kept = {};
    for (const [method, op] of Object.entries(ops)) {
      if (DROP.has(`${method}:${p}`)) continue;
      op.tags = [TAG]; // 归一个中文目录
      if (SUMMARY[`${method}:${p}`]) op.summary = SUMMARY[`${method}:${p}`];
      kept[method] = op;
      walkSchemas(op, keepDefs, src.definitions || {});
    }
    if (Object.keys(kept).length) paths[p] = kept;
  }

  const definitions = {};
  for (const name of keepDefs) definitions[name] = src.definitions[name];

  const out = {
    swagger: src.swagger || '2.0',
    info: { title: '高温计费多套规则', description: ' 被测项目 station 服务本地 9301 swagger 生成(脱敏); 前端经网关加 /station 前缀', version: '1.0' },
    host: '127.0.0.1:9301',
    basePath: '/',
    tags: [{ name: TAG }],
    paths,
    definitions,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf-8');
  const count = Object.values(paths).reduce((n, ops) => n + Object.keys(ops).length, 0);
  console.log(`已生成 ${OUT}`);
  console.log(`接口 ${count} 个, definitions ${Object.keys(definitions).length} 个`);
  for (const [p, ops] of Object.entries(paths))
    for (const [m, op] of Object.entries(ops)) console.log(`  ${m.toUpperCase().padEnd(6)} ${p}  ${op.summary || ''}`);
  // 悬空 $ref 检查
  const all = JSON.stringify(out);
  const refs = [...all.matchAll(/"\$ref"\s*:\s*"#\/definitions\/([^"]+)"/g)].map(m => decodeURIComponent(m[1]));
  const dangling = [...new Set(refs)].filter(r => !definitions[r]);
  console.log(dangling.length ? `⚠️ 悬空$ref: ${dangling.join(', ')}` : '无悬空$ref ✅');
})().catch(e => { console.error(e.message); process.exit(1); });
