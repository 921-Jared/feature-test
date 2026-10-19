# Windows + Git Bash 环境坑(中文编码三坑/Python 2)

> **适用语境**:测试执行环境为 Windows + Git Bash + Python 2(本 skill 的 shell 工具链默认环境);编码坑是"系统繁忙"类假故障的第一嫌疑
> **实证状态**:单项目(充电桩+mock 系统)实证——本机环境(Windows 11 + Git Bash + Python 2.7)反复实测;同环境下可复现,**非通用已验证**(Linux/macOS 环境不适用本文件)

1. **GET 中文参数**:手工 UTF-8 URL 编码后直接拼 URL。不要 `--data-urlencode` + shell 变量传中文(shell 传给 curl.exe 会变 GBK,服务端收到的长度/内容全错)
2. **POST JSON 中文 body**:用 Write 工具写 UTF-8 JSON 文件,`curl --data-binary @file` 发,**必须同时带 `-H "Content-Type: application/json"`**(--data-binary 默认按表单发,@RequestBody 收不到 → 415 假故障)。绝不 `-d '内联中文'`(GBK → 服务端 `Invalid UTF-8 start byte` → "系统繁忙"假故障)
3. **`python` 是 Python 2**:stdout 是 GBK;`open()` 无 encoding 参数(用 `io.open(path, encoding='utf-8')`);print 中文会 UnicodeEncodeError(只输出 ASCII/数字/布尔)。**处理响应文件优先用 grep/awk/cat,Python 只作备选**,别跟 Python 2 缠斗
4. **node 读 Git Bash 路径**:要写 `D:/...` 盘符正斜杠形态,不认 `/d/...`(实测踩过);curl 落盘 swagger 后用 require 读落盘文件(实测稳),管道喂 stdin 没验过别赌

注:走 `run-cases.js` 时中文编码三坑由 runner 构造消灭(GET query 自动 UTF-8 编码、body 走 UTF-8 文件),不再是纪律约束;本文件适用于手工 curl 场景。

## 误报教训与判定规则

测试端编码炸出的"系统繁忙/参数过长"不是服务端 bug,先用日志(根 logs/)和纯 ASCII 请求排除工具因素,再定性。**排除编码后仍复现的判定规则:看 error.log 内容——日志里是缺必填参数/参数解析类异常=「已知既有机制」,归信息性;日志无异常痕迹且纯 ASCII 请求也复现=真 bug,进 FAIL 明细。**
