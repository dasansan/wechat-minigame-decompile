---
name: wechat-minigame-decompile
description: Turn WeChat mini game wxapkg packages into a runnable devtool project and drive it to real-device success, covering both Cocos and Unity engines. Use when the user asks 反编译微信小游戏, 解包 wxapkg, 让反编译小游戏跑起来, or fix a white screen stuck at the WeChat splash screen. Do not use for 小程序 mini programs or for authoring a new mini game.
---

# 微信小游戏反编译与跑通（Cocos / Unity 双引擎）

目标：从只有 wxapkg 的线上小游戏，得到能在微信开发者工具模拟器、预览、真机调试三处都跑通的工程。
所有改动只做在副本目录，原始解包产物必须保留可回滚。

## 全局硬约束（违反必炸）

- 主包体积 <= 4MB（4096KB）硬上限；模拟器不校验、预览/真机校验。
- 目录名不得以 `__` 开头且以 `__` 结尾，打包器直接拦截。
- `project.config.json` 不得带 UTF-8 BOM，否则开发者工具打不开工程。
- `require` 引擎 bundle 必须放在 `boot()` 之后，否则报 `System is not defined`（Cocos）。
- 分包入口脚本内的 `require` 必须用相对路径，见 S5——这是真机白屏的头号原因，两个引擎通用。

## S0 先判引擎（决定后面走哪条支线）

解包主包后看产物特征，判错引擎后面所有落位与打桩都会打空：

| 特征 | 引擎 | 关键文件 |
| --- | --- | --- |
| `cocos-js/` + `bundles/` + `game.json`，`gamePlugins.cocos` | Cocos Creator 3.x | `cocos-js/chunks\|assets/game.js`、`bundles/*/game.js` |
| `app-config.json` + `workers.js` + `wasmcode`/`wasmcode1` + `*.wasm.br`，`gamePlugins.UnityPlugin` | Unity WebGL | `wasmcode/game.js`、`*.webgl.wasm.code.unityweb.wasm.br`、`workers.js` |

- 判为 Unity → 本文件各节按「Unity」括号内容走，专项细节见 `references/unity.md`。
- 判为 Cocos → 按「Cocos」括号内容走，细节即本文件。

## S1 采集 wxapkg

主包文件名为 `__WITHOUT_MULTI_PLUGINCODE__.wxapkg`（无插件版，兼容性最好）；其余按分包路径分别采集。每个子包都是独立文件，缺一个就有一个 bundle/wasm 注册不上。

Cocos 典型清单：

```
__WITHOUT_MULTI_PLUGINCODE__.wxapkg        # 主包
_cocos-js_chunks_.wxapkg                   # /cocos-js/chunks/
_cocos-js_assets_.wxapkg                   # /cocos-js/assets/
_subpackages_<name>_.wxapkg                # /subpackages/<name>/
plugins/<alias>/                           # 插件包（cocos / MiniGameCommon 等）
```

Unity 典型清单：

```
__WITHOUT_MULTI_PLUGINCODE__.wxapkg        # 主包（含 game.js / app-config.json / workers.js / images）
_wasmcode_.wxapkg                          # /wasmcode/
_wasmcode1_.wxapkg                         # /wasmcode1/
plugins/<alias>/                           # UnityPlugin / MiniGameCommon
```

- Unity 的 `data-package`、`wasmcode2` 等分包常是 CDN 远程加载，本机缓存里可能没有，缺了不必然致命；按 `app-config.json` 逐条核对，只保留真正采集到的。

## S2 解密 + 解包

```
node scripts/unpack_wxapkg.js <wxapkg> <appid> <outDir>
```

- 头部应为 `V1MMWX`；解密后首尾应为 `0xbe ... 0xed`。
- 报 `not encrypted` → 该包已是明文 wxapkg，直接按索引结构解。
- 报 `bad magic after decrypt` → appid 不对或 XOR 键不对，按 `references/wxapkg-decrypt.md` 的候选密码/keyLen/xor 组合试。
- 校验产物：主包目录应出现 `game.js`、`project.config.json`，以及 `game.json`（Cocos）或 `app-config.json`（Unity）。

## S3 合并成工程

Cocos：

