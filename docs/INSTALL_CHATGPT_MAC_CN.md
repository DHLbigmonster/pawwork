# 在 Apple Silicon Mac 安装带 ChatGPT 登录的个人构建

适用于 M1、M2、M3、M4 等 Apple 芯片 Mac。系统设置的「通用 → 关于本机」中应显示 Apple 芯片；Intel Mac 不能使用本文的 arm64 安装包。

这项改动需要包含 ChatGPT 插件的源码。原项目 `Astro-Han/pawwork` 的现有安装包不包含此分支尚未发布的功能。下列构建使用 `dev` 通道，安装后显示 **PawWork Dev / 爪印 Dev**，与原正式版并存，不会从上游自动更新并覆盖这项改动。开发版的 DSH 数据位于 `~/.pawwork/dsh-dev`，不会自动使用正式版的模型配置和登录信息。

## 通过 GitHub Actions 生成安装包

本次代码推送到你自己的 `DHLbigmonster/pawwork` 仓库的 `codex/chatgpt-login` 分支时，会自动启动 **Build personal Mac app**。不需要在本机安装开发工具或编译。

1. 在你的仓库打开 **Actions → Build personal Mac app**。
2. 打开分支为 `codex/chatgpt-login` 的最新一次运行。如果 Actions 尚未启用，先按 GitHub 页面提示启用。以后也可以手动重新构建：工作流文件存在于默认分支后，点击 **Run workflow** 并选择包含改动的分支。
3. 等构建成功后，在仓库 **Releases** 打开本次的 **PawWork ChatGPT · Apple Silicon** 预发布版本，直接下载 `.dmg`。也可在此次运行的 **Artifacts** 下载 `pawwork-personal-mac-arm64-运行编号`。构建记录显示的提交 SHA 应与准备安装的版本一致。
4. 解压 GitHub 下载的 artifact ZIP。里面包含 `.dmg`、应用 `.zip` 和 `SHA256SUMS.txt`；通常只需打开 `.dmg`。
5. 将 **PawWork Dev.app** 拖到「应用程序」，从「应用程序」启动它。不要一直从磁盘映像里运行。

该工作流在 GitHub 的 macOS Apple Silicon runner 上安装固定版本的依赖、运行检查、准备随包工具与 Python，再生成 `.dmg` 和 `.zip`。产物路径是 `packages/desktop-electron/dist/`，文件名为 `pawwork-mac-arm64-2026.10.1.dmg` / `.zip`；版本号随后续源码版本变化。它将产物上传到 Actions 并发布到你仓库的预发布版本，使用 GitHub 自动提供的仓库令牌，不需要 Apple 开发者证书或账户密钥。GitHub Actions 的用量和计费仍遵循你的 GitHub 账户规则。

这是本地用途的 ad-hoc 签名构建，**没有 Apple Developer ID 签名和 Apple 公证**。macOS 首次打开可能阻止运行。仅当你确认这是自己仓库构建、信任该提交且设备策略允许时，在「系统设置 → 隐私与安全性」查看系统提供的「仍要打开」选项。不要关闭 Gatekeeper 或绕过组织设备策略。该个人构建不具有上游正式版的签名与公证保证。

可选：在解压后的 artifact 目录运行 `shasum -a 256 -c SHA256SUMS.txt` 检查文件是否完整。SHA256 清单用于发现下载或传输损坏，不能替代确认构建来源。

## 登录和选模型

1. 打开「设置 → ChatGPT / Codex」。
2. 选择浏览器登录，在 OpenAI 页面用自己的 ChatGPT 账户完成授权；如果浏览器无法自动回调，可按设置页提示粘贴此次授权回调页面的完整地址。设备码登录可作为另一种授权方式，是否可用取决于 OpenAI 账户设置。
3. 授权完成后，在「模型」添加 **OpenAI Codex (legacy)**，选择一个账户可用的模型，并在对话中切换到该模型。
4. 对此提供商不要填写 API Key 或自定义 Base URL。原来的 DeepSeek 默认模型不会自动切换。

这里使用的是账户可用的 Codex 订阅权限和额度，不会把 Plus 转换成 API 余额，也不保证每个 Plus 账户都能使用所有模型。真实登录与额度需由你在本机授权后验证。设备所在网络必须允许 OpenAI 授权和 Codex 服务；此功能不隐藏网络目标或绕过监控。退出登录会删除此开发版保存的本机授权，不会注销其他设备的会话。

## 在自己的 Mac 从源码运行或打包

先安装 Node.js 24 和 Git，然后在包含这次改动的源码根目录执行。若从 GitHub 克隆，必须确保改动已经推送，并切换到包含改动的分支；不能用原上游的旧源码代替。

```bash
git clone --branch codex/chatgpt-login https://github.com/DHLbigmonster/pawwork.git
cd pawwork
corepack enable
corepack prepare pnpm@11.23.0 --activate
pnpm install --frozen-lockfile
pnpm dev:desktop
```

`pnpm dev:desktop` 是开发运行方式，终端需保持运行。仅测试 ChatGPT 登录无需先准备 Office/PDF 运行时；若要使用相关文档工具或生成完整安装包，执行下面的步骤。先退出正在开发运行的应用，回到仓库根目录：

```bash
pnpm --filter @pawwork/desktop exec tsx scripts/prepare-uv.ts --platform darwin --arch arm64
pnpm --filter @pawwork/desktop exec tsx scripts/prepare-primary-runtime.ts --platform darwin --arch arm64
OPENCODE_CHANNEL=dev pnpm --filter @pawwork/desktop build
OPENCODE_CHANNEL=dev CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @pawwork/desktop exec electron-builder --mac dmg zip --arm64 --publish never --config electron-builder.config.ts --config.mac.identity=- --config.mac.notarize=false --config.dmg.sign=false
```

完成后，在 `packages/desktop-electron/dist/` 打开 arm64 `.dmg` 并拖到「应用程序」。本地打包与 Actions 产物同样没有 Apple 公证。macOS 安装包应在 macOS 上构建；当前 Linux 云工作区没有执行过这一步，保存工作流也不等于已产生安装包。
