---
name: wechat-minigame-decompile
description: Turn WeChat mini game wxapkg packages into a runnable devtool project and drive it to real-device success. Use when the user asks 反编译微信小游戏, 解包 wxapkg, 让反编译小游戏跑起来, or fix a white screen stuck at the WeChat splash screen. Do not use for 小程序 mini programs or for authoring a new mini game.
---

# 微信小游戏反编译与跑通

目标：从只有 wxapkg 的线上小游戏，得到能在微信开发者工具模拟器、预览、真机调试三处都跑通的工程。
所有改动只做在副本目录，原始解包产物必须保留可回滚。

## 全局硬约束（违反必炸）

- 主包体积 <= 4MB（4096KB）硬上限；模拟器不校验、预览/真机校验。
- 目录名不得以 `__` 开头且以 `__` 结尾，打包器直接拦截。
- `project.config.json` 不得带 UTF-8 BOM，否则开发者工具打不开工程。
- `require` 引擎 bundle 必须放在 `boot()` 之后，否则报 `System is not defined`。
- 分包入口脚本内的 `require` 必须用相对路径，见 S5——这是真机白屏的头号原因。

## S1 采集 wxapkg

主包文件名为 `__WITHOUT_MULTI_PLUGINCODE__.wxapkg`（无插件版，兼容性最好）；其余按分包路径分别采集，典型清单：

```
__WITHOUT_MULTI_PLUGINCODE__.wxapkg        # 主包
_cocos-js_chunks_.wxapkg                   # /cocos-js/chunks/
_cocos-js_assets_.wxapkg                   # /cocos-js/assets/
_subpackages_<name>_.wxapkg                # /subpackages/<name>/
plugins/<alias>/                           # 插件包（cocos / MiniGameCommon 等）
```

每个子包都是独立文件，必须逐个采集，缺一个就有一个 bundle 注册不上。

## S2 解密 + 解包

```
node scripts/unpack_wxapkg.js <wxapkg> <appid> <outDir>
```

- 头部应为 `V1MMWX`；解密后首尾应为 `0xbe ... 0xed`。
- 报 `not encrypted` → 该包已是明文 wxapkg，直接按索引结构解。
- 报 `bad magic after decrypt` → appid 不对或 XOR 键不对，按 `references/wxapkg-decrypt.md` 的候选密码/keyLen/xor 组合试。
- 校验产物：`game.js`、`game.json`、`project.config.json` 应出现在主包目录。

## S3 合并成工程

- 主包解包产物即工程根：`game.js`、`game.json`、`project.config.json`、`bundles/`、`cocos-js/`。
- 各分包产物按 `game.json` 的 `subPackages[].root` 落位，例如 `_subpackages_main_/` -> `<root>/subpackages/main/`，`_cocos-js_chunks_/` -> `<root>/cocos-js/chunks/`。
- 先备份主包 `game.js`（如 `backup/game.js.orig`），后续所有补丁都基于副本。

## S4 让开发者工具能打开

- `project.config.json`：`compileType: "game"`，`appid` 先填工具测试号；确认无 BOM。
- 清掉 `__` 开头结尾的目录（例：`bundles/__ccWasmAssetSubpkg__` -> `bundles/wasmAssetSubpkg`），并同步改 `game.js` 里的引用。
- 打开工程：`cli open --project <工程目录>`。

## S5 分包入口脚本自引用（真机白屏头号原因）

每个分包入口 `<root>/subpackages/<n>/game.js` 结构是：

```js
define("subpackages/<n>/game.js", function(require, module, exports){ /* bundle 本体 */ });
require("subpackages/<n>/game.js");   // <- 错
```

分包目录下执行时会被再拼一次当前目录，报：

```
module 'subpackages/<n>/subpackages/<n>/game.js' is not defined, require args is 'subpackages/<n>/game.js'
Error: Unable to instantiate virtual:///prerequisite-imports/<n> from undefined
```

