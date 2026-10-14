# 现象 / 原因 / 解法 对照表

按现象查，不要凭直觉改。

## 启动与白屏

| 现象 | 原因 | 解法 |
| --- | --- | --- |
| 卡在微信启动页白屏转圈、进度条满 | 分包入口脚本自引用绝对路径，抛 `module 'subpackages/x/subpackages/x/game.js' is not defined`，级联 `Unable to instantiate virtual:///prerequisite-imports/x from undefined`，一个场景都没加载（`scene=null`） | 入口脚本该行改 `require("./game.js")`，见 SKILL.md S5 |
| 进度卡 80% 不动 | 启动任务链只剩 `_serverLogin` 未完成；SDK 的 `wx.login` 在开发者工具拿不到 `code`，且 SDK 未实现 `fail` 分支，回调永不触发 | 用正式 appid，或在工程侧注入 `wx.sdk` 桩 / 网络层桩 |
| 加载界面不显示 | Spine wasm 子包脚本未注册 | 确认 `cocos-js/assets`、`cocos-js/chunks` 两个分包脚本被正确加载 |
| `System is not defined` | `require` bundle 放在了 `boot()` 之前，`System` 还没建立 | 把 require 块移到 `boot()` 之后 |
| 大厅进不去、云存档为空 | mock 的 `mem_id` 查不到云存档 | 自动回落本地存档，不影响游玩，无需处理 |
| Unity 版卡在启动页、wasm 运行时起不来 | `requirePlugin("UnityPlugin")` 抛 `module '_plugin_<appid>_js' is not defined`（测试 appid 无 Unity 转换插件能力） | 内联插件 bundle + shim `requirePlugin` + 补 `pluginEnv.customEnv`，见 `unity.md` |
| Unity 启动即被两个弹窗挡住 | UnityPlugin 读 `C.monitorConfig` 控制 `ShowSuggestModal`/`ShowReportModal`，hook `GameGlobal.managerConfig` 无效 | 把 `Me.getConfig(Pe.ShowSuggestModal/ShowReportModal)` 短路为 `!1` |
| Unity 模拟器黑屏 | `preserveDrawingBuffer:false` 的截图限制，非渲染失败 | 用 `readPixels` 或运行时状态验证，别据此判定失败 |

## 打包与预览

| 现象 | 原因 | 解法 |
| --- | --- | --- |
| 预览/真机调试失败，`__` 目录被拦 | 打包器禁止 `__` 开头且结尾的保留目录 | 重命名并同步改 `game.js` 引用，如 `__ccWasmAssetSubpkg__` -> `wasmAssetSubpkg` |
| 真机日志提示主包超限（如 4.4MB > 4MB） | 处于 `sim` 形态，主包含 `bundles/` | 切 `dev` 形态（移出 `bundles/`），重启 IDE |
| 开发者工具打不开工程 | `project.config.json` 带 UTF-8 BOM | 去掉 BOM |
| 分包脚本在真机不执行 | 真机由微信运行时执行分包入口脚本，工具内需显式 `wx.loadSubpackage` 后再 `require` | 两套路径分别处理，不要混用 |

## 插件与 appid

| 现象 | 原因 | 解法 |
| --- | --- | --- |
| 真机 `requirePlugin("MiniGameCommon")` 失败 | 测试 appid 没有该插件（如 `wxaed5ace05d92b218`）的授权，且真机强隔离 `isolatedContext` | 用正式 appid；否则从 `game.json` 移除 `gamePlugins` 并在工程内 stub `requirePlugin` |
| 测试 appid 无法完成服务器登录 | 优匹 SDK 插件未授权 | 换回原 appid，或用网络层桩绕过 |
| Unity 真机/工具 `requirePlugin("UnityPlugin")` 失败 | 测试 appid 无「小游戏 Unity 转换」插件能力 | 内联插件 bundle + shim `requirePlugin`，见 `unity.md` |
| Unity 侧 C# 抛 `The given key 'xxx' was not present in the dictionary` | 网络桩响应字段集与 C# 期望不一致，或 launch options 缺 `scene` | 按 IL2CPP 元数据补齐字段；包装 `getLaunchOptionsSync`/`getEnterOptionsSync` 补 `scene`/`query`/`path` |
| 连续真机调试后 IDE 无日志、Console 空白 | 自动化会话复用固定端口（18693/18793），旧代理进程未回收，新代理 `ECONNREFUSED` | 彻底退出并重启开发者工具；改用 IDE 自带「真机调试」按钮出码 |

## 调试器自身

| 现象 | 原因 | 解法 |
| --- | --- | --- |
| 上报体积每轮翻倍直至 431 | 上报器把错误对象同时放进 `errtrap` 与 `err`，自己上报自己 | 去掉自引用字段，`err` 设上限并连续去重 |
| storage 里读到上一轮旧诊断值 | storage 跨会话保留 | 启动时先清理相关键 |
| 只钩 `console.error` 抓不到引擎报错 | 引擎分包加载失败走 `console.warn` | 同时钩 `console.warn`（文案 `Load Subpackage failed: path: ... message: ...`） |
| 出码调用返回超时 | `Tool.enableRemoteDebug` 每次两个响应，第一个约 10s 抛 timeout，真实结果约 20s 后到 | 等待窗口设 80s，取第二个响应 |
| 扫码后仍是旧代码行为 | 旧二维码对应旧构建 | 每次改动后重新出码 |
| 新代理/新构建未生效 | `node --check` 通过不代表进包 | 用编译缓存核对：取 `WeappCache/WeappCompileCache` 下最新文件，Latin1 读全文 `indexOf` 埋点关键字 |