# Android A1 原生接口与奖励独立验收

2026-09-13，F 独立验收。候选为 auth `1677d64`、Google 核心 `7a9d2ae`、事务修复 `f6b584b`、SSV/controller/module `db2187a`、签名尾参数兼容修复 `8c0d3d3`。相关前序报告：[登录](android-a1-auth-independent-review.md)、[Google 核心](android-a1-google-core-independent-review.md)。

## 结论

当前后端可继续合并和隔离联调。Google/AdMob 商业开关仍须关闭，不能把模拟 provider 响应、合成身份或开发设备绑定当作真实 Play 购买、RTDN 公网投递或 AdMob 奖励投递已经通过。

F 发现的 Google 最终 fence 丢失事务缺陷已修复并通过回滚及重试恢复。此次权限与奖励审阅未发现已复现的越权发放或重复发放缺陷。签名尾参数 URL 编码兼容性边界也已修复并通过独立正负回归。

## 独立验收范围

`android-commerce-independent.acceptance-spec.ts` 包含 7 条独立测试，运行真实 Nest controller/guard/OriginGuard、真实 Prisma 与随机隔离 PostgreSQL；ECDSA 使用独立生成的 P-256 密钥与真实 DER 签名。Google 购买响应与公开 key endpoint 响应由测试 transport 提供，没有调用广告/支付平台。

- 按实际 handler 校验 scope：commerce:read 不能买或创建/查询广告票据；admob:reward 不获得 catalog 权限。拒绝发生在 provider 请求或票据写入前。
- 他人 ticket/status、他人订单 cursor 不可读；自己的源 Web 会话退出后不能继续访问 commerce。
- 直接对官方 encoded-query 示例的明确 UTF-8 字节签名，真实 SPKI decoder 验证通过；若错误地对百分号编码原文签名则拒绝。额外验证 plus、百分号、Unicode 与转义 &。
- 实际 GET callback 保留 raw URL；8 个并发重复请求均正确应答且只有一笔 rewardEvent、一次余额增加。回调在 UI 到期且关闭新商业开关后，仍可兑现签名 earned 时间在窗口内的已观看奖励。
- 超过两端 60 秒偏差、秒级时间戳、重复安全参数、另一票据 secret 与当前 user alias 的错配均不能奖励。
- 提交他人的有效 Google token，返回 owner mismatch，不暴露 orderId，不把会员转给调用者；真实购买者可恢复验证，订单/权益只一份。既已 consumed 的 provider 记录不重复调用 consume。
- 同一已签名 transaction 在不同用户票据间并发，数据库只能提交一份 rewardEvent/余额/已兑换票据；另一路拒绝。

同用户重复回调幂等响应，以及跨用户冲突不重复记账均已覆盖。跨用户极端并发下的具体 HTTP 冲突码不在本次成功标准中；测试直接确认其事务失败及最终唯一账本。

## 官方签名语义与兼容性修复

官方 Tink verifier 使用 URI.getQuery()，对 query 百分号解码一次，保留 plus，然后取 signature 之前的 UTF-8 内容验证；key 缓存不超过 24 小时，代码使用 23 小时并在未知 key 时刷新。[AdMob SSV 指南](https://developers.google.com/admob/android/ssv)、[Tink verifier](https://github.com/tink-crypto/tink-java-apps/blob/main/rewardedads/src/main/java/com/google/crypto/tink/apps/rewardedads/RewardedAdsVerifier.java)

`db2187a` 对 signature/key_id 尾参数先按 raw query 的 base64url/数字正则匹配，因此带 `%3D` 编码 padding 或 percent-encoded key_id 值会先被拒绝，虽然 Tink 的完整 query 解码语义可接受它们。F 新增 `android-ssv-encoding.acceptance-spec.ts`，用真实带 padding 的 ECDSA 签名确认旧实现 1 条正例失败、2 条负例通过。

`8c0d3d3` 保持尾参数键名/顺序固定，值仅解码一次再严格校验。独立 3 条回归通过：合法 `%3D` 与 `%32` 变体成功；`%253D` / 双重编码 key 数字拒绝；编码分隔符、重复 key 与末尾多余参数仍拒绝。这是兼容性修复，没有放宽签名验证或奖励身份要求。

## 真机联调旁证与清理

E 报告平板完成两轮合成账户登录、native PKCE、Web 明确确认、HTTPS callback、native 保存 bearer；第二轮实际 catalog/entitlements 显示免费账户与额外任务 0，广告开关关闭时按钮不可用，随后解除绑定。

F 独立查询第二轮数据库确认：批准 `2026-09-13T00:51:34.145Z`，兑换 `00:51:34.624Z`，native revoked `00:52:20.844Z`；source Web 会话仍存在且匹配，Android 销售/广告数据库开关均 false，余额与预留均 0。时间以 SQL 明确 UTC 解释，避免 pg 对无时区 timestamp 按本机 JST 解码。

harness 没有保存访问日志，故不声称取得平板原始 HTTP 201/200 日志；该旁证由数据库终态与 E 的设备观察组成。E 完成后，F 对两轮服务都正常 SIGTERM，并用独立管理连接确认精确随机库已删除，state/cookie/lock 秘密文件已清理。临时反代与隧道的停止由主 Agent 管理。

## 验证结果

完整 F acceptance：22 suites / 124 tests PASS；独立新增文件 TypeScript 与 ESLint PASS；250 个文件的行数检查 PASS。此前 Google gateway 的签名/AEAD 两项作者单元测试也通过。尚缺真实 Play/AdMob 平台投递与购买许可测试，必须维持商业开关关闭直至各自阶段取得实际证据。
