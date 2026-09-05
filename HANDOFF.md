# Remnawave 开发交接

更新时间：2026-09-06（Asia/Shanghai）。本次只整理交接、更新验证结果并推送开发分支，没有继续改应用代码、部署 VPS、合并主分支或更新发布标签。

原始目标是沿用 Remnawave 的结构完成定制功能；后续目标为“先把 bug 修好，再重写前端逻辑并改为 HeroUI”。功能主体已有实现和分项测试，整站迁移与完整端到端验收仍未完成。上一轮中断时正在分析会话替换后的弹窗清理问题，尚未落入任何新实现。交接开始时三个工作区均干净。

## 版本与验证

下表区分功能代码与文档提交。此次交接会产生新的文档提交，不改变列出的功能基线。

| 仓库                                                                             | 开发分支                 | 功能及文档基线                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [Frontend](https://github.com/FengYuchen1314/frontend/tree/wip/shared-443-ui)    | `wip/shared-443-ui`      | 功能代码 `97540c5efcb6ccb2f6379a7a25c9b86ee37655f1`                                                                |
| [Backend](https://github.com/FengYuchen1314/backend/tree/wip/shared-443-backend) | `wip/shared-443-backend` | 功能代码 `c5b9d397a7df46e766c61aa39c62e672e56b96cc`；本次交接前文档提交 `6df2a95b701b50daf76c2cc60625fa58076832c5` |
| [Node](https://github.com/FengYuchen1314/node/tree/wip/shared-443-node)          | `wip/shared-443-node`    | `0e8ae34f062733049891b3e1a62cc4050b0fd48b`，本次无改动                                                             |

Frontend `97540c5e` 的 [Actions 33981964861](https://github.com/FengYuchen1314/frontend/actions/runs/33981964861) 已成功。日志确认默认测试共 441 项：基础 87 通过、会话/认证/Vault/公共组件 151 通过、G0 202 通过和 1 项 TODO；合计 440 通过。TODO 的失败断言仍在日志中，它不计作通过。格式、全仓 lint、TypeScript 和应用编译均通过。

测试 VPS 运行的是更早的 Backend `41edfd055088110198534c9cbd864ede3d839c83` + Frontend `6c7933ca172eab7fe321fd74971528ddb09a0c43`。对应 [配套镜像 Actions 33980572760](https://github.com/FengYuchen1314/backend/actions/runs/33980572760) 已成功，当前镜像为：

```text
ghcr.io/fengyuchen1314/backend@sha256:661a863541cd53b3e128c4ca2d628bb564f862948e37472305f43900a7f23a5b
```

本轮只读检查确认容器运行中、旧面板容器保留且已停止、PDF HTTP 200。Frontend `97540c5e` 尚未生成对应的新配套面板镜像，也没有部署到 VPS。其 CI 成功不等于新界面经过浏览器验收。

## 原始需求进度

以下保留全部八项需求，不按当前已完成的代码缩小范围。已有测试的版本与限制可从末尾文档继续追溯。

| 需求                               | 已有实现或证据                                                                                                                           | 剩余工作                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 面板内一键更新                     | 按钮、状态 API、独立 updater、镜像来源限制、健康检查和回退逻辑                                                                           | 完整安装环境的点击更新、失败回退与恢复。当前隔离面板显示 updater 未配置，按钮禁用，不能算验收通过                                              |
| Agent 全部从面板取文件             | 空镜像、无法访问镜像仓库的隔离环境中运行过安装命令；Agent、HAProxy、Caddy 镜像由面板提供并校验                                           | 其他服务器类型、平台及升级路径的覆盖                                                                                                           |
| 限制创建协议、保留外部导入         | 两种 VLESS、真实加密 AnyTLS + ShadowTLS、Mieru TCP、SOCKS5 模板及受管过滤；保留外部导入。AnyTLS 已有真实面板→Agent→Mihomo TCP 全链路测试 | 全部协议组合回归，尤其混合 VLESS 与 AnyTLS；不得以取消加密换取客户端兼容                                                                       |
| 安装前选择服务器种类               | 公网、专线、家宽选择；专线只列 Mieru、家宽只列 SOCKS5，已有 SOCKS5 风险提示                                                              | 按截图核对所有限制与提示。当前公网模板额外排除 Mieru，需修正或向用户核实，不能视为原始要求                                                     |
| 多节点共享 443、独立 SNI、网站反代 | SNI 路由、重复冲突校验、反代管理、版本冲突保护、运行时回退；AnyTLS 走过共享 443。独立边缘测试覆盖网站 HTTPS 与 308 跳转                  | 同一服务器上两种 VLESS、AnyTLS、网站同时传输；真实公网证书。私有测试 CA 和替代接收端不能替代完整验收                                           |
| 七地区各三组域名池                 | 21 个候选域名曾从用户提供的单台大陆 VPS 探测两次，未观察到 Cloudflare CDN 信号；有负面对照及后端/Agent 多层校验                          | 洛杉矶、圣何塞、东京、新加坡、德国、英国、荷兰各至少三组独立池。21 个单独候选域名不等于 21 组池；继续接入证据、复查创建/导入/编辑/启动所有路径 |
| Mieru 国内入口与 IX                | 国内入口 IP/端口、一对一或手动 IX 模式、提示和校验；创建、保存、重开、模式切换及重启保留有浏览器证据。原生 Agent 生命周期和计费也有实测  | 国内入口实际端口转发与配置的联合端到端验收；表单不会自动修改外部路由器                                                                         |
| 图形化链式代理与负载均衡           | 图形编辑、保存/发布、版本冲突、物理服务器回环校验、Mihomo 订阅编译；真实客户端验证过 SOCKS5 链、多入口单出口及轮询                       | 多台物理服务器、不同协议组合的完整流量测试，不能以容器内回环测试代替                                                                           |

客户端仅考虑 Clash Verge/Mihomo。所有伪装域名禁止使用 Cloudflare CDN；仅使用 Cloudflare 权威 DNS 不等于使用其 CDN。单台大陆网络的历史探测不保证全国可用、永久不被拦截或未来不切换 CDN。

## HeroUI 迁移范围

已接入固定版本 HeroUI 3.2.4、Tailwind CSS 4.3.3、React Hook Form 7.87.0 和 Zod resolver 5.9.1。保留 `app/pages/widgets/features/entities/shared` 分层、URL、API 契约、React Query 服务端状态及 Zustand 偏好/会话逻辑。认证、请求归属、Vault 持久化和部分表单/列表的 bug 修复已有独立回归。

当前已迁移认证及回调、快捷打开/实体深链、错误/加载/连接状态、主题语言接线、桌面/移动导航、快捷启动器、页头工具、版本/更新确认、Prime/Recap、PageHeader，以及 M01 帮助、M02 重命名、M03 标签、M04 通用创建、M05 JSON、M06 Base64、M07 快捷链接。Monaco、JSON schema/修复、Base64 双栏及伪全屏均保留。

完整清单是 [30 个页面与 55 个注册弹层](https://github.com/FengYuchen1314/frontend/blob/97540c5efcb6ccb2f6379a7a25c9b86ee37655f1/docs/heroui-migration-scope.md)，还包括页面内动态/受控弹层。大量业务页面、表格、图表和弹窗仍使用 Mantine；provider、CSS、PostCSS 和依赖尚未移除。通用外壳迁移不能当作内部业务页面迁移完成，G0 和整站重写都不能标为完成。

接续时保留分页、筛选、排序、跨页选择、批量动作、列与偏好持久化、拖放、虚拟列表、图表钻取、Monaco、终端、Passkey 和 SSH Vault 加密核心。先拆清草稿、校验、请求及工作流，再接 HeroUI 原生组件；不要制作一套只转发 Mantine props 的兼容层。

## 已知问题与入口

优先修复会话替换后的全局弹窗清理。已存在的提交归属保护只阻止部分旧操作生效，未统一清理旧 NiceModal 状态及等待中的 Promise。

| 问题                                          | 代码入口或证据                                                                                                                                                                                                        | 接手时需要覆盖                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| token A→B 不经 logout，旧弹窗状态仍保留       | Frontend `src/shared/_modals/nice-modal-auto-close.tsx` 仅订阅 logout；`src/shared/_modals/nice-modal-session.regression.test.ts` 是 TODO 复现；Provider 位于 `src/shared/hocs/error-boundary/error-boundary-hoc.tsx` | 首次挂载前/已显示/正在退出的弹窗；旧 show/hide Promise 结算；新账号同 ID 弹窗不被误删；匿名重复退出、卸载和 StrictMode。TODO 当前只实证首次挂载前的待显示状态 |
| 同 args、同 React 批次 hide→show 不能区分身份 | `src/shared/_modals/use-hero-modal/modal-presentation.ts`、`modal-lifecycle.ts`、`use-hero-modal.tsx`                                                                                                                 | 同实体同对象重开、新 args 重开、退出动画迟到回调、旧表单草稿与请求归属                                                                                        |
| 新编辑器文案未全部本地化                      | JSON/Base64 modal、`src/shared/ui/code-editor/`                                                                                                                                                                       | 加载、Schema 重试、保存失败和修复提示的英/中/俄/波斯语；现有部分文案仍为英文                                                                                  |
| 外链与快速键盘重开修复尚未在新镜像复验        | `src/app/layouts/dashboard/main-layout/dashboard-routing.tsx`、`navbar/desktop-navigation.layout.tsx`                                                                                                                 | 完整外部 URL、内部 basename/相对路径、ArrowUp/Down、快速 Escape→重开、焦点进入/恢复                                                                           |

上一轮只有分析，没有创建 SessionModalProvider、控制型 reducer 或新的会话模型。不要从对话中的设计讨论推断实现已经存在，也没有必须沿用的既定方案。

已核对的接线与风险：

- `src/shared/api/axios.ts` 导出 `subscribeSessionChanges` 和 `getSessionGeneration`；会话权限使用代次，不能只比较是否已登录。
- 全局注册在 `modal-registry.ts`；应用主动打开通过 `show-modal.ts`，NiceModal 自身首次显示也会调用其内部 show。现有源码未发现额外的 ModalDef/ModalHolder/defaultVisible 路径。
- 已安装 NiceModal 的 `getModal(id)` 返回组件，不返回 handler。`remove()` 不会自动 resolve 等待中的 Promise；`hide()` 也会移除 show 的回调登记。使用实际库 API 验证结算顺序，不读写私有 callback 表。
- 简单给整个 Provider 加 session key 可能丢掉新会话在 React commit 前发出的 show。清理旧状态、接收新命令及订阅顺序需要一起测试。
- 旧业务弹层还使用 `use-nice-modal.tsx`；其退出回调直接 remove。检查迟到回调是否会误操作新会话或新一轮同名弹窗。

## 测试与编译方式

本机与 VPS 不编译应用或原生程序。应用编译、后端契约打包和多架构镜像都使用 GitHub Actions。本机可运行单测、SSR/模型回归、类型检查、lint、格式检查；这些证据不替代浏览器或真实网络验收。

在 Frontend 目录运行：

```powershell
npm test
npm run typecheck
npm run lint
```

`npm test` 已包含 `test:api` 和 `test:g0`，不要遗漏 TODO 或只运行新文件。新增内容的改动文件需执行 oxfmt 检查，提交前执行 `git diff --check`。当前工作区依赖已安装，不必无故重装。

从干净克隆接手时，`npm ci` 安装到的公开 Backend contract 不能替代 fork 契约。前端工作流固定契约源码为 `2b2cebc4d86441405710cb39705c61bbbc7b55c4`；下载前端 CI 的 `pinned-backend-contract` artifact，将内含 `.tgz` 用 `npm install --no-save --no-package-lock --ignore-scripts` 装入本机，再运行检查。契约也不能在本机临时编译。

Frontend 推送 `wip/**` 会触发 `xboard-ci.yml`。配套面板镜像使用 Backend `xboard-image.yml` 的 `frontend_commit` 输入；不提供输入会解析 `xboard-dev`，可能配错前端。恢复开发并准备验证当前功能检查点时，可明确指定：

```powershell
gh workflow run xboard-image.yml --repo FengYuchen1314/backend --ref wip/shared-443-backend -f frontend_commit=97540c5efcb6ccb2f6379a7a25c9b86ee37655f1
```

此命令是后续操作示例，本次未执行。继续修复后应换成通过 CI 的新前端 SHA，并记录本次任务实际解析的 Backend SHA。工作流同一后端分支开启 cancel-in-progress；先确认是否已有任务运行，观测超时不能当作任务停止。部署前核对精确 commit 配对、镜像元数据和 digest，不使用可变标签猜版本。

## 测试环境与数据

海外 VPS 用于隔离面板、Agent 和流量测试，大陆 VPS 用于域名探测。两台机器本轮均通过严格主机密钥校验下的 SSH 连接。IP、SSH 主机指纹、隔离目录、回退容器和私有证据位置记录在本机 `HANDOFF_ENVIRONMENT_2026-09-06.md` 附录，不上传公开仓库；附录也不含私钥、密码或 token。

仅操作已经确认归属的隔离容器、网络和目录。当前 PDF、MMW 及其他代理服务应保留；历史提到可删除的服务不能视为本次清理授权。测试不新增公网端口、不修改防火墙、不扩大主机权限。用户已允许在一次性测试面板接受原项目许可，历史授权不涵盖其他服务或新的协议。

上次升级先保存数据库备份，再比较 2 个编排、6 个完整配置、4 个 Host 及订阅设置，内容未变；其他运行中容器 ID 未变。本轮没有重跑全部数据快照比较，只复查了容器、备份基线存在和 PDF 200。已有浏览器证据限于旧镜像版本信息弹窗的部分焦点循环、Escape 关闭/恢复，以及发现的导航问题。

后续升级前重新备份并核对数据基线。浏览器写入测试仅改隔离测试记录，结束后恢复并深度比较。现有脚本能保留旧容器并尝试恢复面板容器，不代表任意数据库迁移都可以自动回滚；恢复数据库前另行确认迁移兼容性和精确备份。

## 接续顺序

恢复工作时先读本文件与对应功能清单，并重新检查 git 状态、远端 SHA、Actions 和 VPS。不要把文档记录代替当前外部状态。

1. 修复上述会话弹窗 TODO，并覆盖 Promise 结算、新会话同 ID、同批次重开及旧退出回调。先保留失败复现，再实现；确认测试范围足够后移除 TODO 标记。
2. 运行完整检查并推送前端，等待指定 SHA 的 Actions 成功；通过 Backend 手动工作流生成精确配套镜像。
3. 备份并升级隔离面板，验证外链/键盘重开、M01–M07、创建后的业务抽屉、Monaco worker/schema、双栏/全屏、移动端/RTL/主题、保存失败重试和多账号竞态。检查保留的数据和其他服务。
4. 按完整迁移清单继续业务页面、复杂表格、图表和其余弹层；补齐四语及测试，最后移除 Mantine 相关依赖和构建样式配置。
5. 补齐原始八项需求的剩余网络与故障恢复验收，逐项记录版本、输入、结果和限制。所有需求都有相称证据后才能宣布完成。

本次交接没有启动新的构建/部署或后台监控。此前目标仍未完成；需要停止或恢复长期任务时，以用户当前指令为准。

## 相关记录

主进度见 [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md)，前端实现详情见 [HeroUI 检查点](https://github.com/FengYuchen1314/frontend/blob/97540c5efcb6ccb2f6379a7a25c9b86ee37655f1/docs/heroui-g0-checkpoint.md) 及 [完整迁移范围](https://github.com/FengYuchen1314/frontend/blob/97540c5efcb6ccb2f6379a7a25c9b86ee37655f1/docs/heroui-migration-scope.md)。这些文件保留了多批历史记录，旧段落中的“当前”仅指其当时版本。

分项证据包括 [AnyTLS 创建](docs/anytls-managed-creation.md)、[累计计费](docs/anytls-cumulative-accounting.md)、[面板与数据保留](docs/paired-wip-acceptance.md)、[面板供给 Agent](docs/panel-only-node-artifacts.md)、[订阅编排](docs/subscription-topology-publication.md)、[更新器边界](docs/updater-sidecar-contract.md)，以及前端的 [bugfix 浏览器验收](https://github.com/FengYuchen1314/frontend/blob/97540c5efcb6ccb2f6379a7a25c9b86ee37655f1/docs/bugfix-browser-acceptance.md)。