后果是入口脚本抛异常 -> 分包实例化失败 -> 一个场景都不加载 -> 卡在微信启动页转圈（`scene=null`）。

修法：把该行改成相对路径 `require("./game.js")`。`cocos-js/chunks|assets/game.js`、`bundles/*/game.js` 是同一个生成器产出的，一并处理。
全量自检（应无输出）：

```
rg 'require\("(subpackages|cocos-js|bundles)/[^"]*"\)'
```

## S6 主包 4MB 上限的双形态

同一份代码需要两副形态，用脚本切换而不是手改：

- `sim` 模式：`bundles/` 留在主包内，模拟器必需（但主包超 4MB，无法预览/真机）。
- `dev` 模式：`bundles/` 移出主包（改名成备份目录如 `_bundles_bak/`），真机/预览由微信运行时自行执行分包入口脚本，主包降到 3.2MB 左右。

切换后必须重启开发者工具，否则仍按旧包体校验。切换脚本参考 `assets/toggle_mode.js`：定位 `/*__BOOT_FIX3__*/` 与下一个补丁标记，整块替换 + 目录改名。

## S7 登录 / 网络 / 广告打桩

没有正式 appid 权限时（测试号拿不到插件授权、`wx.login` 拿不到 code）：

- SDK 桩：把 `wx.sdk` 填上一个最小可用对象（`sdk` 接口全空函数 + `data.mem_id/token/openid`），因为 bridge 里 `mg.sdk` 是 `return wx.sdk` 的 getter。
- 网络层桩（首选，更彻底）：拦 `wx.request` / `XMLHttpRequest`，对登录接口（如 `sdk/loginWx.php`）直接构造成功响应，避免依赖 SDK 内部状态机；云存档接口失败会自动回落本地存档，不影响进大厅。
- 广告桩：把 `_playRewardedVideo` 改为直接执行 `_reward_close({isEnded:!0})`，覆盖所有 `showRewardedVideo` 调用点。
- 测试 appid 没有 `MiniGameCommon` 插件授权：真机 `requirePlugin("MiniGameCommon")` 必失败，需从 `game.json` 移除 `gamePlugins` 并在工程内 stub 掉 `requirePlugin`。

## S8 三处验证

1. 模拟器：`cli open --project <dir>`，确认进入游戏自己的加载界面/大厅。
2. 预览：`cli preview --project <dir>`，生成预览码。
3. 真机调试：`cli auto --project <dir> --auto-port 9420`，向 `ws://127.0.0.1:9420` 发 `Tool.enableRemoteDebug` 拿 base64 二维码。
   - 该调用会返回两个响应：第一个约 10s 抛 timeout，真实结果约 20s 后返回；等待窗口按 80s 设。
   - 每次改动都要重新出码，旧码对应旧代码。
4. 真机日志：普通预览码无法回流日志，必须用真机调试码；游戏侧走局域网 HTTP 上报 + storage 落盘补传，详见 `references/real-device-diag.md`。

## 判定树：卡在微信启动页转圈

1. 有 `scene=null` 且无引擎报错 -> 分包入口脚本自引用（S5），或分包未被人加载/取不到。
2. 引擎分包失败只走 `console.warn`（文案 `Load Subpackage failed: path: ... message: ...`），只钩 `console.error` 会漏，必须同时钩 `console.warn`。
3. `requirePlugin` 失败 -> 插件授权（S7）。
4. 包体超限 -> 切 `dev` 模式（S6）。

## 参考

- `references/wxapkg-decrypt.md` — V1MMWX 解密细节、候选密钥、二进制索引格式
- `references/pitfalls.md` — 现象/原因/解法 对照表
- `references/real-device-diag.md` — 真机调试出码与诊断上报链路
- `scripts/unpack_wxapkg.js` — 解密并解包单个 wxapkg
- `assets/toggle_mode.js` — 主包双形态切换脚本模板