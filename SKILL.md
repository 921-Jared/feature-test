---
name: feature-test
description: 充电桩项目专用。新功能或新接口写完后,用户要求测试/复测/回归时使用。触发词:测一下 xx、帮忙测 xx 接口、测试 xx 功能、回归 xx、出 Apifox 件、跟前端对接。
---

# feature-test: 新功能接口测试

核心场景:开发者(用户)写完一个新功能,由 AI 完成接口级测试并出报告。

## 不适用(有这些情况别走本流程)

- 纯前端改动(无接口变化)
- 代码还没部署到目标环境——先部署再测;跨模块改动各服务要同版本同部署
- 已有单测覆盖的纯逻辑校验(走单测/代码审查,不走接口测试)
- 生产环境验证——本 skill 只碰本地端口和测试网关,生产永远不碰

## 流程(5 步,顺序执行;第 5 步按需)

### 第 1 步:定位

1. 看用户改动:`git status --short`(注意:**新功能常是新文件即 ?? 前缀**,不能一滤了之;排除 logs/、.codex/、.diag/ 等已知垃圾目录后,新增的 .java/.xml 就是功能主体)+ `git diff --stat` + `git diff --cached --stat`;若均无改动,看 `git log --oneline -5` 最近提交,或直接问用户功能名。**改动跨多个模块时,列清单确认目标环境各服务均已部署该版本(本地均已启动)**——依赖服务旧版本会导致参数静默丢/字段缺失,误报成 bug(盘链与部署核对的具体做法见第 3 步「跨模块 Feign 链路配方」)
2. 找 Controller 确认:请求路径、方法、入参格式(@RequestBody JSON 还是 form/query)、权限注解
3. 读 Service 层业务逻辑——**边界用例的依据来自代码逻辑**(校验规则、版本化、互斥等),不读代码出不了好用例
4. **确认部署位置**:问用户或从上下文判断。本地服务端口从该模块 `bootstrap.yml` 的 `server.port` 读(若文件里没有,问用户);测试环境走网关 `{GW}`(占位,实值单源=cases/*.json 的 `envs.gateway`,明文 IP 一律不入库,实测地址见本地项目档案),**URL=网关+路由前缀+controller 路径:路由前缀≈模块名,但 Controller 类级 @RequestMapping 另算——两者别混;路由配在 Nacos,拿不准从 test-platform/reports 历史报告找或问用户**
5. **已核实路由/端口速查**(来源=历史测试实证;**表内"—"=未实证,用前读 bootstrap.yml/Nacos,别猜;表内有值也建议用时复核**):

   | 模块 | 本地端口 | 网关路由前缀 | 已核实例外 |
   |------|---------|-------------|-----------|
   | station | 9301 | /station | <示例类名>Controller 实际前缀 /<模块名>-info |
   | applet | — | /applet | 2026-10-14 会员端实证;本地端口未实证 |
   | order | — | /order | 2026-10-14 实证;本地端口仍未实证 |
   | auth | — | /auth | 2026-10-14 网关探路实证(空 body 打登录接口回服务脸 500「手机号不能为空」);本地端口未实证 |
   | pay | 9304 | — | — |

### 第 2 步:出用例(三档)

- **正常**:主路径,典型参数
- **边界**:长度上限/下限、空值、空格、刚好越界——从代码里的校验逻辑反推(如 `length() > 50` → 测 50 和 51)
- **异常**:不存在的 ID、缺必填参数、非法枚举值、重名/冲突、无 token
- 回归场景(同功能此前测过):从 cases/ 取历史用例挑代表项(**抽样标准:PASS 与 FAIL 各至少 1 条 + 缺陷基线/knownDeviation 用例必选;观察类不重跑**),不必全量重跑;结果与历史基线对比

用例先列出来再执行;每个用例写明**期望结果**(具体到 msg 或字段值)。**断言类用例的「期望」只写应有行为**(如"PC token 打会员接口应被拒"),已发现的缺陷形态另设 `knownDeviation` 栏并注明"修复后删除此栏"——把"当前实际"塞进期望栏,回归时会**把缺陷判成 PASS**;只有**观察类用例**(纯记录形态、不设对错,如"非白名单路由伪 token 返什么")才可以把观测值当基线。定稿后同步落机器可重放格式 `<项目用例库>\cases\<功能名>.json`(实测路径见本地项目档案;格式见自动化回归节)。

### 第 3 步:执行

条目按执行顺序排列:先三探(全只读),再按第 2 步用例逐条执行;**写接口的确认动作发生在向它发请求之前**,三探不等写接口确认。

- **开工三探**:①探活:`netstat -ano | grep :<端口>`,不在则先问用户;**探活覆盖链上全部依赖服务,不止目标服务**——被调服务没起时 Feign 静默降级(2026-10-15 券包退款实证:member 9303 未启动,退款详情 phone=null 看似数据问题,日志实锤 `Load balancer does not contain an instance`;fallback 返 null/空与"查无数据"难分辨,先查日志再定性);②首发一个轻量接口验证 token(顺带连通性)——**若失败(token 过期/无效,Redis 会话有 TTL),向用户要新 token 或请其 F12 复制,不要带死 token 硬跑**;③查存量数据(list/老查询接口)作为用例素材(真实 ID、已有名称、被占用关系),顺带确认无上次测试残留;**存量全不可用时(活动过期/下架等)经用户确认用管理端写接口造最小可测数据**(2026-10-16 实证:券包活动全过期,PUT 改时间窗/金额造出可购活动),报告注明造了什么数据
- 登录态:PC 管理端接口用 `-H "Authorization: <token>"`(token 由用户提供或 F12 复制,本地服务按惯例连云测试 Redis,测试环境 token 通用;仍 401 则查该模块 Nacos 的 redis 配置再定性)。**小程序(applet)接口需要会员 token(与 PC token 发放入口与会话机制不同),获取方式先问用户,拿不到就明说测不了——拿 PC token 打 applet 接口不会得到 401,而是 200 空 null 壳或 500「会员信息有误」(易被误读成"接口无数据"静默放过,比 401 更危险),必须用会员 token**。会员 token 自取路径(2026-10-14 实证=路径②手机直收;路径①万能码/白名单免短信〔未验证,要用先问用户〕;需用户本人**已注册**手机号):`POST {GW}/auth/get_login_sms_code` `{"phone":"..."}` →(码 TTL 5 分钟,手机直收;错码 `000000` **必须先于正确码**跑负向——顺序敏感:登录成功即消耗验证码,后跑错码同样返"验证码有误",无判别力;错码本身不消耗验证码,转 .json 重放时数组顺序即执行顺序)→ `POST {GW}/auth/applet-phone-login-register` `{"phone":"...","code":"..."}` → `data.access_token`。**发码是真实短信:只发本人测试号、只发一次、重试前先问;未注册号会触发建会员+钱包+注册送券三重写副作用,别用陌生号**
  - **会员 token 生命周期段**(2026-10-14 实测版,**原考古结论 TTL 720min/120min 自动续期已被实测否证,别照抄**):会员 JWT 签发时**不 setExpiration**(`JwtUtils.createToken`),applet 侧取用户又是**只解析 claims、不查会话**(`SecurityUtils.getUserId(request)`)→ ①〔实测〕登录返回的 `expires_in` **不可信**,token 实质**无有效期**——**作用域=命中白名单的 applet 路由**(非白名单路由仍过网关会话检查,且会员会话键写错反而被拒;whites 收窄或 applet 路由不在名单内时此条失效)②〔源码推导,闭环=用户跑 `keys 'login_tokens:*'` 看会员会话键形态〕**无法靠刷新或吊销失效**(`/auth/refresh-applet` 对会员空转,会员会话写在 `login_tokens:{整个JWT}` 下、网关按 userKey 查不到) ③〔源码推导〕PC 侧有 Redis TTL 兜底,**会员侧无兜底**。失效形态判据:伪/篡改 token 返服务脸「系统繁忙」(白名单路由);拿不准就换 token 而不是赌它过期
  - **别把"会员 token 打 PC 路由被拒"当体系互斥**:那个 401 的根因是上面**会话键不一致**(查不到会话),不是存在"会员 token 不许走 PC 路由"的校验——缺陷修好后该 401 可能消失,别写进结论当不变量
- 断言三件套:HTTP 码 + 业务 code(AjaxResult 200=成功,500=业务异常,401=token 层:「令牌不能为空」或「登录状态已过期」=会话过期,**见到即停手换 token**)+ 关键 msg/字段。**读接口必须验证 data 内容**(布尔值/条数/差集/关键字段值),写接口验 code+msg 即可(data 常为 null)。"判 code 不判 data"是 Feign 调用判成败的口诀,不是测试断言规则
- **大响应防挤爆**:列表类接口可能返回几百 KB,先 `> 文件` 落盘,再用 grep/awk 提取关键字段断言,不让全量 JSON 进终端输出;临时文件测完删除
- 查询接口直接跑;**写接口先向用户确认**(说明会插什么数据、附清理 SQL、绝不碰存量业务数据),优先走接口自身删除功能清理;**清理 SQL 一律交用户执行,AI 不直连任何数据库**(项目铁律);未执行时报告标注"待清理"并附 SQL
- 出错先看日志:本地服务的日志在**项目根** `logs/<服务名>/error.log`(不是模块目录下那份)
- 高危红线:钱/退款/删除存量/批量/模拟回调,必须用户明确点头才碰;**请求目标只允许两类——本地 localhost 端口、测试网关 <被测网关地址>(实测地址从项目档案读取,勿入库),遇到其他任何域名/IP 先问用户是什么环境,确认不是生产再动**
- 并发守卫类逻辑(乐观锁/防重复提交)的测法(属写接口,同样先过用户确认):同一请求 body 写文件后,两个 curl 用 `&` 后台并行发 + `wait`,分别存响应文件再对比——预期一胜一败;测完检查版本链/数据没有出现重复行
- **状态机类功能的测法**(2026-10-15 券包退款实证):①先读码画出全状态图(每条迁移的守卫 WHERE)②中间态**交用户 SQL 预置**(如置失败态模拟"微信受理失败",AI 不直连 DB)③专用回写/推进接口逐态打(如模拟回调),每步发完立刻只读回查落库值④终态后再打一遍入口=守卫必拦⑤资损红线类断言盯"复用不变量"(如重试前后退款单号逐字一致)⑥写接口的请求预算按状态机节点数估,不按用例数
- **网关直连配方**(2026-10-14 高温计费网关回归实证):
  - URL=网关+路由前缀+controller 路径;PC token 同样放 Authorization 头,中文 body 仍走 Write 文件+--data-binary
  - **本地直连无网关时,操作人字段恒 0/空,写接口断言别含操作人**:`SecurityUtils.getUserId()/getUsername()` 读的是 `SecurityContextHolder`,而该 context 的 userId/username 只由 HeaderInterceptor 从**网关注入的内部头**取(2026-10-15 实测:本地直连发退款,oper_user_id=0/oper_user_name='');JWT 兜底只设置 LOGIN_USER 不设置这两个字段,与 token 有效性无关。同理,定时任务/MQ 线程同样没有这些头
  - **网关是纯 HTTP**:对 `{GW}` 用 `https://` 会 schannel SEC_E_INVALID_TOKEN 握手失败(2026-10-14 实证),直接用 `http://`
  - 鉴权三形态(非白名单路由;2026-10-14 applet 实证拆分,旧说法"token 死→500"混淆了②③两形态):①无 token → HTTP 200+业务 code 401「令牌不能为空」;②**签名合法但会话缺失(PC token 30 分钟不动真过期即此形态)→ 401「登录状态已过期」,见到即停手换 token**;③**签名非法/伪造 → HTTP 200+`{"code":500,"msg":"内部服务器错误"}` 无 data 键(网关脸,GatewayExceptionHandler)**。分辨层:`data` 键有无+msg——网关脸无 data 键,服务脸带 `"data":null` 且 msg 是业务文案。见网关脸/401 过期先查 token,别当业务 bug
  - **两副面孔只适用非白名单路由**(2026-10-14 applet 实证;分两级看):〔源码证〕机制=`AuthFilter` 命中 Nacos `whites` 即直接放行(行号以被测项目实际版本 grep 定位,锚点见本地项目档案)、**网关鉴权**零介入(路由/StripPrefix/超时等全局 filter 照走);〔形态反推,未读配置〕名单内容=`/applet/**`、`/auth/**` 命中(由响应形态推出,**别当成配置实证**)→ 无/伪 token 的返回是**服务脸** `{"code":500,"msg":"系统繁忙,请稍后再试!","data":null}`(带 data 键),既不是 401 也不是网关脸。判别器=**路由是否在白名单,不是模块**
  - **白名单行为探针——只能定「命中」,不能定「未命中」**(假阴两条路:目标实例挂→网关报错无 data 键;白名单路由服务侧异常也可能返**不带** data 键的 `{"code":500}`):目标路由发**无 token 请求** → 带 `data` 键 ⇒ 命中白名单;无 `data` 键 ⇒ **不定论**,先补两个前置再判:①并行探同服务另一路由确认实例活着;②**正基线**——同路由带合法 token 拿到正常业务响应(服务在线且形态可读)。**必须同时打一个已知非白名单路由**(如 `/system/user/getInfo`)做对照。要把"形态反推"升级为"配置实证",请用户从 Nacos 导一次 whites 列表作附件
  - token 生命周期:Redis 会话 30 分钟不动过期;**F5 刷新不换 token,必须退出重登**(TokenService 每次登录 fastUUID,JWT 中段不同=不同会话);token 死立即停手向用户要新的
  - 网关超时(000/exit 28)≠网关挂:并行探另一路由(如 /system/user/getInfo)区分"网关挂"还是"目标服务实例挂";目标实例挂我无 SSH,报告附日志命令交用户;实例卡死期间可切本地同代码同库直跑(数据原子性先核:超时的写请求查 version/行数确认未提交)
- **第三方回调 URL 探活配方**(2026-10-16 券包退款微信回调实证;凡带微信回调的功能,部署后、发真单前必做一次——**仅限测试环境;正式服上线前的探活同样必做但由用户执行,AI 不碰生产**):
  - 回调 URL=nginx 域名(测试服 `http://<被测网关地址>/<服务上下文路径>`,实测值见本地项目档案)+ **模块路由段(`/applet` 这类 StripPrefix 前缀也在 URL 里,最常漏的就是它)** + controller 路径。配错的症状=代码/单测/接口测试全绿,但回调永远打空炮、单据永远卡"处理中"——只有探活拦得住
  - curl 探活三形态(POST 回调路径):网关 `404 NOT_FOUND`=没路由到(查缺路由段/拼写);**回调控制器自答的 FAIL XML(`return_code` FAIL"处理失败")=已正确路由到**——没带微信签名参数,控制器走失败分支应答,这个"失败应答"恰是"通了"的标志;前端 HTML=打到 nginx 静态页(路由段整个丢了)。探活 URL 必须逐字符=Nacos 里将来配的值
  - 回调 URL 等依赖的 Nacos 配置 AI 无凭据:列清单交用户逐项改,改完以「探活形态对 + 真单回调落库」双确认才算闭环
- **导出接口(xlsx)配方**(2026-10-14 充值订单导出实证):
  - 断言对象=译文(readConverterExp 翻译发生在生成侧,原码不落盘);**先 grep `new SXSSFWorkbook|new XSSFWorkbook` 定分支**——SXSSF 字符串走 inlineStr 写 `xl/worksheets/sheet1.xml`,sharedStrings.xml 近乎空,只 dump 它会系统性漏断
  - **过滤参数先看 controller 签名有没有 @RequestBody**(2026-10-19 充电桩导出实证:被测项目一个导出型 Controller 无注解 → 过滤条件必须走 query 参数,POST JSON body 被静默忽略**返回全表**,行数断言会当场暴露但别急着定性服务 bug;实例锚点见本地项目档案);**表头中文实体断言用已归档常量别心算 Unicode 十进制**(实测连错两次:码=30721 平=24179,skill/历史报告里常有现成值;起疑先 `od -c` 看字节)
  - 工具:`unzip -p`(本机有);Git Bash 内 `tar` 是 GNU 版**不能读 zip**,要 bsdtar 得用全路径 `/c/Windows/System32/tar.exe -xOf`
  - 完整性最弱断言:`unzip -t` OK + `[Content_Types].xml` 存在;行数=数 `<row `(含表头 1 行;合计行另核域类 isStatistics/addStatisticsRow)
  - **逐行映射断言**:list 接口取唯一键→码值当 oracle,按唯一键定位 xlsx 行断言译文;无样本的码值标"未覆盖";oracle 陷阱:**先核对导出与列表是否同一条 SQL+缺省语义**(实例:list 不传 userType 静默走团队分支只回团队子集,export 永远全表——无条件 total 不是全表)
  - **数值/日期列断言**:金额等数值列在 sheet1.xml 是 `<v>` 原始值不进字符串区——断言=读 `<v>`+数值归一化(位数/精度);时间列按注解 dateFormat 反推期望格式(如 yyyy-MM-dd 丢时分秒是注解设计);无 oracle 的数值列至少做非空+格式正则
  - **多 sheet**:断言前先 `unzip -l` 看 sheet 数;多 sheet 时遍历 `xl/worksheets/sheet*.xml`,别只盯 sheet1
  - **空结果负例必须配非空正例**(取已有值的过滤字段)才算编码/语义证据——空结果负例(乱码/超长/不存在)只证健壮性不证语义
  - 业务标识符(单号类)在流转文档打码(尾 6 位形态),集合比对留 count/差集数;归档 git 前替换全文形态;SQL 交付件因可执行性可保留全文并注明
  - xlsx 原件含 PII,**不入 inbox/git**,报告只留行数+码值+打码;临时文件测完删
- **大分页/PageHelper 配方**(2026-10-14 `/order/charge/list` 5 档实测 5P/0F;总前提=分页三件套都在 common-core(BaseController 实测类路径=被测项目 common 公共模块,root pom `dependencyManagement` 锁版本〔实测锚点见本地项目档案〕;common-core 直声明在 api 子模块 pom+common-redis〔本项目实测 7 个 api pom,计数与锚点见本地项目档案〕,各模块经传递依赖上类路径),各模块同形〔源码推导,闭环=类级 grep(修正 RE-44:文件级 grep≠类级):继承 BaseController 的 Controller 占比**以被测项目实际版本类级 grep 定位**(实测计数见本地项目档案),少数不继承者=通知回调/配置字典/充电卡/设备绑定类,**零分页引用=非分页控制器**;非继承 Controller 将来带分页时**直调 `PageHelper.startPage()` 同效**,机制不依赖继承;行为级同形仅 order 实测过,其余模块首用时按判据复测〕):
  - **参数位置**:`pageNum/pageSize` **不在 Req/DTO 类里**,由 `TableSupport.getPageDomain()` 直取 HTTP 请求参数(行号以实际版本为准)(还有 `orderByColumn/isAsc/reasonable`)→ 读码看 DTO 会误判"接口不支持分页";`pageSize=abc` **静默回落默认值不报错**(实测响应与默认档逐字节相同)
  - **缺省值 pageSize=50 不是 10**(项目自改 `TableSupport`,别按 RuoYi 习惯断言 10);**上限侧无校验〔实测:`pageSize=2000` 收 3.0MB/7.0s 不报错〕;零/负数侧不报错但返回空 rows〔实测 P6/P7:`pageSize=0` 与 `-1` 均 `total=count、rows=[]`(71 字节响应);机制=pagehelper core 5.3.2 `AbstractHelperDialect.afterCount` 闸1(pageSizeZero 非空且 false 且 pageSize≤0 → 跳过页查询直接返空),`beforePage` 的 `pageSize>0` 门槛在它下游走不到;**别信「负数=查全部」旧语义**——5.3.2 里需 `pagehelper.pageSizeZero=true` 才让 0=查全部,且那时负数反而是空(闸2);Nacos 将来若开 pageSizeZero=true,0 会突然变拉全表=配置地雷〕;`PageUtils` 直传无判断(行号以实际版本为准)〕**——大响应风险全由调用方决定,服务端零护栏
  - **`reasonable` 默认 true 且 null 也兜底 true**(`PageDomain`,行号以实际版本为准)→ **越界 pageNum 返回最后一页,不是空列表**(实测 pageNum=999999 → 33 行=total−(尾页-1)×50)。抓全量的脚本**终止条件判 `已取>=total`,不能判 rows 为空**,否则尾页之后无限重复
  - **total+rows.length 三段判据(查截断的最省事一招)**:`BaseController.getPageData()` 用 `new PageInfo(rows).getTotal()`(行号以实际版本为准),只有 mapper 的 `Page` 实例原样传进来 total 才是 count。→ 同接口打 50 与 500 两档,**三段全过才算"用法正确"**:①两档 total 相等;②每档 `rows.length == min(pageSize,total)`——防两类假阳:clearPage 型(两档都全表,total 都=全表行数但相等)、参数未生效型(pageSize 拼错经 `Convert.toInt` 静默回落 50,"500 档"其实是 50 档恒等比较;跨 Feign 时 pageDomain 有值同样忽略请求参数);② 的前提=service 不在查询后过滤/裁剪 rows(有的接口设计如此,如按运营商名后过滤,此时 ② 单独报退化要先查代码);③total 不等时**同参数复测一次**再定性(防两次调用间新写入漂移)。total 随 pageSize 变或=当页条数=service 里把 list 重新包装过(`stream().collect()`/`new ArrayList`)→ PageHelper 截断退化,即「券叠放」那类真缺陷
  - **`startPage()` 后禁止 return/抛异常**:分页是 ThreadLocal,设了却没查询消费就泄漏给线程池**下一个请求**(其首条 MyBatis 查询被陈旧 LIMIT 截断,偶发跨请求"列表少数据")。现存反例=startPage() 后按业务条件早退 return 的分支(现存于被测项目,档案可查);静态检查=`grep -n startPage` 后逐方法看分支,动态验证需**团队角色账号**(walletId 非空才命中)
  - **`PageHelper.clearPage()` 是双刃剑,见到先查它保护了谁**:全仓**没有按请求兜底清理**(2026-10-14 grep 确认:`clearPage` 只有 BaseController/PageUtils 两处定义 + 业务两处调用),`PageInterceptor` 只在自己执行过分页查询后清(pagehelper 5.3.2 jar 字节码核实:`PageInterceptor.intercept` 整段 try/finally,finally→`PageHelper.afterAll`→末尾 `clearPage()`——拦截器只钩 `Executor.query`,零查询早退=永不触发清理)。所以 service 里为保护辅助查询而 `clearPage()`(实例锚点见本地项目档案)会**把上游 controller 设的分页一并清掉 → 主查询不分页返回全表,且 `getPageData` 的 total 退化成全表行数**;该接口〔源码推导,**待双账号对照坐实(见 cases PG8),前提=数据域账号 Feign 返回 stationIds 非空(未验)**〕因登录人数据域不同走两条不同路径(admin 数据域为空→正常分页,数据域账号→全表),对照测试必须两种账号各打一次。**入口 clearPage 算不算正确防御,判别式=clear 之后还有没有需要分页的主查询**:还有→clear 连它的分页一起清,就是 clearPage 连清上游分页型坑(实例见档案);没有(如无条件 clearPage 的正例,clear 后只剩不分页的明细查询,锚点见本地项目档案)→才是防御——别把「被调方入口 clearPage=正确」当通例抄。另注:`clearPage()` 清的是 **PageHelper 自己的 LOCAL_PAGE**
  - **跨 Feign 分页**:`TableSupport` 优先读 `SecurityContextHolder.getPageDomain()`(由 `startAppletPage` 经 header 传"pageNum,pageSize"),**有值就忽略本次请求参数** → 下游"传了 pageSize 没生效"多半是这条,不是服务端 bug(见 memory 分页跨Feign截断50;此值存在 `SecurityContextHolder` 里,是与 PageHelper LOCAL_PAGE **不同的另一个 ThreadLocal**,clearPage 清不到它)
  - **耗时不可线性外推**:实测 50=0.25s / 500=0.55s / 2000=7.0s(4 倍行数×12.8 倍时间),拐点在 500~2000 之间;档位换算用**单行实测字节**(该接口 ≈1.57KB/行,由小档 size/rows 反推,别用先验估算),估档留 3~5 倍余量
  - 响应外层只有 `total/rows/code/msg/extData`(PageDataInfo),**无 `pages/pageNum/pageSize` 外溢** → 调用方拿不到总页数,越界只能自算 `ceil(total/pageSize)`
  - **停止条件先写进方案再发第一个请求**(踩过 504 的接口尤其):同接口 ≤5 次、`--max-time 30`、响应 >10MB 即停止升档、耗时 >10s 下一档降一档、超时=同参数重试 1 次 + 并行探 `/system/user/getInfo` 分辨网关挂还是实例挂。方案不要求 Codex 预审,但也**别在方案里预写"经 Codex 审过再执行"这类未发生的声明**——实流程=方案定稿 Hash 锁定→执行→审查与结果同批交付
  - 工具缺口:`run-cases.js` 断言只有 `= != > < contains`,**没有数组长度断言** → 大分页用例的核心断言 `rows.length=N` 机器判不了,这类用例暂留 .md 手工跑(别为凑机器化出一个没验行数的假 PASS)

- **跨模块 Feign 链路配方(双部署检查清单)**(2026-10-15 读码成稿,锚例=applet 福利活动→station;**未经真实双部署场景实证,用第一条链时按此执行并回填**):
  - **盘链(定位阶段读码 3 步)**:①入口 Controller 找 `@Autowired RemoteXxxService`(定义在 `<下游> 模块的 api 契约 jar`,`@FeignClient(value = ServiceNameConstants.XXX_SERVICE)` = 下游服务名,常量表在 common-core 的 ServiceNameConstants)②Feign 方法上的 `@PostMapping` 路径=下游服务的 Controller 路径(不带网关前缀),去下游模块 grep 同路径找到 Controller→Service→Mapper ③核对调用方 pom 依赖 `<下游> 模块的 api 契约 jar` —— **api jar 是契约载体:接口/DTO 加字段后,所有依赖该 jar 的调用方服务都要重新打包部署**,否则新字段/新参数在 Feign 反序列化时**静默丢**(表现=字段缺失/参数没生效,像 bug 其实是部署不同步;eqTypes 那次 applet+station 不同发就是这类)。一条链可能多跳(applet→station→pay),逐跳盘完输出「服务×改动」矩阵
  - **双部署核对(发第一个请求前)**:①确认每个涉及服务的**全部实例**都已部署新版本〔实例数别按记忆断言——以 Nacos 服务列表/网关路由为准,让用户导一次;不止一台时逐台确认〕 ②DDL 先行 ③新增 Nacos 配置 key 先配好(**缺失的失败形态=代码抛「xx不能为空」直达,先读代码确认兜底存在再定性是配置缺不是代码 bug**;key 名通常写在 properties 类注释里——实例 2026-10-15 station 券包退款:本地 Nacos 缺 `wechat-pay.default-entity`,存量单退款重试全部卡失败态,查配置=`curl "http://<nacos>/nacos/v1/cs/configs?dataId=<服务>-<profile>.yml&group=<group>&tenant=<namespace>"`) ④顺序原则:加法型改动(新接口/新字段/新配置)先后无所谓但**必须全**;改契约型(改字段含义/删字段)先双端兼容再切换;项目铁律=联动改动**同部署**,分批部署会丢中间数据 ⑤验证顺序**从链尾往链头**:先直调下游(本地端口或网关)确认 provider 对,再从链头发端到端——错在哪一跳一眼分明
  - **Feign 特有断言坑(执行阶段)**:①判 code 不判 data(`R.isError` 只看 code;AjaxResult 无 data 时 `getData()` 恒 null,别误报)②**fallback 形态不一**:FallbackFactory 里有的方法返 `R.fail("业务名:异常信息")`,有的**直接 return null**(实例:`RemoteCouponFallbackFactory.selfCouponDetail`)→ 调用方拿 null 而 NPE 时先想"下游是不是挂了/降级了",别只盯调用方;错误文案是 fallback 拼的,不是下游原始报错,定位去看下游日志 ③**透传头只有 HTTP 请求线程才有**(FeignRequestInterceptor.apply 里 `ServletUtils.getRequest()` 非空才带 user_id/user_key/username/Authorization/page_domain/traceId/X-Forwarded-For)→ 定时任务/MQ 消费线程发起的 Feign **不带登录人**,下游操作人落"系统"是这类链路的常态不是 bug;且 **Authorization/traceId/X-Forwarded-For 同在 null 检查内,非 HTTP 线程的 Feign 全裸**——下游接口若移入鉴权链路,这类调用会整体断掉,属部署设计约束不是 bug ④PAGE_DOMAIN 跨 Feign:上游 `startAppletPage` 后下游**忽略自身请求参数**用头里的分页(见大分页配方)⑤Feign/ribbon 超时配置:repo yml/properties 与代码级(Request.Options/@Configuration 等)两层均搜不到(两层已核)→ 先让用户导 Nacos 配置;Nacos 也没有 ⇒ **按框架默认值**(feign/ribbon 各自默认),报告标注『未找到显式配置,按默认』——**不断言配置在哪,只记录查过哪几层**
  - **报告口径**:部署窗口前的跨服务行为**只留痕不做结论**;链头端到端全绿才算链路实证

### 第 4 步:报告

- **每条发现标「证据等级」**:〔实测〕(实发请求可复核)/〔源码推导〕(只读源码、本轮未或无法行为验证,**每条必须附"如何闭环"**,如"交用户跑 `keys 'login_tokens:*'` 观察")/〔实测·无判别力〕(请求发了但任何情况都返回同一形态,实测区分不了对错——这种**不进 PASS/FAIL 表**,单列)/〔实测·未取到结论〕(探测范围内未触发目标形态,如预算内没打到 504——记"没探到",不外推)。**标签只标事实行;任何"后果/推论/判据"行自带〔推演〕标签**,防后人把推论引成实测
- 终端给摘要:通过数/失败数、FAIL 明细(请求/响应/期望 vs 实际)、信息性发现
- 落盘 `<项目用例库>\reports\<日期>-<功能名>.md`(含:被测清单、用例结果表、发现、清理 SQL);**回归另建 `<日期>-<功能名>回归.md`,不覆盖首测报告**
- 可复跑用例沉淀 `<项目用例库>\cases\<功能名>.md`
- 测试中确认符合预期的产品行为,在报告中标注"已确认",不再挂待确认

### 第 5 步:Apifox 导入件(用户要跟前端对接时做)

**产出可直接拖进 Apifox 团队项目导入的 JSON**,流程:

1. 前提:本地服务在跑且跑的是**最新代码**(改过代码要重启;springfox 在 `GET http://127.0.0.1:<端口>/v2/api-docs`);**本地没跑时,测试服已部署最新版的话可直接拉测试网关源 `http://<被测网关地址>/<模块前缀>/v2/api-docs`**(2026-10-16 券包退款实证:免起本地服务,拉取无需 token;swagger 2.0 的 basePath 已含路由前缀,脚本 FETCH_PATH 相应带前缀即可)
2. **别手写 JSON**——从 live swagger 抽取,保证和代码零误差。现成模板:**本 skill 目录下 `apifox-fetch-template.js`**(自包含,已从仓库 claude-code/ 收编;node v22,复制改 **6 个常量**:OUT 文件名、PORT 服务端口、KEEP_PATH 路径正则、DROP 排除前端不接的接口、TAG 中文目录名、SUMMARY 中文摘要表);接口少时也可 node -e 内联一次
3. 生成件要求:接口面以**前端接口文档为准**(文档"本期不接"的排除);**没有文档时默认=本期新增+契约变更的接口,老接口一律不打包**——前端已接过的接口重导是噪音,导入面=对接工作量,不是 controller 全集(2026-10-16 反思:券包退款把同 controller 的老接口 select-order/export 整组带上,用户连问"我们什么时候要导出了"——别拿"覆盖导入无害"当借口);tag 归一个中文名目录(「xx相关操作接口」);summary 全中文对齐文档小节;walk $ref 收齐 definitions **无悬空 $ref**;结尾打印接口清单+悬空检查
4. 交付时说清三件事:①导入时 Apifox 选**覆盖**,并删掉同路径老接口(老契约过期,勿手改合并)②swagger 路径不带网关前缀,前端走网关要加模块路由前缀(如 station=/station,从历史报告/Nacos 查,与模块名不一定同),自测直连 `127.0.0.1:<端口>` ③直连本地要带测试环境 token
5. 代码改动后重跑脚本即刷新 JSON

注意:node 读 Git Bash 路径要写 `D:/...` 不认 `/d/...`(实测踩过);curl 落盘 swagger 后用 require 读落盘文件(实测稳),管道喂 stdin 没验过别赌。

## 自动化回归(机器可重放用例)

用例双轨:`cases/<功能名>.md`(人读,含背景/发现)+ `cases/<功能名>.json`(机器重放)。重放命令、断言表达式、token 传递、离线自测 mock 全部见 **[RUN-CASES.md](RUN-CASES.md)**(按需加载,平时不读)。

- 回归=一条命令:`node <skill目录>/run-cases.js cases/<功能名>.json --token <token> --out <报告片.md>`;`--filter TC01` 单跑失败用例
- 中文编码三坑由 runner 构造消灭(GET query 自动 UTF-8 编码、body 走 UTF-8 文件),不再是纪律约束
- 首测探索可用手工 curl,定稿后把用例同步进 .json——一次投入,回归白拿
- **用例库与 skill 的维护成本边界(防膨胀红线)**:cases 文件=新功能的一次性产出,老文件**零回写维护**(契约变了自然重测重写,不是修旧文件);配方只在**踩到新坑**时补一条并登记,没有实证支撑的条目一律不加;回归挑代表项不全量重跑——三者保证"库越厚回归越便宜",而不是"库越厚维护越重"
- 红线不松动:写接口进 .json 前仍须用户确认;高危接口(钱/退款/删存量/批量/模拟回调)不进 JSON;token 不写入文件

## 本机环境三坑(Git Bash + Python 2,必守)

1. **GET 中文参数**:手工 UTF-8 URL 编码后直接拼 URL。不要 `--data-urlencode` + shell 变量传中文(shell 传给 curl.exe 会变 GBK,服务端收到的长度/内容全错)
2. **POST JSON 中文 body**:用 Write 工具写 UTF-8 JSON 文件,`curl --data-binary @file` 发,**必须同时带 `-H "Content-Type: application/json"`**(--data-binary 默认按表单发,@RequestBody 收不到 → 415 假故障)。绝不 `-d '内联中文'`(GBK → 服务端 `Invalid UTF-8 start byte` → "系统繁忙"假故障)
3. **`python` 是 Python 2**:stdout 是 GBK;`open()` 无 encoding 参数(用 `io.open(path, encoding='utf-8')`);print 中文会 UnicodeEncodeError(只输出 ASCII/数字/布尔)。**处理响应文件优先用 grep/awk/cat,Python 只作备选**,别跟 Python 2 缠斗

误报教训:测试端编码炸出的"系统繁忙/参数过长"不是服务端 bug,先用日志(根 logs/)和纯 ASCII 请求排除工具因素,再定性。**排除编码后仍复现的判定规则:看 error.log 内容——日志里是缺必填参数/参数解析类异常=「已知既有机制」,归信息性;日志无异常痕迹且纯 ASCII 请求也复现=真 bug,进 FAIL 明细。**

## 红灯清单(每条都有真实翻车史,冒出这个念头即停)

| 念头/场景 | 正确动作 |
|-----------|---------|
| 401 了,再重试一次说不定就好 | 停:token 已死(Redis 会话有 TTL),要新 token;不带死 token 硬跑 |
| 这个域名/IP 不在白名单,先打一下看看 | 停:只允许 localhost 和测试网关 <被测网关地址>(实测地址见本地项目档案,勿入库),其他先问是什么环境 |
| 直连数据库查一下更快 | 停:AI 永不直连 DB,SQL 写好交用户执行 |
| 写接口直接发了,反正是测试库 | 停:写接口先过用户确认(插什么数据+附清理 SQL);钱/退款/删存量/批量/模拟回调必须明确点头 |
| curl 里内联中文省事 | 停:必炸 GBK;中文 body 走 Write 文件+--data-binary,GET 中文手工 URL 编码 |
| "系统繁忙"=服务端 bug | 停:先排除编码三坑(查项目根 logs/<服务名>/error.log+纯 ASCII 请求重试)再定性 |
| swagger 路径直接当网关 URL 用 | 停:网关 URL=网关+路由前缀+controller 路径,两层前缀别混(见第 1 步速查表) |

## 已测功能索引(回归时先查这里,再取 cases/ 用例)

| 功能 | 用例文件 | 特殊前提/注意 |
|------|---------|--------------|
| 高温计费多套规则+历史版本(模式示意,实证=2026-10-14) | `<项目用例库>\cases\<功能名>.md` | 本地服务直连;存量主记录 id=`<功能id>`;time_frames 不参与命中判断(compareTime 只看 date_frames),造"时段永不命中"的配置打标仍是"1";清理注意:更新过的配置 v2 行换新主键,先 history 拿现行行主键再 DELETE |
| 大分页/PageHelper 形态(模式示意,实证=2026-10-14) | `<项目用例库>\cases\<功能名>.md` | 网关场景;对象 `GET <网关>/<模块前缀>/列表接口`(测试库 total=`<total值>`,复跑会漂移别当固定断言);缺省 pageSize=50、无上限;越界 pageNum 返回最后一页;核心回归点=50/500 两档比 total;5 次预算用满,504 阈值未探到;run-cases.js 无长度断言故本组只有 .md |

其余已测功能(导出断言/会员端 token/真金回调 E2E 等)的回归指针与数据指纹存于本地全量版档案,不入发布包;本表仅保留 2 行作「模式示意」。

## 配方缺口登记表(场景×状态;实战踩到哪条,当场补配方并把状态改「已补」)

| 场景 | 状态 | 已补配方位置 |
|------|------|-------------|
| Excel 导出接口(@Excel readConverterExp/POI 验证) | 已补 | 本 skill 第 3 步「导出接口(xlsx)配方」(2026-10-14 充值订单导出实证:SXSSF inlineStr 分支/unzip 工具链/逐行映射断言/导出与列表口径陷阱) |
| applet 会员端接口(会员 token 获取路径) | 已补 | 本 skill 第 3 步「登录态」会员 token 条(含**自取路径**)与**会员 token 生命周期段** + 网关配方「白名单路由」条 + 第 4 步「证据等级」条(2026-10-14 applet 会员端实证:发码→登录→只读接口;口径=11 断言用例 10P/1F + 5 观察项 + 1 未执行动作步骤(A2 取码,非断言)——旧交付物"12 用例/11P"系把 A2 计入 PASS,勿引) |
| 大分页/504(PageHelper LIMIT 截断) | **部分实证**(形态已补,504 阈值未踩到;主目标待部署) | 本 skill 第 3 步「大分页/PageHelper 配方」(2026-10-14 `/order/charge/list` 5 档实测:缺省 50/无上限/reasonable 越界尾页/total 判据/ThreadLocal 泄漏/耗时非线性)。**未实证三件**:①网关 504 阈值(最大只打到 3.0MB/7.0s 未触发,要探需换更大表的单独预算);②主目标「券叠放 PageHelper 截断」在 member 模块**等部署**后用 total 判据复测;③泄漏需团队角色账号触发 |
| 跨模块 Feign 链路(一处改两处部署) | **已实证(测试服)**(2026-10-16 券包退款测试服 E2E:applet回调→station→pay 全链在真实双部署上跑通;本地联调另实证了「少服务 Feign 静默降级」+「Nacos 配置 key 缺失形态」;生产语境仍未踩,照清单执行) | 本 skill 第 3 步「跨模块 Feign 链路配方(双部署检查清单)」+三探①降级条+清单③配置缺失条 |
| 测试网关环境(非本地直连,网关+token) | 已补 | 本 skill 第 3 步「网关直连配方」(2026-10-14 高温计费回归实证:只读15条+写12条) |
| 状态机类功能(SQL 预置中间态+推进+终态守卫) | 已补 | 第 3 步「状态机类功能的测法」(2026-10-15 券包退款实证:7 态全链 13/13 绿,资损红线=复用单号逐字一致) |
| 第三方回调 URL 探活(Nacos 回调配置+路由段拼接) | 已补 | 第 3 步「第三方回调 URL 探活配方」(2026-10-16 券包退款实证:Nacos 配的回调 URL 缺 `/applet` 段,探活拦在真单前) |
| Apifox 第 5 步真实调用 | **部分实证**(2026-10-16 券包退款:网关源生成+用户导入 Apifox 成功;「前端按件真实对接」待前端反馈后回填) | 第 5 步(含网关源变体+导入面=对接工作量教训) |

## 已知既有机制(不算新功能的缺陷,报告归"信息性")

- HeaderInterceptor 尽力解析设计:无 token 直连可访问不取 LoginUser 的接口(生产靠网关 AuthFilter)
- 缺必填 @RequestParam → "系统繁忙,请稍后再试!"(全局异常处理器无专用 handler)
- PageDataInfo 分页 total 为 long,不能判 null
