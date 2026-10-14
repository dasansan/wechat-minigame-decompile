# Unity WebGL 小游戏反编译专项

适用：主包特征是 `app-config.json` + `workers.js` + `wasmcode`/`wasmcode1` + `*.wasm.br`，且 `gamePlugins` 含 `UnityPlugin`（对比 Cocos 的 `cocos-js/` + `bundles/` + `game.json`）。

## 1. 产物结构与落位

主包 `__WITHOUT_MULTI_PLUGINCODE__.wxapkg` 解出：

```
game.js              # 入口；内含 requirePlugin 的兜底实现
app-config.json      # 运行时配置：subPackages / workers / gamePlugins / iOSHighPerformance
game.json            # 工程配置
project.config.json
workers.js           # worker 侧脚本（workers/response/index.js）
images/              # loading.jpg / unity_logo.png 等
```

分包与插件：

```
_wasmcode_.wxapkg   -> <root>/wasmcode/    （wasmcode/game.js + *.webgl.wasm.code.unityweb.wasm.br）
_wasmcode1_.wxapkg  -> <root>/wasmcode1/
plugins/<alias>/    -> UnityPlugin / MiniGameCommon 的 plugin.js + plugin.json
```

- `data-package`、`wasmcode2` 等分包常是 CDN 远程加载，本机缓存里可能没有。`app-config.json` 里若有而磁盘没有，必须删掉该 `subPackages` 项，否则运行时加载不存在的包会卡死。
- 落位后 `subPackages[].root` 必须与磁盘目录逐条对齐；`game.json` 与 `app-config.json` 两处的 `subPackages` 都要干净一致。
- 备份主包 `game.js` 到 `backup/game.js.orig`，后续补丁都基于副本。

## 2. 分包入口自引用（同 Cocos，真机白屏头号原因）

Unity 的 `wasmcode/game.js` / `wasmcode1/game.js` 结构：

```js
define("wasmcode/game.js", function(require, module, exports){ /* 本体 */ });
require("wasmcode/game.js");   // <- 错，会拼成 wasmcode/wasmcode/game.js
```

改成 `require("./game.js")` 即可。自检：

```
rg 'require\("(wasmcode|wasmcode1)/[^"]*"\)'
```

## 3. UnityPlugin 授权与本地内联（S7 关键差异）

现象：`requirePlugin("UnityPlugin")` 抛 `module '_plugin_<appid>_js' is not defined`，wasm 运行时起不来。

原因：测试 appid 未开通「小游戏 Unity 转换」插件能力，真机/工具都拿不到插件沙箱注入。

做法（三步，脚本参考工程 `patch_plugin_shim.js`）：

1. 把解包出的 `plugins/UnityPlugin/plugin.js`、`plugins/MiniGameCommon/plugin.js` 原文**内联到 `game.js` 顶部**——它们内部以 `define("__plugin__/<appid>/...")` 自行注册，内联后才进模块系统。
2. shim `requirePlugin(name)`：按别名映射到 `__plugin__/<id>/index.js`，用本地 `require` 加载；失败再回落原生 `requirePlugin`。
3. 补全 `pluginEnv.customEnv`：开发者工具里全局 `pluginEnv` 存在但缺 `customEnv`，插件按「插件模式」初始化会抛错；用游戏传入的 `opts.customEnv` 把它补上，并写回 `GameGlobal.pluginEnv` / `global.pluginEnv`。

## 4. 启动弹窗（首次打开挡屏）

UnityPlugin 自带两个启动弹窗，由配置单例 `Me` 控制：

- `Me.getConfig(Pe.ShowSuggestModal)` -> "优化建议[可交互]"
- `Me.getConfig(Pe.ShowReportModal)` -> "检测报告"

配置单例读的是 `C.monitorConfig`（`C = customEnv.unityNamespace / GameGlobal.unityNamespace`），**不是 `GameGlobal.managerConfig`**——hook 错路径弹窗关不掉。最稳做法是把这两处判定直接短路为 `!1`（改 `plugins/UnityPlugin/plugin.js` 后重新内联）。

