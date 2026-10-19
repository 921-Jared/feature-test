# 跨模块 Feign 链路配方(双部署检查清单)

> **适用语境**:一次改动横跨多个微服务模块(api 契约 jar + 上/下游服务)——盘链、双部署核对、Feign 特有断言坑、静默降级
> **实证状态**:单项目(充电桩+mock 系统)实证——2026-10-15 读码成稿(锚例=applet 福利活动→station,当时未经真实双部署场景实证),2026-10-16 券包退款测试服 E2E 在真实双部署上跑通(applet回调→station→pay 全链);生产语境仍未踩;**非通用已验证**

## Feign 静默降级(三探①的完整实例,被调服务没起时先想这条)

2026-10-15 券包退款实证:member 9303 未启动,退款详情 phone=null 看似数据问题,日志实锤 `Load balancer does not contain an instance`;fallback 返 null/空与"查无数据"难分辨,**先查日志再定性**。→ 探活必须覆盖链上全部依赖服务,不止目标服务。

## 盘链(定位阶段读码 3 步)

1. 入口 Controller 找 `@Autowired RemoteXxxService`(定义在 `<下游> 模块的 api 契约 jar`,`@FeignClient(value = ServiceNameConstants.XXX_SERVICE)` = 下游服务名,常量表在 common-core 的 ServiceNameConstants)
2. Feign 方法上的 `@PostMapping` 路径=下游服务的 Controller 路径(不带网关前缀),去下游模块 grep 同路径找到 Controller→Service→Mapper
3. 核对调用方 pom 依赖 `<下游> 模块的 api 契约 jar` —— **api jar 是契约载体:接口/DTO 加字段后,所有依赖该 jar 的调用方服务都要重新打包部署**,否则新字段/新参数在 Feign 反序列化时**静默丢**(表现=字段缺失/参数没生效,像 bug 其实是部署不同步;eqTypes 那次 applet+station 不同发就是这类)。一条链可能多跳(applet→station→pay),逐跳盘完输出「服务×改动」矩阵

## 双部署核对(发第一个请求前)

1. 确认每个涉及服务的**全部实例**都已部署新版本〔实例数别按记忆断言——以 Nacos 服务列表/网关路由为准,让用户导一次;不止一台时逐台确认〕
2. DDL 先行
3. 新增 Nacos 配置 key 先配好(**缺失的失败形态=代码抛「xx不能为空」直达,先读代码确认兜底存在再定性是配置缺不是代码 bug**;key 名通常写在 properties 类注释里——实例 2026-10-15 station 券包退款:本地 Nacos 缺 `wechat-pay.default-entity`,存量单退款重试全部卡失败态,查配置=`curl "http://<nacos>/nacos/v1/cs/configs?dataId=<服务>-<profile>.yml&group=<group>&tenant=<namespace>"`)
4. 顺序原则:加法型改动(新接口/新字段/新配置)先后无所谓但**必须全**;改契约型(改字段含义/删字段)先双端兼容再切换;项目铁律=联动改动**同部署**,分批部署会丢中间数据
5. 验证顺序**从链尾往链头**:先直调下游(本地端口或网关)确认 provider 对,再从链头发端到端——错在哪一跳一眼分明

## Feign 特有断言坑(执行阶段)

1. 判 code 不判 data(`R.isError` 只看 code;AjaxResult 无 data 时 `getData()` 恒 null,别误报)
2. **fallback 形态不一**:FallbackFactory 里有的方法返 `R.fail("业务名:异常信息")`,有的**直接 return null**(实例:`RemoteCouponFallbackFactory.selfCouponDetail`)→ 调用方拿 null 而 NPE 时先想"下游是不是挂了/降级了",别只盯调用方;错误文案是 fallback 拼的,不是下游原始报错,定位去看下游日志
3. **透传头只有 HTTP 请求线程才有**(FeignRequestInterceptor.apply 里 `ServletUtils.getRequest()` 非空才带 user_id/user_key/username/Authorization/page_domain/traceId/X-Forwarded-For)→ 定时任务/MQ 消费线程发起的 Feign **不带登录人**,下游操作人落"系统"是这类链路的常态不是 bug;且 **Authorization/traceId/X-Forwarded-For 同在 null 检查内,非 HTTP 线程的 Feign 全裸**——下游接口若移入鉴权链路,这类调用会整体断掉,属部署设计约束不是 bug
4. PAGE_DOMAIN 跨 Feign:上游 `startAppletPage` 后下游**忽略自身请求参数**用头里的分页(见 [分页探测.md](分页探测.md) 跨 Feign 分页条)
5. Feign/ribbon 超时配置:repo yml/properties 与代码级(Request.Options/@Configuration 等)两层均搜不到(两层已核)→ 先让用户导 Nacos 配置;Nacos 也没有 ⇒ **按框架默认值**(feign/ribbon 各自默认),报告标注『未找到显式配置,按默认』——**不断言配置在哪,只记录查过哪几层**

## 报告口径

部署窗口前的跨服务行为**只留痕不做结论**;链头端到端全绿才算链路实证。
