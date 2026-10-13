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

本机验证：macOS arm64，类型检查通过；731 项 TypeScript 测试通过、1 项上游测试跳过；411 项原生 C++ 检查通过；5 项 Electron 桌面流程测试通过。桌面测试覆盖创建规则与重启持久化、连发阈值与冷却、预览/远程信号隔离、原轮盘松手选中到动作执行、真实窗口框选/剪贴板/取消、无效配置和快捷键冲突。截图测试使用合成图像替代屏幕采集，避免读取个人屏幕内容，不代表已完成系统录屏权限验证。macOS 安装包的五项桌面测试也已全部通过，应用包通过 ad-hoc 签名校验。Windows 尚未在本次环境实机验证。

## 来源与维护

- 原版 `assets` 的 180 个文件逐个 SHA-256 对比一致：26 个纹理文件、22 个音频文件、132 个表情文件。
- 原版 `src/renderer/overlay` 的 9 个文件和 `native/hook-helper/src` 的 16 个文件保持不变。
- 原项目 MIT 许可证与原作者署名保留。英雄联盟美术与音频的版权归 Riot Games；上游的素材声明仍保留于 README。
- 本增强版暂停连接上游自动更新，避免安装原版后丢失新增功能；维护者设立自己的发行渠道后可重新接入。README 中上游发布链接仍指向原版。
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
