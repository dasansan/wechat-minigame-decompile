# 真机调试出码与诊断上报链路

## 1. 出二维码（IDE 自动化协议）

```
cli auto --project <工程目录> --auto-port 9420
```

随后用 WebSocket 连 `ws://127.0.0.1:9420`，发一次：

```json
{ "id": "g_1", "method": "Tool.enableRemoteDebug", "params": {} }
```

要点：

- 每次调用会收到两个响应：第一个约 10s 后是 `timeout waiting for automator response`，真实结果约 20s 到。等待窗口按 80s 设，并取带 `result.qrCode` 的那个。
- `result.qrCode` 是 base64 图片（`/9j/...` 开头是 jpg），落盘后用系统图片查看器打开给用户扫。
- 出码即代表 IDE 完成一次构建上传，因此**必须每次改完代码后重新出码**。
- 上传成功的 IDE 日志特征：`[uploadFile] reportNewRemoteDebug`。

## 2. 普通预览 vs 真机调试

- `cli preview` 只能拿预览码，**真机日志不回传**。
- 要看真机日志必须用真机调试码。但 IDE 的 DevTools 通道常因代理端口占用（18693/18793 旧进程未回收、`ECONNREFUSED`）拿不到 Console，此时自建诊断通道更可靠。

## 3. 自建诊断通道（局域网 HTTP 上报）

PC 侧起一个落盘服务（监听 `0.0.0.0:18099`）：

```js
const http = require('http'), fs = require('fs');
const OUT = 'diag_received.txt';
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
  req.on('end', () => {
    fs.appendFileSync(OUT, '[' + new Date().toISOString() + '] ' + req.method + ' ' + req.url + ' len=' + body.length + ' body=' + body.slice(0, 30000) + '\n');
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('ok');
  });
}).listen(18099, '0.0.0.0');
```

游戏侧用 `wx.request` POST 到 `http://<PC局域网IP>:18099/diag?tag=<阶段名>`，body 为 JSON。

规则：

- 落盘截断不要设太小（4000 会把 tick 记录截断导致 JSON 解析失败，用 30000）。
- 主通道只走 LAN。webhook 备用通道会造成 `statusCode=429` 噪音灌满 `err`，把真实报错挤掉。
- 手机能访问局域网服务但小游戏无数据时，先查上报路径与 `wx.request` 是否被工程自身的网络桩拦截。

## 4. 落盘补传（必须做）

白屏/崩溃时进程可能立刻死掉，纯内存上报会丢数据：

- 所有标记位在写入时报的同时 `wx.setStorageSync('dump', ...)`。
- 下次启动先读回旧 dump（避免覆盖），再用一条独立最小上报路径补传（`flushDump()`），LAN 返回 200 才清除 dump。
- dump 相关 storage 键在启动时先清理，避免读到上一轮旧值。

## 5. 探针清单

在启动链关键节点打点，字段名固定，便于比对：

| 字段 | 内容 |
| --- | --- |
| `boot_enter` / `boot_returned` | `boot()` 进入与返回 |
| `raf_first` / `raf_fired` | 首帧回调注册与触发（判断帧循环是否活了） |
| `rb_ok` / `rb_fail` | require bundle 的成败与 `sys` 状态 |
| `late_check` / `late_check_to` | 延时后 `cc` / `canvas` 是否出现 |
| `scene` | `cc.director.getScene()` 是否为 null（null 即一个场景都没加载） |
| `subs` | 包装 `wx.loadSubpackage`，记录 name / 成败 / 耗时 / errMsg |
| `logs` | 钩 `console.warn` + `console.log` 的环形缓冲（内存，不落盘，防递归放大） |
| `bundles` | `cc.assetManager.bundles` 的 name + base，看哪些 bundle 注册上了 |
| `fs` | `fs.accessSync` 探关键文件是否存在（`game.js`、`bundles/main/game.js`、`subpackages/main/config.*.json`、`cocos-js/chunks/game.js`） |
| `err` / `nf` | 错误列表与帧数（`nf` 增长说明 JS 主线程还活着） |

## 6. 读日志的判定顺序

1. `scene` 是否 null —— null 说明根本没加载场景，别再往渲染层看。
2. `err` 是否全是网络 429 —— 是则为噪音，真实原因在别处。
3. `logs` 里找 `Load Subpackage failed: path: ... message: ...` —— 这是引擎分包失败的原文（只走 warn）。
4. `subs` 缺哪些包 —— 缺说明没人调用加载；`fs` 对应文件为 `no` 说明包内确实没有该文件。
5. `nf` 是否增长 —— 不增长说明 JS 主线程已死或帧循环没启动。

## 7. 语法与进包校验

- `node --check <file>` 只保证语法，**不代表改动进了包**。
- 进包校验：取 `微信开发者工具/User Data/<id>/WeappCache/WeappCompileCache` 下最新的编译产物（目录里是 `<hash>` 数据文件 + 同名 `.json` 元数据，注意过滤掉 `.json`），用 Latin1 读全文后 `indexOf` 你的关键字，出现即已进包。