## 5. 登录 / 网络 / 广告桩

- **`wx.login` 桩**：开发者工具账号非该 appid 开发者，`wx.login` 返回 fail，业务 SDK 无限重试 -> 直接回调一个假 `code`。
- **CDN 配置**：`https://smallgame.<域名>/<appid>.txt` 返回 base64。解密 = `AES-256-ECB`，key = `Utf8(MD5(appid) 的 hex 字符串)`（32 字节），Pkcs7。加密方向用运行时 `wx.CryptoJS` 反向构造即可（保证与 SDK 的 decrypt 完全同构）。
- **登录协议**：`POST .../oauth/wxLoginToReport` -> `{result:0,data:{...}}`，其中 `data.d` 是 openid 密文；`POST /api/verify_sessionid` -> `{result:0,data:{status:true}}`。
- **分流原则**：业务域名（center/data/recharge/fcm/adv2/platform/cash.sdk 等）回良性空结构，避免无限重试刷屏；**资源 CDN 域名必须放行走真实网络**，否则 wasm/资源拉不到。
- **字段集对齐 C# 侧**：响应缺字段会抛 `The given key 'xxx' was not present in the dictionary`；字段名可从 IL2CPP 元数据反查。
- **启动参数兜底**：包装 `wx.getLaunchOptionsSync` / `wx.getEnterOptionsSync`，补 `scene`（如 1001）、`query`、`path`，否则 C# 侧抛 `The given key 'scene' was not present in the dictionary`。
- **广告**：模拟器无广告库存，`createRewardedVideoAd` 会 `onError`；让广告 API 返回良性 fake 对象静音，或游戏侧直接短路看广告回调。

完整注入器参考工程 `netstub_patch.js`。

## 6. 模拟器黑屏不等于渲染失败

Unity WebGL 在开发者工具模拟器里黑屏，常见是 `preserveDrawingBuffer:false` 下截图/截屏取不到画面，**不代表渲染失败**。用 `readPixels` 读帧缓冲，或读 `GameGlobal` / 运行时状态确认主场景已加载，再决定是否继续排查。

## 7. 配置表：IL2CPP 元数据 + Luban bin

C# 侧的数据结构在 `global-metadata.dat`，表数据在 UnityFS bundle 内的 TextAsset 里。

- **字段顺序与类型**：`global-metadata.dat` 头是 `int32LE` 的偏移/大小数组；`stringOffset/stringSize` 指向字符串池，`typeDefinitionsOffset` 起每个类型 88 字节，`fieldsOffset` 起每个字段 12 字节。**字段顺序 = 序列化顺序**，字段类型由 typeIndex 决定。
- **取表数据**：表在 `assets/assetraw/configs/bytes/*.bytes`，最终落在 CDN bundle（`UnityFS` -> SerializedFile -> 对象表 -> `TextAsset.m_Script`）。切片必须用对象表的 `byteStart/byteSize`，不能猜长度。
- **UnityFS 块压缩可能是 LZMA**（`flags` 低 6 位 = `3`），不一定是 LZ4；用 LZ4 解会把大表解坏。纯 Node 可用 `unity-asset-reader`（支持 LZMA）。
- **Luban bin 序列化**：`varint 行数` + 各行按字段顺序拼接（无字段名、无分隔符）；整数走分级 varint（1B/2B/3B/4B/5B）；字符串 = `varint 长度` + UTF-8；`List<T>` = `varint 个数` + 元素；`__ID__` 不参与序列化。
- **内联结构体没有 count 前缀**：metadata 里一个字段若 typeIndex 指向结构体，序列化直接按字段展开，必须当作定长元组解，否则整表错位。

完整方法与解码器写法见工程内 `配置表解析说明.md` 及 `_mp.js`、`_as/_reslice.js`。
