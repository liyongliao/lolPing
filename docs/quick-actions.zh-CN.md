> v0.6.0 新增：快速截图默认开启，高级标注 / 离线 OCR / 滚动截图按需加载；执行记录默认收起、最近 3 次；左右键可分别选择房间同步与快捷规则生效范围。

# lolPing 快捷增强版

以 [darrenprx/lolPing](https://github.com/darrenprx/lolPing) v0.5.1 为基础，来源提交 `f24a51e5a11c2b31dab72d89a571cc4025ad3c98`。保留原版名字、设置页、轮盘、表情、房间、动画、音效与原生输入。只维护 macOS Apple Silicon 和 Windows x64，与此上游版本的构建目标一致。

## 使用

1. 打开 lolPing 的设置，选择「快捷动作」。首次运行默认简体中文；已有设置保持原语言，可在「应用」中切换。
2. 编辑「协助三次，打开应用」或「问号两次，打开应用」，选择 Mac 的 `.app` 或 Windows 的 `.exe`，开启规则并保存。
3. 按原版操作：按住 Option（Windows 为 Alt）并拖动鼠标，在轮盘中选择信号。连续发出指定次数后执行动作。也支持原版触发键单击所发的信号。
4. 可添加最多 50 条规则，自定义信号、次数（1–10 次）、相邻信号最大间隔（0.5–10 秒）、动作冷却（1–60 秒）。支持打开应用、打开 http/https 网址、复制文本和截图。

默认三个模板都关闭；选择目标并开启后才执行。发送其他信号、表情、暂停或截图会中断连发计数。冷却期间不累计次数。设置改变会重新开始计数。同一信号可以配置多条规则。设置中的预览和房间成员发送的信号不会触发本机动作。

## 截图

- 默认快捷键：Mac `⌘⇧2`，Windows `Ctrl+Shift+2`；设置里可修改，留空关闭。
- 区域截图：拖动框选，松开即写入图片剪贴板；Esc 或右键取消。
- 全屏截图：截取鼠标所在显示器，自动写入剪贴板。
- 可选「截图同时保存为 PNG」，文件写入系统图片目录下的 `lolPing` 文件夹。
- 截图期间自动隐藏本应用设置、轮盘和信号，结束后恢复。
- Mac 首次使用轮盘需授予辅助功能权限，首次截图需允许屏幕录制并按系统要求重启应用；权限入口和说明沿用原版。

快捷键注册失败会显示提示，修改时冲突会保留旧快捷键和设置。截图快捷键不能与原版暂停键相同。「最近执行记录」仅在本次运行内保留，最多 30 条。

## 构建与检查

推荐使用 Node.js 22 或 24。安装依赖后构建对应平台原生 helper：

```sh
npm ci
npm run test:helper
npm run typecheck
npm test
npx install-electron
npm run test:e2e
```

Mac（Apple Silicon）：`npm run dist:mac`，产物为 `release/lolPing-0.5.1-arm64.dmg`。

Windows（x64，在 Windows 上执行）：`npm run dist`，产物为 `release/lolPing-Setup-0.5.1.exe`。GitHub Actions 的 CI 在 Windows 上测试并生成安装包，在 Mac 上保留原版构建与签名校验。增强版仓库为 [liyongliao/lolPing](https://github.com/liyongliao/lolPing)。推送到 main 或 codex/* 分支会自动构建，也可在 Actions → CI → Run workflow 手动运行。通过测试后下载 `lolPing-windows-x64` artifact，其中包含安装 EXE、SHA-256 校验文件和构建来源。Windows 工作流先静默安装生成的 EXE，再针对实际安装目录运行桌面测试。

本机验证：macOS arm64，类型检查通过；731 项 TypeScript 测试通过、1 项上游测试跳过；411 项原生 C++ 检查通过；5 项 Electron 桌面流程测试通过。桌面测试覆盖创建规则与重启持久化、连发阈值与冷却、预览/远程信号隔离、原轮盘松手选中到动作执行、真实窗口框选/剪贴板/取消、无效配置和快捷键冲突。截图测试使用合成图像替代屏幕采集，避免读取个人屏幕内容，不代表已完成系统录屏权限验证。macOS 安装包的五项桌面测试也已全部通过，应用包通过 ad-hoc 签名校验。Windows 已在 GitHub 托管的 Windows runner 上完成安装及桌面自动化验证，详见下方构建记录；尚未在用户自己的 Windows 电脑上验收。

## 来源与维护

- 原版 `assets` 的 180 个文件逐个 SHA-256 对比一致：26 个纹理文件、22 个音频文件、132 个表情文件。
- 原版 `src/renderer/overlay` 的 9 个文件和 `native/hook-helper/src` 的 16 个文件保持不变。
- 原项目 MIT 许可证与原作者署名保留。英雄联盟美术与音频的版权归 Riot Games；上游的素材声明仍保留于 README。
- 本增强版暂停连接上游自动更新，避免安装原版后丢失新增功能；维护者设立自己的发行渠道后可重新接入。README 中的下载链接指向本增强版仓库的 Release。
- 设置继续使用原版 lolPing 目录并兼容旧配置，新增 `quickActions` 字段。桌面测试使用临时目录，并在结束时还原剪贴板。
- 前一版独立设计已备份至工作区同级 `lolping-lingxi-backup-20261013`，当前代码不再使用其界面或素材。


## Windows 自动化验收

CI 使用 GitHub 托管的 Windows runner，保留测试报告、失败追踪和界面截图。

- 原有五项桌面测试针对安装后的 `lolPing.exe` 执行。
- 通过 Windows 原生键鼠输入发送 Alt + 拖动：连续三次协助，验证文本进入系统剪贴板。
- 连续两次问号，实际启动路径包含中文和空格的测试 EXE，并检查它写出的启动标记。测试程序只写入测试临时目录。
- 通过系统全局 Ctrl + Shift + 2 唤起截图，使用真实桌面采集、框选和系统图片剪贴板验证截图结果。
- 仅在完整测试成功后上传安装包；失败时仍上传测试报告用于定位。

Windows 专用测试在 macOS 上跳过。上述是自动化验收范围；具体运行结果以对应提交的 Actions 记录为准。


## 已验证的 Windows 构建（2026-10-13）

- [GitHub Actions 成功记录](https://github.com/liyongliao/lolPing/actions/runs/38346542320)
- 构建提交：`6e0cbca9f8dddab55a429f0a87050041c489eddf`，分支 `codex/windows-shortcuts`。
- Windows x64 安装包已在 runner 上实际安装，随后对安装目录内的程序执行测试。
- 411 项原生模块检查、732 项 TypeScript 测试、7 项 Electron 桌面测试全部通过。
- 原生输入验收使用 Windows 系统输入事件操作轮盘，实际启动了中文和空格路径下的测试 EXE；截图验收使用真实桌面采集和图片剪贴板。
- 产物：`lolPing-windows-x64`（EXE、SHA256SUMS.txt、BUILD-INFO.txt）；报告：`windows-shortcut-test-results`。
- 同一提交的 macOS 构建和签名检查也通过。安装包 artifact 保留 30 天，测试报告保留 14 天；到期后可重新运行构建。

首次验收修复了测试脚本对 Windows 空剪贴板的处理，并改用带扫描码的 Alt 和真实鼠标移动输入；密码学批量测试单独放宽为 15 秒，以适应共享 runner 的速度。所有断言及原生交互验收均保留，没有跳过 Windows 快捷功能测试。


## 下载已发布的安装包

增强版已合并到 main。[GitHub Release v0.5.1](https://github.com/liyongliao/lolPing/releases/tag/v0.5.1) 提供 Windows x64 EXE、macOS Apple Silicon DMG、SHA-256 校验文件及构建来源记录。发布使用上述通过验证的 Actions 构建产物，发布标签与测试提交之间仅有说明文档差异。


## v0.6.0 截图与鼠标配置

### 快速截图（默认）

只框选并复制原始清晰度图片；默认不打开标注、不进行 OCR、不启动滚动拼接，也不保存文件。快速模式复用预加载的轻量截图窗口，采用 node-screenshots 原生采集，必要时回退到 Electron；预加载窗口不会读取屏幕或请求录屏权限。快捷动作和房间同步功能是否开启不影响手动截图。

截图工具中可选择默认「快速截图」或「高级截图」，也可单次点击「高级截图」。鼠标所在显示器的截图会自动隐藏本应用窗口。

### 高级截图

- 标注：集成 react-screenshots，支持箭头、矩形、椭圆、文字、画笔、马赛克和撤销。框选、标注后点击工具栏「完成」复制图片。
- 提取文字：在顶部「完成后」选择「提取文字并复制」，框选后完成。Tesseract.js 使用随包附带的简体中文和英文模型进行离线识别，不上传截图；只有使用 OCR 时才创建识别工作线程。首次初始化需要几秒。
- 滚动截图：在「完成后」选择「开始滚动截图」，框选可滚动区域并完成。手动向下滚动页面，保留上一屏的一部分内容，点击「捕获下一屏」（截图快捷键也可捕获）。完成后点击「完成并复制」。自动去除重叠内容并纵向拼接；无变化不会重复追加，无法匹配时会提示少滚动一些。建议避开固定标题、浮动栏和动画。当前支持手动向下滚动采集，不自动操纵其他应用的滚轮。

执行记录默认收起，只显示最近 3 次；可选择最近 5 次或 10 次。截图与 OCR 的取消都会保留原剪贴板内容。

### 左键、右键与房间

按住原版信号触发键（Option / Alt 等），左键或右键拖动即可使用原版信号轮盘。普通右键菜单照常使用；左键轮盘打开时，右键仍可取消。使用鼠标侧键作为触发键时，沿用原版侧键手势。

「房间」设置可选择左右键都同步（默认）、仅左键同步、仅右键同步，或都不同步。未同步的标记仍在本机显示；此设置控制自己发出的标记，不会静音房间成员。

每条快捷规则中可设置左键、右键或左右键生效。左右键分别累计连续次数，同一条规则共用动作冷却。预览、表情和远程房间信号仍不执行快捷动作。

### 开源组件

- [node-screenshots](https://github.com/nashaofu/node-screenshots) 0.2.8：原生屏幕采集（npm 包声明 Apache-2.0，并附带 MIT 许可证）。
- [react-screenshots](https://github.com/nashaofu/screenshots) 0.5.22：标注编辑器，MIT。使用固定的可构建版本。
- [Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0：离线 OCR，Apache-2.0；简体中文和英文训练数据随安装包提供。

对应许可证保留在 `docs/licenses`，并随安装包附带。原版 lolPing 的 MIT 许可证、署名和 Riot 美术声明也继续保留。


## v0.6.0 验收记录

[成功的双平台 CI 构建](https://github.com/liyongliao/lolPing/actions/runs/38372435572)，应用代码提交 `ee0b33beff7eb964ecc0237895bf9c34ffd885a1`。Windows 安装后通过 418 项原生检查、737 项 TypeScript 测试和 13 项桌面测试。Mac 本机安装包通过 10 项适用桌面测试，3 项 Windows 专用测试按平台跳过。

新增桌面验收覆盖快速截图窗口复用及高级模块不提前加载、默认收起和最近 3 条执行记录、实际标注图片、离线 OCR、重叠长图拼接，以及两个独立客户端之间的房间鼠标键隔离。Windows 还验证了原生右键拖动轮盘和右键快捷规则。

[下载 v0.6.0](https://github.com/liyongliao/lolPing/releases/tag/v0.6.0)。本版本 Release 复用通过 CI 测试的安装包，并提供 SHA-256 与构建来源。滚动截图使用手动滚动、逐屏采集后自动拼接；不自动滚动其他应用。
