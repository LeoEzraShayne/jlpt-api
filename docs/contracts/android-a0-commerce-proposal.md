# Android A0：账号、Google Billing 与 AdMob 协议提案

状态：**待主 Agent 锁定；不是已经实施的公共契约**。基于 main `504ab5d`，
仅写本文档，未修改 schema、API、控制台或生产。主 Agent 已报告 Web 正式启用，
`launchAt=2026-09-12T23:58:15.676Z`，截止`2026-12-11T23:58:15.676Z`；
Android 必须读数据库共享时间，不能另起90天。
继续遵循 approved-release-plan.md：TWA、一次购买、不自动续费、会员免广告、
普通学习不限量、广告一次增加一个可保留任务。保留旧功过格商品和历史订单。

## 1. 推荐锁定的方案

- 原生支付与广告使用独立、限 scope 的 bearer；不复制 HttpOnly Web cookie，不把
  原生 bearer 变成通用 Web 登录凭证。登录继续在浏览器完成。
- 浏览器已登录账户通过一次性、短时、S256 PKCE 绑定流程授权原生会话。原生页面
  显示当前账号；切账号先撤销旧会话，清除未提交 UI 状态，旧购买不可改属新账号。
- Google 两种产品（日票、年卡），年卡有常规价和一个带固定结束时间的首发 offer。
  原生显示 BillingClient 返回的真实地区价格；后台保存 Google Orders 成交金额。
- 复用现有会员、订单、事件与额度账本，只增加恢复、消费重试、绑定和奖励票据
  所需的持久状态。Google 服务账号、AdMob 验证和任何控制台配置均由主 Agent负责。

## 2. 最小数据库变更（主 Agent 所有）

建议 **4 张新表 + User 1 个可空唯一字段**，无需改已有会员/订单表字段。
以下是字段需求，不是可直接运行的 Prisma migration。

| 表/字段 | 必要数据及约束 |
| --- | --- |
| `User.googlePlayAccountId String? @unique` | 首次绑定时生成并持久化32字节随机opaque（base64url为43字符）。不依赖SESSION_SECRET或email，不从userId可预测派生。只返回给已绑定token；可反查 RTDN 的可信 obfuscated account，客户端不能自行设定。 |
| `AndroidBindingRequest` | `id`随机至少128bit；`codeHash @unique`可空；`codeChallenge`、`state`、固定枚举`clientId`；`userId?`、`sourceSessionId?`在浏览器确认时填写；`expiresAt`、`approvedAt?`、`consumedAt?`、`createdAt`。索引expiry。code仅存hash，绑定请求10分钟，批准后code最多60秒。 |
| `AndroidSession` | `id`、`userId`、`sourceSessionId`、`tokenHash @unique`、`scopes String[]`、`expiresAt`、`revokedAt?`、`createdAt`、`clientId`；索引user+expiry。建议短token60分钟且不晚于来源AuthSession；guard同时验证来源Web session仍存在有效，浏览器退出可撤销绑定。V1不加refresh-token系统，到期重新走绑定。 |
| `GooglePlayPurchase` | `id`、`packageName`、`environment`、`tokenHash`、`tokenCiphertext`、`userId`、`productId`、`purchaseOptionId?`、`offerId?`、`orderId? @unique`（本地PaymentOrder）、`googleOrderId?`、`state`、`consumeState`、`verifiedAt?`、`nextAttemptAt?`、`attempts`、`lockedAt?`、`errorCode?`、`createdAt`、`updatedAt`、`evidence Json?`。唯一`[packageName,tokenHash]`，不可用不同environment重复claim；索引state+nextAttemptAt。token使用独立版本化AEAD密钥加密，以便服务器恢复/消费；不放日志/普通JSON快照。 |
| `RewardTicket` | `id`、`userId`、`environment`、`requestKey`、`secretHash @unique`、`adUnitId`、`issuedAt`、`expiresAt`、`status`、`redeemedAt?`、`transactionId? @unique`；唯一`[userId,environment,requestKey]`、索引user+status。一个用户同环境最多一个未过期票据，用户锁内保证。 |