- 主包解包产物即工程根：`game.js`、`game.json`、`project.config.json`、`bundles/`、`cocos-js/`。
- 各分包产物按 `game.json` 的 `subPackages[].root` 落位，例如 `_subpackages_main_/` -> `<root>/subpackages/main/`，`_cocos-js_chunks_/` -> `<root>/cocos-js/chunks/`。

Unity：

- 主包解包产物即工程根：`game.js`、`app-config.json`、`game.json`、`project.config.json`、`workers.js`、`images/`。
- 分包按 `app-config.json` 的 `subPackages[].root` 落位：`_wasmcode_/` -> `<root>/wasmcode/`，`_wasmcode1_/` -> `<root>/wasmcode1/`。
- **删掉 `app-config.json` 里没有实际采集到的分包项**（如 `data-package`、`wasmcode2`），否则运行时会去加载不存在的包而卡死；同时保证 `game.json` 的 `subPackages` 与磁盘目录一致。

两引擎通用：

- 先备份主包 `game.js`（如 `backup/game.js.orig`），后续所有补丁都基于副本。
- 落位必须与配置文件里的 `subPackages[].root` 逐条对齐，名字或层级差一级就会出现「分包取不到」。

## S4 让开发者工具能打开

- `project.config.json`：`compileType: "game"`，`appid` 先填工具测试号；确认无 BOM。
- 清掉 `__` 开头结尾的目录（例：Cocos 的 `bundles/__ccWasmAssetSubpkg__` -> `bundles/wasmAssetSubpkg`），并同步改 `game.js` 里的引用。
- 打开工程：`cli open --project <工程目录>`。

## S5 分包入口脚本自引用（真机白屏头号原因）

Cocos 的 `subpackages/<n>/game.js`、`cocos-js/chunks\|assets/game.js`、`bundles/*/game.js`，与 Unity 的 `wasmcode/game.js`、`wasmcode1/game.js` 都是同一个生成器产出的，结构一致：

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

修法：把该行改成相对路径 `require("./game.js")`。全量自检（应无输出）：

```
rg 'require\("(subpackages|cocos-js|bundles|wasmcode|wasmcode1)/[^"]*"\)'
```

## S6 主包 4MB 上限的双形态

Cocos：

- `sim` 模式：`bundles/` 留在主包内，模拟器必需（但主包超 4MB，无法预览/真机）。
- `dev` 模式：`bundles/` 移出主包（改名成备份目录如 `_bundles_bak/`），真机/预览由微信运行时自行执行分包入口脚本，主包降到 3.2MB 左右。
- 切换后必须重启开发者工具，否则仍按旧包体校验。切换脚本参考 `assets/toggle_mode.js`：定位 `/*__BOOT_FIX3__*/` 与下一个补丁标记，整块替换 + 目录改名。

Unity：

- Unity 主包通常较小（wasm 代码与 .br 二进制已在 `wasmcode`/`wasmcode1` 分包里），一般不需要双形态。
- 若主包确实超限，按同一思路把可外置的目录移出主包，让运行时从分包加载。

## S7 登录 / 网络 / 广告打桩

没有正式 appid 权限时（测试号拿不到插件授权、`wx.login` 拿不到 code）：

Cocos：

- SDK 桩：把 `wx.sdk` 填上一个最小可用对象（`sdk` 接口全空函数 + `data.mem_id/token/openid`），因为 bridge 里 `mg.sdk` 是 `return wx.sdk` 的 getter。
- 网络层桩（首选，更彻底）：拦 `wx.request` / `XMLHttpRequest`，对登录接口（如 `sdk/loginWx.php`）直接构造成功响应，避免依赖 SDK 内部状态机；云存档接口失败会自动回落本地存档，不影响进大厅。
- 广告桩：把 `_playRewardedVideo` 改为直接执行 `_reward_close({isEnded:!0})`，覆盖所有 `showRewardedVideo` 调用点。
- 测试 appid 没有 `MiniGameCommon` 插件授权：真机 `requirePlugin("MiniGameCommon")` 必失败，需从 `game.json` 移除 `gamePlugins` 并在工程内 stub 掉 `requirePlugin`。

Unity（差异点，完整步骤见 `references/unity.md`）：

