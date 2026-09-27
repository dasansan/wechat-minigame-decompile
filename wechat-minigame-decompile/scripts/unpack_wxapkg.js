// 解密并解包单个微信小游戏 wxapkg（V1MMWX 加密包或明文包）
// 用法: node unpack_wxapkg.js <wxapkg> <appid> <outDir>
// 说明: 加密包前 6 字节为 "V1MMWX"，其后 1024 字节为 AES-256-CBC 头（PBKDF2(appid,'saltiest',1000,32,'sha1')，
//       iv = 'the iv: 16 bytes'），剩余字节逐字节异或 appid 倒数第 2 个字符的 charCode，拼回后即为标准 wxapkg 索引结构。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const appid = process.argv[3];
const outDir = process.argv[4] || './out';
if (!file || !appid) {
  console.error('用法: node unpack_wxapkg.js <wxapkg> <appid> <outDir>');
  process.exit(2);
}

const data = fs.readFileSync(file);
let buf;
if (data.slice(0, 6).toString('ascii') === 'V1MMWX') {
  const salt = 'saltiest';
  const iv = Buffer.from('the iv: 16 bytes', 'utf8');
  const key = crypto.pbkdf2Sync(appid, salt, 1000, 32, 'sha1');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  const dec = Buffer.concat([decipher.update(data.slice(6, 6 + 1024)), decipher.final()]);
  const pad = dec[dec.length - 1];
  const header = pad >= 1 && pad <= 16 ? dec.slice(0, dec.length - pad) : dec;
  const xk = appid.charCodeAt(appid.length - 2);
  const rest = Buffer.from(data.slice(6 + 1024).map((b) => b ^ xk));
  buf = Buffer.concat([header, rest]);
} else {
  console.log('not encrypted (no V1MMWX magic)，按明文包处理');
  buf = data;
}

const firstMark = buf[0];
const lastMark = buf[13];
if (firstMark !== 0xbe || lastMark !== 0xed) {
  console.error('bad magic after decrypt ' + firstMark.toString(16) + ' ' + lastMark.toString(16) + ' —— appid 或密钥不对');
  process.exit(1);
}

const fileCount = buf.readUInt32BE(14);
let p = 18;
const files = [];
for (let i = 0; i < fileCount; i++) {
  const nameLen = buf.readUInt32BE(p); p += 4;
  const name = buf.slice(p, p + nameLen).toString('utf8'); p += nameLen;
  const offset = buf.readUInt32BE(p); p += 4;
  const size = buf.readUInt32BE(p); p += 4;
  files.push({ name, offset, size });
}

console.log('appid=' + appid + ' files=' + fileCount + ' headerOK');
fs.mkdirSync(outDir, { recursive: true });
for (const f of files) {
  const outPath = path.join(outDir, f.name.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf.slice(f.offset, f.offset + f.size));
}
console.log('extracted ' + files.length + ' files -> ' + outDir);