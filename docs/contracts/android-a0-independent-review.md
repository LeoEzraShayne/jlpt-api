# F 独立 A0 契约审阅（2026-09-13）

审阅对象：A 的 `d4e2261` / `android-a0-commerce-proposal.md`，并核对当前 AuthSession、BillingEvent、订单和权益实现。结论：**整体方案可实施；冻结前必须纳入以下修正，不能原样保留“四表且不扩展现有表”的声明。** 本次仅文档审阅，没有修改业务实现、schema、生产或控制台，也不代表 Google Billing/广告已验收。

## 1. 绑定与退出

- 原生使用外部浏览器、固定 app-link callback、S256、一次性 code、state 核对和限 scope bearer 的方向正确。明确 code 使用 CSPRNG、hash-only；原生必须先匹配本地 pending binding 的 clientId/state，拒绝无对应请求的回调。exchange 事务消费 code 并核验来源 AuthSession，重复 approve 不能把已批准请求换属另一账号或延长 code 时效。
- `sourceSessionId` 必须明确指向 **AuthSession.id**，不是用户 ID、cookie hash 或客户端传入值。AndroidSessionGuard 每次检查来源 session 存在、未到期、且 `source.userId === androidSession.userId`；native 到期时间不晚于 source，到期重新绑定。建议来源关系删除级联，或保证删除后 guard 立即拒绝；不能只在 exchange 时验证一次。
- 当前 Web 登录回调能创建新 AuthSession；如果换账号只是覆盖 cookie，旧来源 session 仍存在，native 旧账号不会自动失效。因此锁定浏览器 logout/账号切换对原 cookie 对应 AuthSession 的撤销，或同一原子流程撤销其 AndroidSession。只撤销当前浏览器来源，不误登出其他设备。原生付款页显示绑定账号，切账号先完成旧绑定退出再新绑定。
- 明确批准后 code 截止 `min(requestCreatedAt+10min, approvedAt+60s)`，重复批准不延长；可加独立 `codeExpiresAt` 字段，或明确复用 expiresAt 的收紧语义。绑定/exchange 与来源退出竞态必须进入 A1 PostgreSQL/HTTP 验收。

## 2. RTDN 先到、未知 owner 与持久队列

`GooglePlayPurchase.userId`、`productId` 都需可空；首次 RTDN 可能没有本地 owner，voided 通知也不能假定携带完整产品资料。可信 Google 回查仍可能没有 obfuscated account；它本来就是购买时设置后才存在的可选字段，orderId/完成时间也不能在 pending 状态假定存在。[Google ProductPurchaseV2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2)

锁定以下接收不变量：验证 OIDC/package/envelope 后，一个事务写入 BillingEvent、按 package+tokenHash 唯一的 GooglePlayPurchase、版本化 AEAD token 密文，并把事件关联到该购买队列，**提交后才 200**。队列必须能在 `UNVERIFIED`/`AWAITING_OWNER`/`PENDING` 下恢复，不能用伪 userId 填必填字段；不能把明文 token 放 BillingEvent JSON 或错误日志。没有可信 owner 或未付款，不创建有金额的 PaymentOrder，也不发 grant、不 consume。

BillingEvent.googlePurchaseId 是 **非唯一外键/索引**：多条 paid/refund/重复投递事件关联同一个唯一 token 队列。收到新事件须使队列重新可调度，不能因上一次任务已处理而丢掉后续退款。队列失败次数、下次尝试、lease、错误和终态要持久化；不能仅存 RECEIVED 并200而无恢复路径。无 token 的合法 testNotification 可直接审计后标记完成。

可信 accountId 映射到 User 后才能原子 claim owner，客户端 body 不决定归属；已有 owner 永不改属。缺失/未知 accountId 的新 JLPT 订单保留人工可核查状态，不能自动归给当前提交 token 的用户。旧功过格商品保持 ignored/原权益，不默认映射为 JLPT。

## 3. 消费、旧 worker 与退款

`lockedAt` 单字段不足。购买队列至少增加随机 `leaseToken`、`leaseUntil`、单调本地 `revision`；claim 原子 CAS，所有完成/失败/重试写回必须带当前 token/revision。持久 grant 事务提交之后才能 consume；过期 worker 的响应不得覆盖新 owner、退款或新 claimant 的状态。消费超时重新查询 Google consumptionState 后恢复，不重复发权益；外部 consume 的结果不授权把已退款订单改回 PAID。

退款先到时，先持久保存 token 对应退款终态/tombstone，后续验证只补可信 owner/order 资料，不能先发 VIP 再等下一轮撤回。锁 User 与 purchase 的顺序在 HTTP、RTDN worker、consume worker 中一致，未知 owner 阶段不假造 User 锁。