`PaymentOrder`：provider=`GOOGLE`；providerOrderId使用有命名空间的
`google:<environment>:<GPA-order-id>`；providerPaymentId使用
`google-token:<sha256(packageName+':'+token)>`。requestKey由服务端派生
`google:<tokenHash>`，不接受客户端金额/订单主键作为账本权威。币种沿用String，
amount沿用最小货币单位Int；币种小数位使用明确货币表，Money units/nanos用整数
运算，禁止把日元乘100或使用浮点舍入。超出Int/不支持币种应进入可恢复验证异常，
不能记录伪造零金额。Google原始Money、税、实际收入与优惠信息留在最小化snapshot。

`EntitlementGrant`复用`GOOGLE_LIVE/GOOGLE_TEST`和`order:<id>`唯一来源，期限仍
86400/31536000秒。`BillingEvent`复用provider/environment/eventId唯一键；
verified SSV可存`ADMOB`事件。`RewardEvent.provider`使用`ADMOB_LIVE/ADMOB_TEST`，
eventId为transaction_id；`QuotaAccount`不按环境分账，故**test事件绝不增加生产
rewardBalance**，测试奖励只在隔离测试数据库完整落账。

## 3. 浏览器与原生账号绑定

这是应用内部授权交换，借用原生应用外部浏览器+PKCE原则，不是新建Google OAuth
客户端、不宣称实现完整OAuth服务器。S256和外部浏览器原则见
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) 与
[RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)。

1. 原生生成随机state及43–128字符codeVerifier，把verifier保存在应用私有加密
   存储，生成base64url(SHA256(verifier))。POST binding request时不传userId。
2. API返回固定Web源的authorizationUrl。E用受信任Custom Tab/TWA打开；如果
   未登录，先走现有登录，回到绑定页。绑定页显示真实已登录账号和“用于应用付款
   与奖励”的范围，由用户按继续，防止后台静默把浏览器另一个账号绑定过去。
3. 仅浏览器cookie SessionGuard + OriginGuard可POST approve。服务端锁定请求，
   写user/sourceSession，产生一次性code，再返回固定HTTPS app-link callback。
   只允许release/test各自预注册clientId与固定callback，不接受任意redirect_uri。
4. 原生验证callback的HTTPS host/path和state，通过POST交换code+verifier。
   事务内检查hash、S256、clientId、60秒时效、未消费及来源session，消费code并
   创建AndroidSession。重放失败；交换响应丢失则重新绑定，不重发旧bearer。
5. token只在HTTPS response body交付；URL、网页JavaScript桥、日志和analytics
   不携带长期token。callback页面设置no-store/no-referrer，避免第三方资源。
   AndroidSessionGuard仅接受Authorization bearer，设置`req.currentUser.id`。

默认scope固定为`commerce:read`, `google:purchase`, `admob:reward`；客户端不能请求
管理员、学习写入或Stripe Checkout权限。可读会员摘要/本账号订单；Web学习仍使用
自身cookie。范围、来源会话失效、切账号和注销需做HTTP回归。包名或User-Agent不是
认证凭据；App Links/Digital Asset Links采用实际Google Play签名指纹。

## 4. 商品与90天切换

优先采用现代一次性商品模型：

| 权益 | productId | purchaseOptionId | offerId | USD基准 |
| --- | --- | --- | --- | ---: |
| 日票 | `jlpt_day_pass` | `buy` | null | 0.99 |
| 年卡常规 | `jlpt_year_pass` | `buy` | null | 99 |
| 年卡首发 | `jlpt_year_pass` | `buy` | `launch-64` | 64 |

