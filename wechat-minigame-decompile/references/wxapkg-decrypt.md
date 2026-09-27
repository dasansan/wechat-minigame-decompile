# wxapkg 解密与解包细节

## 加密包格式（V1MMWX）

```
[0..5]      "V1MMWX" 魔数
[6..1029]   1024 字节 AES-256-CBC 密文（无自动填充）
[1030..]    剩余字节，逐字节 XOR
```

解密步骤：

1. `key = PBKDF2(password, 'saltiest', 1000, 32, 'sha1')`
2. `iv = Buffer.from('the iv: 16 bytes', 'utf8')`
3. 前 1024 字节 AES-256-CBC 解密，`setAutoPadding(false)`，再按 PKCS7 手工去填充（末字节 1..16 时截断）
4. 剩余字节 XOR：`xk = appid.charCodeAt(appid.length - 2)`（注意不是最后一位）
5. 拼回后校验 `buf[0] === 0xbe && buf[13] === 0xed`

明文包（无 `V1MMWX` 魔数）跳过 1-4 步，直接从索引解析。

## 明文 wxapkg 索引结构

```
[0]       0xbe
[1..4]    info1 (uint32 BE)
[5..8]    indexInfoLength
[9..12]   bodyInfoLength
[13]      0xed
[14..17]  fileCount (uint32 BE)
重复 fileCount 次：
  nameLen (uint32 BE) / name (utf8，带前导 /) / offset (uint32 BE) / size (uint32 BE)
```

文件内容从各自 `offset` 起 `size` 字节取。`scripts/unpack_wxapkg.js` 已实现全部逻辑。

## 密钥不对时的候选集

正式 appid 未知或解密后 `bad magic` 时，按下面候选依次试（keyLen 16/32 × XOR 开/关）：

- `wxid_xxxxxxxxxxxxxx`（包名/开发者 wxid）
- `<wxid>_<4位hex>` 形式
- 32 位 hex 串（可能是某个 md5）
- `appid` 本身
- 固定串 `WMGRITNQWODEEFNC`

其中 XOR 键有两种用法，都要试：`charCodeAt(len-2)` 与 `charCodeAt(len-2) ^ charCodeAt(len-1)`。

## appid 来源

优先级：目标小游戏的正式 appid（`project.config.json` / `game.json` / 小游戏后台）> 反编译产物里出现的 appid > 上面候选集。

## 解包产物落位

| wxapkg 文件名 | 工程内目标目录 |
| --- | --- |
| `__WITHOUT_MULTI_PLUGINCODE__.wxapkg` | 工程根（`game.js` / `game.json` / `project.config.json` / `bundles/`） |
| `_cocos-js_chunks_.wxapkg` | `<root>/cocos-js/chunks/` |
| `_cocos-js_assets_.wxapkg` | `<root>/cocos-js/assets/` |
| `_subpackages_<name>_.wxapkg` | `<root>/subpackages/<name>/` |

落位后必须与 `game.json` 的 `subPackages[].root` 逐条对齐，名字或层级差一级就会出现「分包取不到」。分包目录深度保持 2 级，内部相对路径 `../../@babel/...` 才能正确指回根目录。