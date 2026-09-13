# Android A1 登录绑定独立验收

验收日期：2026-09-13。F 独立 worktree；实现来源 A `1677d64`，契约与迁移来源 `97a1498`。本提交只新增测试与报告。

## 结论

本地登录绑定阶段可进入主分支集成，未发现已复现的 release 阻断。此结论不代表 Android 商业开关可以启用：Google 购买/RTDN/退款、AdMob SSV、真实设备上的 OAuth/App Link 和平台签名验证仍须各自验收。

## 证据与范围

`android-auth-independent.acceptance-spec.ts` 使用真实 Nest controllers、SessionGuard、AndroidSessionGuard、生产模式 OriginGuard、ThrottlerGuard、ValidationPipe，以及独立随机 localhost PostgreSQL 数据库。身份仅经现有 AuthService 注入合成 Google profile；没有 OAuth、支付、广告网络请求，没有读取 `.env`，没有启动 AppModule 后台 worker。

新增 8 条独立验收：

- 批准必须同时具备 Web cookie 与正确 Origin；跨源、伪造同前缀域名、无 cookie 均失败，且数据库保持未批准。详情接口没有 cookie 时失败，只返回冻结的三项字段。
- DTO 白名单剥离客户端注入的 owner、sourceSession、approvedAt、scope 与 callback；回调固定为服务器来源。尾斜杠 POST 没有扩大 Origin 豁免；不存在的 PUT 路由返回 404，不产生写入。
- 错 verifier 和错误环境 client 不消耗有效 code；随后 8 个真实 HTTP exchange 并发只有 1 个成功，其余 7 个返回 401。数据库仅有一条 native session，code/bearer 不以明文持久化，scope 固定。
- native bearer 或放进 cookie 的 native token 均不能进入真实 `/me` Web 接口；Web cookie 不能授权 native logout。native logout 后 token 不再有效，原 Web cookie 仍有效。
- Web HTTP logout 使已批准但未兑换的 code 失效，不创建 native session；独立第二设备的 Web 会话仍有效。
- 近到期 binding 的 code 不越过 binding 到期时间，native token 不越过 sourceSession 到期时间；exchange 与 Web logout 并发结束后，任何可能成功返回的 token 都不能再通过认证。
- 运行期 false / 字符串 false 开关、环境错配、URL 编码后的生产数据库名称均 fail closed；只修改隔离测试 ConfigService，不连接所提供的生产样式 URL。
- 公开 binding 创建入口确实触发 429，限流拒绝请求不创建数据库记录。

A 自有 6 条真实 PG 测试同时复验，包括浏览器更换帐号撤销旧源会话、源用户错配、源过期、重复批准与 code 到期。F 不把这些作者测试计为独立新增覆盖。

## 仍需后续验证

`AndroidScopeRequired` 已定义，但当前只有不要求业务 scope 的 native logout 路由；须在真实 commerce handlers 到位后验证缺少 `google:purchase` / `admob:reward` 的 bearer 确实被拒绝。固定 callback `state` 的原样传递已验证，native 客户端拒绝不匹配 state 和 PKCE verifier 的行为必须由 Android 层验证。

当前没有物理 sourceSession 外键；测试证明已有 auth service/guard 的显式存在性、用户一致性、过期与行锁检查成立，不推论未来 commerce worker 自动具有这些保护。未知 owner 的 RTDN、token 加密队列、lease fencing、退款金额来源、SSV 签名和 earned timestamp 均不在此阶段成功结论之内。

## 验证结果

完整 F acceptance：16 suites / 89 tests PASS；独立测试 TypeScript 与 ESLint PASS；全项目 242 文件行数检查 PASS。原有 W3 与 activation 回归包含在完整运行内。

## 可复现命令

```sh
ACCEPTANCE_STATIC_SNAPSHOT=/Users/shen/Downloads/jlpt/.local/production-static-content-corrected-20260913.json ACCEPTANCE_ORIGINAL_STATIC_SNAPSHOT=/Users/shen/Downloads/jlpt/.local/production-static-content-with-catalog-20260913.json npx jest --config test/sentence-lab/jest.json --runInBand
npx tsc --noEmit -p test/sentence-lab/tsconfig.json
npx eslint test/sentence-lab/android-auth-independent.acceptance-spec.ts
npm run check:lines --silent
```
