# 阑珊处

一张会生长的知识地图。市面上的 AI 很多，这种一层层问到明白的方式却不多见。

在 Windows 和 macOS 上提出一个问题，先得到有来源、标明时效的答案，再顺着它替你想到的下一个问题一层层问下去，问到明白为止。

[下载](#安装) · [快速开始](#快速开始) · [从源码构建](#从源码构建)

![阑珊处的画布：左边是第一个问题的答案和价格走势图，右边展开了两个延伸问题的答案，再往右是可以继续点开的问题](docs/assets/overview.png)

## 主要功能

- **有来源的答案**：每次回答先联网检索、筛选来源，结论和要点都标出引用角标和最新信息的日期；点角标可以看到原文里对应的那几句。
- **替你提问**：每个答案后面列出几个值得继续问的问题，标明各自的角度；点开就继续检索、回答，在画布上长成一棵知识树。也可以在任意节点下自己追问。
- **从一句念头开始**：首页可以只写一个纠结或处境，比如“工作三年了，纠结要不要跳槽”，它会先拆出你其实在决定哪几件事，再一件件往下问。
- **合起来看**：多选几个节点，让它总结、找关联或进一步展开；整张地图可以一键生成总结。
- **数据看得见**：有可靠数据时，答案里会附带柱状图、走势图、时间线等小卡片。
- **带图提问**：可以附上最多 4 张图片，比如商品页截图，一起检索和回答。
- **越用越懂你**：在本机记下你常看的网站和关心的角度，用来调整检索和回答；随时可以在设置里查看、修改或关闭。

## 环境要求

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| Windows 10 / 11（x64） | `lanshanchu_<版本>_windows_x64-setup.exe` | 需要 WebView2，系统没有时安装程序会自动下载 |
| macOS 11 及以上（Apple 芯片与 Intel） | `lanshanchu_<版本>_darwin_universal.pkg` | 同一个安装包两种芯片都能用；未公证，首次打开可能要手动允许 |

使用前用 AudioFlow / 阑珊处账号登录；密钥只在服务端，客户端按月租套餐计额度。联网检索在产品里称「灯火搜索」。

## 安装

到本仓库的 Releases 下载对应平台的安装包。

### Windows

1. 运行 `-setup.exe`。安装包没有代码签名，SmartScreen 拦截时点“更多信息 → 仍要运行”。
2. **默认装到** `%LocalAppData%\LanshanChu`（ASCII 目录名）。自己选路径时，会装到「所选文件夹\LanshanChu」。窗口标题仍显示「阑珊处」。
3. **升级**：关闭应用后直接运行新安装包。向导若提示「已经安装」，选「直接覆盖安装（推荐）」（第二项；第一项「先卸载再安装」是 Tauri 默认勾选，一般不必用）。同版本再跑安装包时才是「重新安装 / 卸载」。若以前装在 `%LocalAppData%\阑珊处`，新版默认装到 `LanshanChu`；确认能用后再自行删掉旧文件夹即可。

### macOS

1. 打开 `.pkg`，按向导安装到「应用程序」（目录名为「阑珊处.app」；Windows 安装目录仍用 ASCII 的 `LanshanChu`）。需要 macOS 11 或更高。
2. 应用没有经过苹果公证。第一次打开被拦时：macOS 13 及以上到“系统设置 → 隐私与安全性”点“仍要打开”；macOS 11–12 在「应用程序」里按住 Control 点图标，选“打开”。若提示“已损坏”，在终端执行 `xattr -cr /Applications/阑珊处.app` 后再开。
3. **升级**：安装新版 `.pkg` 即可；若以前装过 `LanshanChu.app`，安装程序会先清掉旧目录，只保留「阑珊处」。

## 快速开始

1. 打开阑珊处，点右上角的齿轮进入“设置”，登录账号；确认套餐可用后即可提问。
2. 回到首页，输入一个问题，比如“为什么最近内存条突然涨价了？”，按回车。
3. 画布上会出现一张答案卡片：先是结论，然后是要点、来源和时效；卡片右边会出现几个延伸问题。点其中一个，它会接着检索回答，连成第二层。

点一下卡片可以在右侧打开详情，查看全部来源、检索过程和更详细的解释。地图会自动保存，回到首页能在“最近”里找到。

## 数据与隐私

- 账号与 AudioFlow（www.tgcsm.site）共用；密钥只在服务端，客户端登录后经平台转发。
- 你的问题、附图和检索到的资料会经平台转发用于大模型与灯火搜索；需要读全文时，应用会直接访问来源网页。
- 登录态、设置、历史地图和个人记忆都只保存在本机的应用数据里；历史地图不随账号上传。

## 已知限制

- 联网检索统一称灯火搜索，没有离线模式。
- 历史记录只在本机，不能跨设备同步；没有自动更新，新版本需要到 Releases 手动下载安装包覆盖。
- Windows 安装包没有代码签名，macOS 版没有经过苹果公证，首次运行需要手动放行。

## 问题反馈

使用中遇到问题或有建议，请到本仓库的 Issues 提交，最好附上操作步骤和界面上显示的错误信息（包括错误码与 RequestId）。

## 从源码构建

需要 Node.js 22.12 以上、Rust stable 和 [Tauri 2 的系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone <本仓库>
cd lanshanchu
npm ci
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run app:dev` | 以开发模式启动桌面应用 |
| `npm run app:ios` / `app:android` | 以开发模式启动 iOS / Android（需 Xcode + iOS Simulator Runtime / Android SDK+NDK） |
| `npm run app:ios:build` / `app:android:build` | 打包移动端；iOS 需在 Xcode → Settings → Platforms 安装 Simulator Runtime，并配置 `APPLE_DEVELOPMENT_TEAM` 或 `--no-sign` |
| `npm run dev` | 只启动前端；复制 `.env.example` 为 `.env` 后，浏览器里用示例数据调界面 |
| `npm run app:build` | 打包（本机默认 NSIS；macOS 另见下一行） |
| `npm run tauri -- build --bundles app` 后 `npm run app:pkg:mac` | macOS：先打 `.app`，再封成 `.pkg`（产物在 `bundle/pkg/`） |
| `npm run typecheck`、`npm test` | 类型检查与单元测试 |

推送 `v*` 标签时，GitHub Actions 会构建 Windows NSIS 与 macOS 通用 PKG 并上传到草稿 Release，见 [`.github/workflows/release.yml`](.github/workflows/release.yml)。安装路径相关约定：`productName` / 安装目录为 ASCII `LanshanChu`，界面标题与 Finder 显示名仍为「阑珊处」。