- **UnityPlugin 授权**：测试 appid 无「小游戏 Unity 转换」插件能力，`requirePlugin("UnityPlugin")` 抛 `module '_plugin_<appid>_js' is not defined`，wasm 运行时起不来。做法：把解包出的插件 bundle 内联进 `game.js` 顶部（保留其中的 `define("__plugin__/<appid>/...")` 注册），再 shim `requirePlugin` 指向本地模块 `__plugin__/<id>/index.js`，并用游戏传入的 `customEnv` 补全 `pluginEnv.customEnv`。
- **启动弹窗**：UnityPlugin 的弹窗由配置单例 `Me.getConfig(Pe.ShowSuggestModal / Pe.ShowReportModal)` 控制，单例读的是 `C.monitorConfig`（`C = customEnv.unityNamespace / GameGlobal.unityNamespace`），**不是 `GameGlobal.managerConfig`**——hook 错路径弹窗关不掉。把这两处判定短路为 `!1`。
- **wx.login / 网络层桩**：`wx.login` 直接回调假 `code`；CDN 配置 `smallgame.<域名>/<appid>.txt` 用 `AES-256-ECB`、key = `Utf8(MD5(appid) hex)` 解密；登录 `POST .../oauth/wxLoginToReport` 回 `{result:0,data:{...}}`（`data.d` 是 openid 密文）。业务域名回良性空结构，**资源 CDN 域名必须放行走真实网络**。响应字段集要对齐 C# 侧，缺字段会抛 `The given key 'xxx' was not present in the dictionary`。
- **启动参数兜底**：包装 `wx.getLaunchOptionsSync` / `wx.getEnterOptionsSync`，补 `scene/query/path`，否则 C# 侧抛 `The given key 'scene' was not present in the dictionary`。
- **广告**：模拟器无广告库存会 `onError`；让广告 API 返回良性 fake 对象静音，或游戏侧直接短路看广告回调。

## S8 三处验证

1. 模拟器：`cli open --project <dir>`，确认进入游戏自己的加载界面/大厅。
2. 预览：`cli preview --project <dir>`，生成预览码。
3. 真机调试：`cli auto --project <dir> --auto-port 9420`，向 `ws://127.0.0.1:9420` 发 `Tool.enableRemoteDebug` 拿 base64 二维码。
   - 该调用会返回两个响应：第一个约 10s 抛 timeout，真实结果约 20s 后返回；等待窗口按 80s 设。
   - 每次改动都要重新出码，旧码对应旧代码。
4. 真机日志：普通预览码无法回流日志，必须用真机调试码；游戏侧走局域网 HTTP 上报 + storage 落盘补传，详见 `references/real-device-diag.md`。

Unity 补充：模拟器里 Unity WebGL 黑屏，常见是 `preserveDrawingBuffer:false` 截图取不到画面，**不代表渲染失败**；用 `readPixels` 或运行时状态确认主场景已加载，再决定是否继续排查。

## 判定树：卡在微信启动页转圈

1. 有 `scene=null` 且无引擎报错 -> 分包入口脚本自引用（S5），或分包未被人加载/取不到。
2. 引擎分包失败只走 `console.warn`（文案 `Load Subpackage failed: path: ... message: ...`），只钩 `console.error` 会漏，必须同时钩 `console.warn`。
3. `requirePlugin` 失败 -> 插件授权（S7）；Unity 报 `module '_plugin_<appid>_js' is not defined` 即此类。
4. 包体超限 -> 切 `dev` 模式（S6）。
5. Unity 专属：`requirePlugin("UnityPlugin")` 失败、启动弹窗挡屏、C# 抛缺键异常 -> 见 `references/unity.md`。

## 参考

- `references/unity.md` — Unity 专项：产物结构、UnityPlugin 内联与 shim、启动弹窗、网络桩、IL2CPP/Luban 配置表
- `references/wxapkg-decrypt.md` — V1MMWX 解密细节、候选密钥、二进制索引格式、两引擎落位表
- `references/pitfalls.md` — 现象/原因/解法 对照表
- `references/real-device-diag.md` — 真机调试出码与诊断上报链路
- `scripts/unpack_wxapkg.js` — 解密并解包单个 wxapkg（两引擎通用）
- `assets/toggle_mode.js` — 主包双形态切换脚本模板（Cocos）
