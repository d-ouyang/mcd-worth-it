# MCP 集成说明

本项目基于麦当劳中国官方 MCP Server 构建，实际编排 20 个工具，覆盖"账户 → 门店 → 菜单 → 核价 → 履约（自取/外送）→ 下单"完整链路。

## 使用的 MCP Server

| 项目 | 值 |
|---|---|
| Server | 麦当劳 MCP Server |
| 接入地址 | `https://mcp.mcd.cn` |
| 协议 | Streamable HTTP |
| 鉴权 | `Authorization: Bearer ${MCD_MCP_TOKEN}`（环境变量注入，勿硬编码） |
| Token 申请 | [open.mcd.cn/mcp](https://open.mcd.cn/mcp) |

## 使用的 Tools（20 个；标注 ✅ 的已真机验证，◻ 的已接入 SKILL 流程、演示中不下真单）

### 账户层

| Tool | 功能 | 在本项目中的用途 |
|---|---|---|
| `query-my-account` ✅ | 积分账户详情 | 积分余额 / 临期积分，兑换建议的输入 |
| `query-my-coupons` ✅ | 卡包券列表 | 券资产盘点（券自带可用时段，如"半价脆香油条 05:00–10:29"） |
| `available-coupons` ✅ | 可领取券（麦麦省） | "还有什么能领"，卡包为空时的降级路径 |
| `order-list` ✅ | 历史订单 | 办卡决策器的"过去 N 单本可省多少"；与 `frequent` 常点交叉验证 |

### 门店与时间层

| Tool | 功能 | 在本项目中的用途 |
|---|---|---|
| `now-time-info` ✅ | 服务器时间 | 档口判断的时钟基准 |
| `query-nearby-stores` ✅ | 门店搜索 | 定位门店，读取 `reservationTimeOptions` 档口时间 |
| `delivery-query-addresses` ✅ | 配送地址列表 | 外送履约入口；地址存本地 `data/profile.json` 复用 |
| `delivery-query-stores` ✅ | 地址可配送门店 | 外送链第二跳：地址 → 麦乐送门店（storeCode + beCode） |
| `delivery-create-address` ◻ | 创建配送地址（写操作） | 首次外送引导一次，之后免输 |

### 菜单层

| Tool | 功能 | 在本项目中的用途 |
|---|---|---|
| `query-meals` ✅ | 当档菜单 | 核心数据源：`discountType`（早餐卡/促销/麦金卡优惠）、`canWithOrder`（是否需随单购）、`frequent`（我的常点） |
| `query-meal-detail` ✅ | 餐品详情 | 套餐组成与特调（modification），核价入参 |
| `list-nutrition-foods` ◻ | 营养成分 | 可选维度：给"值不值"加营养参照 |

### 核价与优惠层

| Tool | 功能 | 在本项目中的用途 |
|---|---|---|
| `calculate-price` ✅ | 含优惠核价 | **全 Skill 的定价权威**：实付价、`discount` 优惠额（单位分）、`withOrder` 随单购核价 |
| `query-store-coupons` ✅ | 门店可用券 | 下单前的券匹配 |
| `auto-bind-coupons` ◻ | 领券（写操作） | 用户确认后执行 |

### 交易层

| Tool | 功能 | 在本项目中的用途 |
|---|---|---|
| `create-order` ◻ | 创建订单（写操作） | 用户逐项确认后下单 |
| `query-order` / `cancel-order` ◻ | 订单查询 / 取消 | 售后闭环 |
| `mall-points-products` ✅ | 积分商城商品池 | 派对商品池（`catRuleIds=1>6>20,1>6>21`）与积分兑换商品 |
| `mall-product-detail` ✅ | 积分商城商品详情 | 派对 spu 的 SKU 与规则（shopId=5 走派对链） |
| `party-order-create` ◻ | 派对下单（写操作） | 确认后创建主题派对/活动订单 |
| `query-party-city` / `query-party-store` / `query-party-store-date` / `query-party-store-session` ✅ | 派对城市→门店→日期→场次 | 主题派对 6 步钻取链，场次含余位与成团人数 |

## 调用流程

### 主线：这顿值不值

```
now-time-info ──► query-nearby-stores ──► query-meals(storeCode, orderType, beType [, reservationDate])
                                                │
                          ┌─────────────────────┼──────────────────────┐
                          ▼                     ▼                      ▼
              discountType≠null 的候选    frequent 我的常点      canWithOrder=true 商品
                          │                     │                      │
                          └──────► calculate-price ◄───────────────────┘
                                        │（withOrder 可选，核"持卡价"）
                                        ▼
                          唯一推荐 + 实付账本 ──(用户确认)──► create-order
```

### 支线：这张卡值不值（办卡决策器）

```
query-meals ──► 扫 canWithOrder=true + discountType=随单购*优惠 的商品
                     │（withOrder 内含 membershipCode / specId）
                     ▼
calculate-price(items + withOrder) ──► 持卡实付 vs 原价 vs 卡价
                     │
order-list（历史订单频次）────────────► "花 ¥X，N 单净省 ¥Y" → 值/不值
```

### 支线：履约（自取 vs 外送，双方案并行给账）

```
                    ┌─ 到店自取：create-order(orderType=1 [, reservationDate 预约])
核价候选 ──► calculate-price 对比 ──┤
                    └─ 麦乐送：delivery-query-addresses ──► delivery-query-stores(beType=2)
                              ──► query-meals(orderType=2, beCode) ──► calculate-price(orderType=2)
                                   ──(确认)──► create-order(orderType=2)

⚠️ 外送菜单与到店菜单是两套：麦金卡随单购支持外送（实测 9 个免配商品）；
   早餐卡价商品未见于外送菜单；外送单价可能更高——卡价省的钱要减去履约成本再谈值不值
```

### 支线：这件大事值不值（主题派对）

```
mall-points-products(catRuleIds=1>6>20,1>6>21) ──► 选 spu
  └─ mall-product-detail ──► query-party-city ──► query-party-store
       ──► query-party-store-date ──► query-party-store-session（余位/成团人数）
            ──► 总账（单价×人数）──(用户逐项确认)──► party-order-create
```

## 关键实测发现（2026-10-11，上海，门店 1450713）

1. **早餐卡定价规则可从数据反推**：组合类商品统一 6 折（如吉士蛋麦满分组合 12→7.2），麦咖啡中杯统一 ¥9.9。
2. **卡价跨档生效**：麦咖啡在午餐档仍按早餐卡价 ¥9.9 核价。
3. **早餐档硬截止**：门店档口约 06:14~10:15（因店而异），券时段 05:00~10:29——错过即已付权益损失，这是"档口提醒"功能的数据依据。
4. **随单购机制**：`canWithOrder=true` + `withOrder{membershipCode, specId}` 表示"未持卡，随单加购享价"；实测麦金卡体验卡（15 天）¥9.9，巨无霸四件套 58.5→32，单笔净省 16.6。
5. **菜单支持预约时段**：`query-meals` 传 `reservationDate` 可提前获取其他档菜单（如上午 10 点查明天早餐）。
6. **外送菜单实测**（2026-10-11，地址上海闵行，门店 1450192）：**麦金卡随单购支持外送**——外送菜单含"麦金卡专享"分类，9 个"麦金卡免配"单人餐/分享餐均为 `随单购麦金卡优惠`；**早餐卡价商品未在外送菜单出现**（同款咖啡外送走"促销优惠" ¥11.9 而非卡价 ¥9.9，早餐档外送待实测）；外送价可能高于到店价（同款芝士条 ¥11.9 vs 到店 ¥11），"值不值"必须合并履约成本计算。

## 数据边界（如实声明）

- **无卡状态接口**：35 个工具中没有任何一个返回"是否开通早餐卡 / 麦金卡"。本 Skill 的卡持有判断仅来自 `discountType` 是否在核价中生效、以及 `canWithOrder` 标记，所有结论表述为"按当前账号实付价计算"。
- **卡权益详情只能拿到"商品侧"**：可获取体验卡价格（¥9.9）、到店与外送两套菜单的全部卡价商品（即"持卡能省什么"的完整清单）及逐商品差价；**拿不到"条款侧"**——正式麦金卡的售价、有效期、官方权益文案均无接口。
- **卡有效期不可读**：由用户首次手动录入本地 `data/cards.json`（真实数据文件不入库，仓库仅含模板）。
- **历史订单样本有限**：`order-list` 仅返回近期订单，样本不足时 Skill 明示并回退到 `frequent` 常点。

## 业务价值

- **对用户**：把"买了权益用不满"变成"每一分钱都花在刀刃上"——每顿省 ¥5–12（月省 ¥150–300 的量级），办卡决策从拍脑袋变成一笔账。
- **对麦当劳**：① 实付账本提升早餐卡/麦金卡的使用率与续卡率；② 办卡决策器直接服务开卡转化（官方最想要的口径）；③ 派对链把低认知度的主题派对/亲子活动业务（客单价 ¥400–2000/场）接入对话式导购。
- **对生态**：验证了麦当劳 MCP 从只读查询到写操作（下单/领券/派对预订）的完整可用性，为后续 AI+本地生活场景提供参考实现。
