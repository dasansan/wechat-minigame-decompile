// 主包双形态切换模板（复制到工程根目录后按需改 GAME_DIR / BUNDLE_NAMES）
//   sim : bundles/ 留在主包内（开发者工具模拟器必需；主包通常超 4MB，无法预览/真机调试）
//   dev : bundles/ 移出主包（真机/预览由微信运行时自行执行分包入口脚本，主包体积回落）
// 用法: node toggle_mode.js sim | node toggle_mode.js dev
// 注意: 切换后必须重启微信开发者工具，否则包体校验仍用旧结果。
const fs = require('fs');
const path = require('path');

const GAME_DIR = process.env.GAME_DIR || './';
const BUNDLE_NAMES = ['internal', 'resources', 'main', 'animation', 'common'];
const WASM_NAMES = ['wasmChunkSubpkg', 'wasmAssetSubpkg'];

const root = path.resolve(GAME_DIR);
const bak = path.join(root, '..', '_bundles_bak');
const bundles = path.join(root, 'bundles');
const gameJs = path.join(root, 'game.js');

// require 必须放在 boot() 之后，否则报 System is not defined
function simBlock() {
  const lines = [
    '/*__BOOT_FIX3__*/',
    'var __FR={alive:true,ok:[],fail:[]};',
  ];
  for (const n of BUNDLE_NAMES) {
    lines.push('try{require("./bundles/' + n + '/game.js");__FR.ok.push("' + n + '");}catch(e){__FR.fail.push("' + n + ':"+String(e&&e.message||e));}');
  }
  lines.push('try{wx.setStorageSync("bootmark",JSON.stringify(__FR));}catch(e){}', '', '/*__BOOT_FIX4__*/', 'var __FR4={ok:[],fail:[]};');
  for (const n of WASM_NAMES) {
    lines.push('try{require("./bundles/' + n + '/game.js");__FR4.ok.push("' + n + '");}catch(e){__FR4.fail.push("' + n + ':"+String(e&&e.message||e));}');
  }
  lines.push('try{wx.setStorageSync("bootmark4",JSON.stringify(__FR4));}catch(e){}', '');
  return lines.join('\n');
}

const devBlock = [
  '/*__BOOT_FIX3__*/ /* 已停用：真机/预览模式分包脚本由微信运行时执行，主包内不放副本 */',
  '',
  '/*__BOOT_FIX4__*/ /* 已停用：同上 */',
  '',
  '',
].join('\n');

const mode = (process.argv[2] || '').toLowerCase();
if (mode !== 'sim' && mode !== 'dev') {
  console.log('用法: node toggle_mode.js sim|dev');
  process.exit(1);
}

let s = fs.readFileSync(gameJs, 'utf8');
const i = s.indexOf('/*__BOOT_FIX3__*/');
const j = s.indexOf('/*__SDK_STUB__*/');
if (i < 0 || j < 0 || j < i) {
  console.log('未找到 BOOT_FIX3 / SDK_STUB 标记块，已中止');
  process.exit(1);
}
s = s.slice(0, i) + (mode === 'sim' ? simBlock() : devBlock) + s.slice(j);
fs.writeFileSync(gameJs, s, 'utf8');

if (mode === 'sim') {
  if (!fs.existsSync(bundles)) {
    if (!fs.existsSync(bak)) { console.log('缺少 ' + bak + '，无法恢复副本'); process.exit(1); }
    fs.renameSync(bak, bundles);
  }
} else if (fs.existsSync(bundles)) {
  if (fs.existsSync(bak)) fs.rmSync(bak, { recursive: true, force: true });
  fs.renameSync(bundles, bak);
}

function dirSize(p) {
  if (!fs.existsSync(p)) return 0;
  let t = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    t += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
  }
  return t;
}
console.log('模式=' + mode + ' | bundles 存在=' + fs.existsSync(bundles) + ' | game.js ' + Math.round(fs.statSync(gameJs).size / 1024) + ' KB + bundles ' + Math.round(dirSize(bundles) / 1024) + ' KB');