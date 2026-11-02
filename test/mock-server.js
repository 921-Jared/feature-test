// runner 自测 mock:不碰任何项目服务,断言逻辑/编码链路离线验证用
// 启动: node mock-server.js  (端口 18901,Ctrl+C 停;MOCK_PORT 环境变量可覆盖,边界自测用独立端口)
// /count:返回启动以来收到的业务请求数(自身不计)——预检"零请求发出"的客观判据
'use strict';
const http = require('http');
const PORT = Number(process.env.MOCK_PORT) || 18901;
let hits = 0;

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader('Content-Type', 'application/json;charset=utf-8');
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    if (url.pathname === '/count') {
      res.end(JSON.stringify({ code: 200, msg: '操作成功', data: { count: hits } }));
      return;
    }
    hits++;
    if (url.pathname === '/ok') {
      res.end(JSON.stringify({ code: 200, msg: '操作成功', data: { total: 5, rows: [{ ruleName: '默认高温计费规则' }] } }));
    } else if (url.pathname === '/pre/ok') {
      // 带 pathPrefix 的专属分支——只有 runner 真正拼了前缀才打得进来,响应带独有标记
      res.end(JSON.stringify({ code: 200, msg: '操作成功', data: { total: 5, marker: 'prefixed-hit' } }));
    } else if (url.pathname === '/badcode') {
      res.end(JSON.stringify({ code: 500, msg: '系统繁忙,请稍后再试!' }));
    } else if (url.pathname === '/echo') {
      // 原样回显收到的 body——验证 UTF-8 文件 body 全链路不炸编码
      try { res.end(JSON.stringify({ code: 200, msg: '操作成功', bodyEcho: JSON.parse(raw) })); }
      catch (e) { res.end(JSON.stringify({ code: 500, msg: 'body 非合法 JSON: ' + e.message })); }
    } else if (url.pathname === '/qs-echo') {
      // 回显 query.name——验证 runner 的 GET 中文 UTF-8 编码
      res.end(JSON.stringify({ code: 200, msg: '操作成功', data: { q: url.searchParams.get('name') } }));
    } else if (url.pathname === '/whoami') {
      // 回显 Authorization 头——验证 {{TOKEN}} 占位符替换
      res.end(JSON.stringify({ code: 200, msg: '操作成功', data: { auth: req.headers['authorization'] || null } }));
    } else if (url.pathname === '/flag') {
      // 回显布尔值——验证布尔字面量断言(=true/=false/!=true)
      res.end(JSON.stringify({ code: 200, msg: '操作成功', data: url.searchParams.get('val') === 'true' }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ code: 404, msg: 'not found' }));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock ready on 127.0.0.1:${PORT}`));