年卡discountedOffer的endTime设为数据库launchAt+90天；Android上线较晚不补时长。
不设一次兑换限制，符合会员续购规则。Google支持discountedOffer开始/结束时间、
地区折扣配置及不限次兑换，见[官方offer资源](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers)。
E按productId/purchaseOptionId/offerId精确匹配返回的ProductDetails，并传其offerToken；
不可取列表第一个价格，见[多购买选项与offer](https://developer.android.com/google/play/billing/one-time-product-multi-purchase-options-offers)。

主Agent需在配置时验证：USD标准价99、首发实付64，Google自动换算的各地区报价
有效；offer使用折扣配置，不能假设每个地区简单套USD百分比就恰好等于自动换算64。
地区税/取整差异由Google报价和成交证据负责，不在客户端硬编码JPY金额。后端目录
仅返回可选IDs与期限；Google不可用或首发offer缺失时先刷新商品，不偷偷以99成交。

如果当前应用/控制台不支持这个模型，主Agent可以明确锁定替代的3 SKU方案
（额外`jlpt_year_pass_launch`）；必须同时安排截止时下架首发SKU并验证传播/缓存，
单靠隐藏客户端按钮不能保证停售。**本文不同时实施两套方案。**

PENDING于截止前创建、截止后付款的订单按Google实际accepted offer/price兑现；
不能因为回调晚到而收费后拒发权益。所有新目录在截止后只给常规offer。异常出现
截止后仍接受首发购买，应记录平台配置告警并兑现其已付款的365天，不篡改成交价。

## 5. Google 验证、消费、RTDN和退款

购买回传只提交token与productId提示。后端调用固定配置packageName下的
`purchases.productsv2.getproductpurchasev2`，校验真实product/option/offer、单件
quantity=1、PURCHASED、obfuscatedExternalAccountId与本账号持久值一致。
testPurchaseContext决定测试标记，与服务器环境不一致就拒发；客户端环境字段
无权切换。[Google购买证据字段](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2)。

然后以返回orderId调用`orders.get`：校验purchaseToken与产品，再记录Google成交
Money及退款状态；PENDING只记录恢复信息不发权益。Orders提供total、tax、历史和
退款状态，不能用当前目录价格代替历史成交价。
[Orders API](https://developers.google.com/android-publisher/api-ref/rest/v3/orders)。

取得可信证据后：锁User，再锁/创建唯一GooglePlayPurchase；若已有owner不同立即
409拒绝，不转移。事务内写PaymentOrder+grant+consumeState待消费。提交后调用
`purchases.products.consume`；消费成功再记完成。DB失败不消费，消费超时不撤销
已发权益；worker持久重试并重新查consumptionState，避免重复发放。Consumed token
若本地没有grant，只能凭完整可信历史证据恢复本账号，不能仅凭客户端“已消费”。
消费即满足此类商品确认；不能由客户端先consume导致后端丢失发放事务。
[消费方法](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/consume)、
[一次性购买生命周期](https://developer.android.com/google/play/billing/lifecycle/one-time)。

RTDN入口先验证Google OIDC签名、iss、exp、aud精确回调URL、email精确订阅服务账号、
email_verified=true；只解码JWT不算验证。再验证subscription完整资源名、messageId、
base64 JSON大小及packageName。[Pub/Sub认证](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)。
同一Google OIDC bearer可能合法用于多条消息，因此不能把JWT本身当作单次nonce。

RTDN只是状态刷新提示，事件唯一键=`<subscription>:<messageId>`，不凭通知type
直接发会员。验证后持久入BillingEvent再200，后台重查Google；失败持久重试/DLQ，
不在HTTP响应前长时间调用全部支付API。未知token由可信Google accountId查User；
未知旧功过格商品记录ignored，不发JLPT权益、更不能删旧权益。通知类型包含
oneTimeProductNotification、voidedPurchaseNotification和testNotification。
[RTDN结构](https://developer.android.com/google/play/billing/rtdn-reference)。

为覆盖漏通知，worker定时分页拉取voidedpurchases，按最近成功水位带重叠窗口，
每次处理成功才推进；重叠依赖幂等。API仅允许最近30天查询，故必须监测超过窗口
的停摆，不能声称永久自动找回任意旧退款。
[Voided API窗口](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list)。
全额退款撤销对应grant并重排剩余续购时长；单件部分金额退款沿用Web部分退款不
自动撤销全权益规则；quantity退款在单件模型等同整件撤销。不得从较旧状态复活
已撤销grant。定时worker用持久lease+重查修订号处理并发、旧事件和进程退出。

## 6. AdMob奖励

票据由认证原生会话请求；User锁内确认当前非会员、rewardsEnabled、服务器广告
环境与adUnit allowlist。生成32字节随机customData（数据库只存hash），20分钟内
可用于展示一次。返回票据ID、customData、无PII的ssvUserId和确切adUnitId。E加载
后、展示前设置SSV选项；会员不请求票据、不加载广告。客户端reward回调只显示
“奖励确认中”并查询票据，不改额度。

SSV采用Google公钥的ECDSA/SHA256/DER验签，最多缓存24小时；未知keyId刷新一次，
仍未知则拒绝。严格保留签名覆盖的参数顺序和编码，不能经对象重排；实现时用
官方verifier测试向量与真实sandbox回调交叉验证转义字节，拒绝重复key/歧义query。
验签通过后再解析custom_data、user_id、transaction_id、ad_unit、timestamp和奖励
信息。[AdMob SSV协议](https://developers.google.com/admob/android/ssv)。

项目规则：signed timestamp须落在票据有效展示窗口（允许极小明确clock skew），
回调到达可晚于expiresAt，不把延迟回调当成未观看。hash匹配票据、ssvUserId匹配
账号、adUnit匹配、reward_amount=1/reward_item约定值匹配；不信客户端reward值。
事务中锁User与票据，插入唯一RewardEvent并rewardBalance+1，再标记redeemed；重复
transaction或同票据不同transaction都不能重复奖励，已确认重放返回200。
奖励不得因用户看完后刚购买会员而消失；票据发放时非会员是展示准入依据。

测试SDK广告、SSV控制台测试工具只使用测试adUnit/测试票据/隔离数据库。SSV字段
没有通用可靠的isTest标记：**不能声称验签本身能区分生产展示与控制台构造测试**。
生产入口只接生产adUnit与live票据，测试入口绝不改live余额；不将生产票据粘到
测试工具。服务端测试参数/client build flag不能启用live发奖。主Agent启用正式
广告前需完成适用UMP同意流程和平台配置；失败/取消加载不扣免费任务。

## 7. 拟锁定的精确路由与DTO（均加 `/api/v1`）

所有业务JSON响应包`{data:...}`；错误`{error:{code,message}}`。native请求
Authorization Bearer，不接受body.userId；只信数据库/currentUser。字段拒绝未知。

| Method / route | Guard | 请求 → 响应data |
| --- | --- | --- |
| POST `/android/auth/bindings` | IP限流，非cookie写入 | `{clientId:'android-release'|'android-test',codeChallenge:string(S256,43 chars),state:string(32..128)}` → `{bindingId,authorizationUrl,expiresAt}` |
| POST `/android/auth/bindings/:id/approve` | Web SessionGuard+OriginGuard | `{}` → `{callbackUrl}`；code只存在固定HTTPS callback中，callback同时含state |
| POST `/android/auth/exchange` | IP+binding限流 | `{clientId,code,codeVerifier}` → `{accessToken,tokenType:'Bearer',expiresAt,scopes,user:{id,displayName},googlePlayAccountId}` |
| POST `/android/auth/logout` | AndroidSessionGuard | `{}` → `{loggedOut:true}`，仅撤销当前native session |
| GET `/android/commerce/catalog` | scope commerce:read | 无 → `{packageName,environment,salesEnabled,launchAt,launchEndsAt,products:[{productCode,productId,purchaseOptionId,offerId,durationSeconds,launchPrice}]}`；金额必须由BillingClient查 |
| GET `/android/commerce/entitlements` | scope commerce:read | 无 → 与现有MembershipSummary同结构，加`rewardsEnabled`；本scope不能直接访问普通Cookie端点 |
| GET `/android/commerce/orders` | scope commerce:read | cursor/limit → 本账号本环境OrderSummary分页，复用现有服务 |
| POST `/android/commerce/google/purchases/verify` | scope google:purchase | `{purchaseToken:string(1..8192),productId:string(1..200)}` → `{status:'PENDING'|'VERIFIED'|'REFUNDED',orderId:string|null,consumption:'PENDING'|'CONSUMED'|'NOT_APPLICABLE',membership:MembershipSummary}` |
| POST `/android/commerce/reward-tickets` | scope admob:reward | `{requestKey:UUID}` → `{ticketId,adUnitId,customData,ssvUserId,expiresAt}`；同key已发票据不能重发丢失secret，返回TICKET_RESTART_REQUIRED或本地缓存重用 |
| GET `/android/commerce/reward-tickets/:id` | scope admob:reward | 无 → `{status:'ISSUED'|'REDEEMED'|'EXPIRED',rewardBalance}`；仅票据owner |
| POST `/android/commerce/google/rtdn` | Google Pub/Sub OIDC | 原始wrapped Pub/Sub envelope；验证持久接收后200 `{received:true}` |
| GET `/android/commerce/admob/ssv` | 原始query验签 | Google协议query；验证/幂等事务成功后HTTP200，不走session/cookie guard |

Web绑定页拟为`https://jlpt.meritledger.org/android/link?bindingId=...`，原生回调拟为
`https://jlpt.meritledger.org/android/callback?code=...&state=...`。E需给固定test
callback对应方案，两个client不可互换；主Agent锁定关联文件与页面路由。不能用
任意returnTo拼接跳转，也不把购买token作为深链参数。原生restore通过
queryPurchasesAsync逐个调用verify，限流且并发不超过2；消耗后跨设备会员通过后端
摘要恢复，无需期待Google永久返回已消费购买。

## 8. A1验收与待主Agent决策

实现前锁定：四表字段、两个product+offer方案、固定clientId/callback、短时受限
native session、生产/测试广告与Google环境拓扑。原生与API共用UTC时间与ID。
E确认Billing库支持上述one-time offer选择，并先建立协议适配层，避免硬编码USD
展示和客户端消费。主Agent可以调整命名，但应一次同步A/B/E，勿并行各自发明DTO。

必须自动化并使用独立Postgres覆盖：code重放/错PKCE/错state/过期/来源退出、并发
绑定和账号切换；购买pending、错包/商品/账号、test→live、重复token、lost response、
DB提交与consume之间崩溃、消费超时重试、首发截止和晚到通知；RTDN坏OIDC/错aud/
错service account、重复/乱序、退款先到和漏通知；SSV真向量转义/重复query/未知公钥/
伪造签名、票据串用、同事件双投、同票据双事件、会员不展示、测试不改live余额。

实机/平台验收另外确认：真实Play签名安装、老包升级、正确登录账号、Google真实
地区价和支付UI、杀进程后恢复、SSV端到端、会员跨Web/Android、断网与取消不扣额。
没有这些证据时只能报告代码通过，不能报告已经能从Google Play正式购买或发广告。

主Agent补充的只读平台状态：AdMob账户已获批准，存在Merit Ledger Android应用
（内部ID5699026455），但首页仍提示链接商店后审核。此信息不是live广告就绪证明；
复用app/adUnit需主Agent继续核对。旧Play商品与订单按
`docs/contracts/android-readonly-preflight.md`保留原生命周期，不能将安装用户数
当作真实付费人数，也不把旧终身商品自动映射成本提案的日票/年卡。
