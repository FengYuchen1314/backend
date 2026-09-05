# 二次开发进度

更新日期：2026-09-05。当前为开发分支检查点，尚未完成全部需求验收，不作为生产发布。

## 仓库与版本

主要修改沿用原项目的配置文件、入站、Host、Node 和订阅结构。前后端及 Agent 位于以下三个 fork；本轮不合并主分支，也不更新 `xboard-dev` 发布标签。

| 仓库 | 当前开发分支 | 本轮汇总前的已推送提交 |
| --- | --- | --- |
| [Backend](https://github.com/FengYuchen1314/backend/tree/wip/shared-443-backend) | `wip/shared-443-backend` | `4f38073e` |
| [Frontend](https://github.com/FengYuchen1314/frontend/tree/wip/shared-443-ui) | `wip/shared-443-ui` | `30f3792e` |
| [Node](https://github.com/FengYuchen1314/node/tree/wip/shared-443-node) | `wip/shared-443-node` | `0e8ae34f` |

三个工作区及早期 AnyTLS、编排工作树均无未提交改动，早期工作树的提交已经包含在对应主开发分支中。安装凭据、私钥、数据库备份和测试环境文件不随进度文档上传。

## 原始需求对照

| 需求 | 已有进度与证据 | 尚未完成 |
| --- | --- | --- |
| 面板内一键更新 | 已有按钮、状态 API 和独立 updater；实现固定镜像来源、升级兼容性检查、健康检查及回退逻辑。 | 完整部署环境中的点击更新、故障回退与恢复验收。 |
| Agent 文件全部从面板拉取 | 原版安装命令已在空镜像、无法访问镜像仓库的隔离环境中执行成功。Agent、HAProxy、Caddy 镜像均从面板获取并校验，之后真实 Agent 可用。 | 不把已通过的公网安装案例扩大为所有服务器类型、平台及升级路径均已验收。 |
| 限定创建协议并保留导入 | 已有两种 VLESS、加密 AnyTLS + ShadowTLS、Mieru TCP、SOCKS5 模板及受管过滤；保留外部导入。AnyTLS 已通过真实面板、Agent 和 Mihomo TCP 全链路。 | 全部协议的实际连接及组合回归，尤其混合 VLESS 与 AnyTLS。 |
| 服务器类型和协议提示 | 安装命令生成前选择公网、专线或家宽；真实界面确认专线仅列 Mieru、家宽仅列 SOCKS5，公网可选 AnyTLS。已有 SOCKS5 风险提示。 | 最终按截图核对所有提示与选择规则；当前公网模板不含 Mieru，需复核这一额外限制是否符合需求。 |
| 多节点共用 443、独立 SNI、网站反代 | 已实现混合 SNI 路由、冲突校验、反代管理、版本冲突保护和运行时回退。真实 AnyTLS 已经共享 443 入口传输；独立边缘测试验证网站 HTTPS 和 308 跳转。 | 两种 VLESS、AnyTLS、网站在同一服务器同时传输的完整验收；真实公网证书签发。独立边缘测试的代理接收端和私有测试 CA 不能替代这些验证。 |
| 七地区各三组非 Cloudflare 域名池 | 现有 21 个候选域名已从提供的单台大陆 VPS 完成两次探测，未观察到 Cloudflare CDN 信号；Cloudflare 负面对照被拒绝。后端和 Agent 已有多层排除与实时校验。 | 候选扩充为每地区三组独立池，完成探测证据接入及全路径复核。单一大陆网络的历史结果不能证明全国可用，也不能永久保证域名不切换 CDN。 |
| Mieru 国内入口与 IX 映射 | 一对一和手动 IX 端口模式已实现；真实浏览器创建、保存、重开、切换模式、无效端口拦截及面板重启保留均通过。Agent 的 Mieru 原生生命周期和计费另有实测。 | 国内入口实际端口转发与这套表单的联合端到端验收；表单不会自动修改外部路由器。 |
| 图形化链式代理与负载均衡 | 已有图形编辑、保存/发布、版本冲突处理、物理服务器回环校验和 Mihomo 订阅编译。原生客户端已验证 SOCKS5 链、多入口单出口及轮询场景。 | 多台真实服务器之间、不同协议组合的完整流量验证。现有容器回环测试不能替代跨物理服务器验收。 |

## 最近一轮实测

应用及原生程序均由 GitHub Actions 编译，未在本机或 VPS 编译。最新已验收面板镜像由 Backend `0b5125d12d4ddbaeacdd3d4a6fb93f2b9be158ce` 和 Frontend `1addfa954455333a236abb68d60575e6ed773540` 配套构建：

`ghcr.io/fengyuchen1314/backend@sha256:76f018cab44b52ac110e7fcd57d414362e0ab6f3825f53dbfb6546c9d729ef00`

- [配套镜像构建](https://github.com/FengYuchen1314/backend/actions/runs/33964860911)、[前端 CI](https://github.com/FengYuchen1314/frontend/actions/runs/33964516594) 和 [Agent 镜像构建](https://github.com/FengYuchen1314/node/actions/runs/33960252377) 均成功。前端这一版本通过 42 项测试、类型检查、改动文件 lint 和编译。
- 受管 AnyTLS 从原版安装命令、面板创建、真实 Mihomo 订阅到 TCP 传输均通过，内层证书固定校验与外层证书验证保持开启。
- 957 字节原始流量按 0.5 倍率记为 478 字节。Agent 容器实际重建后，状态卷、计费游标和累计值保留；新增请求后累计为 1,911 字节、计费 955 字节，重复轮询没有再次扣费。Node 倍率、历史流量和用户 API 也做了核对。
- 浏览器验证了 AnyTLS 创建、缺少字段和端口冲突拦截、配置结构校验、无效版本拒绝，以及编辑/撤销后的保存按钮状态。没有保存负面测试草稿。
- 面板升级前备份数据库；原有 2 个编排、5 个完整配置和 4 个 Host 经深度比较保持不变。界面测试仅新增 1 个独立 AnyTLS 配置，最终为 6 个配置。

这些检查仍不覆盖 UDP、突然断电下绝对无损的计费、所有协议组合或生产环境长期运行。前端全仓 lint 最近一次仍有 15 个错误和 11 个警告，属于未处理的其他组件，不能称为全仓检查通过。

## 测试环境与后续工作

测试始终使用隔离容器和专用目录。已结束的本轮安装测试容器、网络和专属数据卷均已清理，私有验收证据保留。现有 PDF、MMW 和代理服务未删除；最近验收时原有容器 ID 保持不变，PDF HTTP 返回 200。大陆探测未修改已有服务、端口或防火墙。

本次只汇总和上传进度，不继续功能开发。恢复开发时应优先完成混合协议共享 443、域名池、一键更新，以及跨物理服务器编排验收，再做逐项需求复核。

详细记录见 [AnyTLS 受管创建](docs/anytls-managed-creation.md)、[累计计费](docs/anytls-cumulative-accounting.md)、[面板升级和数据保留](docs/paired-wip-acceptance.md)、[面板文件分发](docs/panel-only-node-artifacts.md)、[订阅编排](docs/subscription-topology-publication.md)、[更新器边界](docs/updater-sidecar-contract.md)。早期文档中的未完成描述应结合后续带版本的验收记录阅读。