退款金额具体锁定：仅累计 `orderHistory.partialRefundEvents` 中 `PROCESSED_SUCCESSFULLY` 的 `refundDetails.total`，币种必须等于原订单，使用精确 Money 整数转换；pending 不入账。每次从完整可信快照写累计退款，不能轮询一次 `+=` 一次，也不能用扣过税费的 developerRevenue 反推。整单 REFUNDED 时按原支付总额标记完全退款，避免将 full-refund 记录与先前 partial 再重复累加。部分金额退款按已批准规则保留权益。Google 提供 `lastEventTime`，不是一个通用 opaque revision；保留原 RFC3339 精度，不能误把本地毫秒时间当完整平台修订号。[Google Orders 与退款历史](https://developers.google.com/android-publisher/api-ref/rest/v3/orders)

本地终态不可回退：较旧 PROCESSED 快照不能复活撤销 grant，累计已确认退款不能因旧快照变小。API数据暂缺/权限错误保持可恢复异常，不能填零价或假完成。

## 4. SSV 验签、单位与迟到回调

- `timestamp` 明确为 **earned/reward 时刻的 Epoch 毫秒整数**；不是秒，不是广告开始时间，不靠示例数字长度自动猜单位。锁定允许的 clock skew，以及20分钟票据期限表示“最晚起播”还是“最晚完成”；如果是起播，须给已开始的广告明确完成 grace。以签名 earned time 判断资格，不能按回调抵达时间拒绝已合法观看的广告。
- SDK完整 adUnitId（`ca-app-pub-.../数字`）和 SSV `ad_unit` 数值标识必须有服务器 allowlist 映射。票据固定这对值，不能拿完整 SDK 字符串直接等于 SSV 数值字段；也不接受客户端自报任意 unit。固定 reward_amount=1 和具体 reward_item。
- 保持参数顺序，不经对象重排/二次解码；签名/key_id 的位置、重复key、非法编码必须严格验证。官方文字强调内容不能改写，而它链接的 Tink verifier 实际使用 `URI.getQuery()` 后的 UTF-8 数据，因此 Node 实现不能未经比对便把“原始编码”理解成 raw URL 字节。按官方向量及真实回调固定精确签名表示，覆盖 `%26`、`%2B`、`%25`、非ASCII和重复字段；`+` 不能被通用 form parser 擅自转空格。customData 用 base64url 减少歧义。[AdMob SSV 字段与验签](https://developers.google.com/admob/android/ssv)、[官方链接的 Tink verifier](https://github.com/tink-crypto/tink-java-apps/blob/main/rewardedads/src/main/java/com/google/crypto/tink/apps/rewardedads/RewardedAdsVerifier.java)
- UI显示 EXPIRED 不应永久关闭已合法 earned 的迟到 SSV；票据已兑状态、每票一次和 transaction 唯一性才是重复发奖边界。已观看后买会员或创建新票据，不丢失之前赚取的奖励。测试单位/票据/数据库不能增加 live 余额。

## 5. 票据丢响应：采用主 Agent 的最小修订

**同意移除“一用户最多一个未过期票据”。** hash-only secret 丢响应后，原规则会让 TICKET_RESTART_REQUIRED 与20分钟独占票据互相卡住；它也不是 SSV 防伪所必需的边界。

保留 `[userId,environment,requestKey]` 幂等、secretHash 唯一和创建限流。同 key 不重新发明 secret；客户端收到 restart-required 使用新 requestKey。旧票据仍可由其合法 SSV 兑现，每票最多一次、同 transaction 最多一次；新建空票据本身不发奖励。native 控制当前广告实例和 UI，不能通过“重建票据”撤销已经看完的旧广告奖励。无需为此新增表或“单活动票据”唯一约束。

## 6. 最小 schema 结论

采用主 Agent 已提出的 **5 张新表 + 小范围旧表扩展**：

| 对象 | 冻结时至少明确 |
|---|---|
| User | 随机、稳定、可空唯一 googlePlayAccountId |
| AndroidBindingRequest | hash/challenge/client/state、approved/consumed、收紧的code截止、user/sourceAuthSession归属 |
| AndroidSession | sourceAuthSession明确关联及索引、user、tokenHash、scopes、expires/revoked；删除/切账号失效语义 |
| GooglePlayPurchase | nullable owner/product、tokenHash唯一、版本化加密token、可恢复状态、nextAttempt/attempts、leaseToken/Until、revision、订单事件时间/退款终态证据 |
| RewardTicket | 原票据字段；完整SDK unit与SSV数值unit映射快照；不加单活动票据约束 |
| AndroidCommerceSyncState | package/environment唯一、成功watermark、当前固定查询窗口/分页游标、nextAttempt与fenced lease；只在相应处理成功后推进 |
| BillingEvent 扩展 | googlePurchaseId非唯一关系；对应的队列重调度保证。若以Purchase作为唯一worker队列，无需再复制一整套事件worker字段 |

voided扫描必须持久保存窗口/分页状态；崩溃可重扫靠幂等去重，不能用进程内水位声称不漏退款。不得把队列、分页和source-session约束仅留成“实现时处理”。以上锁定后可以进入 A1；F 后续针对真实实现独立复验，不因本提案通过而宣称实机支付/广告已可用。
