#!/usr/bin/env node
/**
 * 数控车削编程助手 · M0 断言测试
 * 覆盖：数据层自检（G/M 代码、材料、螺纹）、纯函数（螺纹尺寸、分刀、转速、工件卡）、
 *       工件卡导入导出往返、单文件结构闸门、体积闸门。
 * 用法：node tests/run-tests.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app.html');
const VOLUME_LIMIT = 600 * 1024;

let pass = 0;
const fails = [];

function ok(cond, label, extra){
  if(cond){ pass++; return true; }
  fails.push(label + (extra ? '  →  ' + extra : ''));
  return false;
}
function eq(actual, expected, label){
  return ok(actual === expected, label, 'actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
}
function near(actual, expected, tol, label){
  const good = typeof actual === 'number' && isFinite(actual) && Math.abs(actual - expected) <= tol;
  return ok(good, label, 'actual=' + actual + ' expected=' + expected + ' ±' + tol);
}
function throwsNot(fn, label){
  try{ fn(); return ok(true, label); }
  catch(e){ return ok(false, label, e.message); }
}

/* ---------- 载入单文件应用 ---------- */
const html = fs.readFileSync(APP, 'utf8');

function extractScript(id){
  const re = new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>');
  const m = html.match(re);
  return m ? m[1] : null;
}

const src = extractScript('app-js');
ok(!!src, 'app.html 里能取到 id="app-js" 的主脚本');
ok(src && src.length > 15000, '主脚本规模合理（>15KB）', src ? src.length : 0);

const store = {};
const sandbox = {
  console,
  window: {},
  localStorage: {
    getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v){ store[k] = String(v); }
  },
  document: { getElementById(){ return null; }, querySelectorAll(){ return []; } }
};
vm.createContext(sandbox);
let T = null;
throwsNot(function(){
  vm.runInContext(src, sandbox, {filename:'app-js'});
  T = sandbox.window.TURN;
}, '主脚本在无 DOM 环境下可安全求值（boot 被守卫）');
ok(!!T, 'window.TURN 已导出测试接口');

/* ---------- 1. 版本 ---------- */
ok(/^v\d+\.\d+\.\d+/.test(T.VERSION), '版本号符合 vX.Y.Z 格式', T.VERSION);

/* ---------- 2. G 代码表 ---------- */
const G = T.GCODES;
ok(Array.isArray(G), 'GCODES 是数组');
eq(G.length, 42, 'G 代码条数为 42');

const CATS = ['运动','坐标系','循环','刀补','主轴与进给','M 代码'];
const gSeen = new Set();
let dupG = [], badCode = [], badCat = [], emptyText = [];
G.forEach(function(it){
  if(!/^G\d{2}$/.test(it.c)) badCode.push(it.c);
  if(gSeen.has(it.c)) dupG.push(it.c);
  gSeen.add(it.c);
  if(CATS.indexOf(it.cat) < 0) badCat.push(it.c + ':' + it.cat);
  if(!it.n || !it.d) emptyText.push(it.c);
});
eq(dupG.length, 0, 'G 代码无重复编号', dupG.join(','));
eq(badCode.length, 0, 'G 代码编号格式统一为 G+两位数字', badCode.join(','));
eq(badCat.length, 0, 'G 代码分类都在允许集合内', badCat.join(','));
eq(emptyText.length, 0, 'G 代码名称与说明均非空', emptyText.join(','));

/* 双含义指令必须有 dual 文案 */
const DUAL = ['G50','G90','G92','G94'];
DUAL.forEach(function(c){
  const it = G.find(function(x){ return x.c === c; });
  ok(!!it, c + ' 存在于 G 代码表');
  ok(!!(it && it.dual && it.dual.length > 20), c + ' 标注了双含义且文案够用', it && it.dual ? it.dual.length : 0);
});
const dualCount = G.filter(function(x){ return !!x.dual; }).length;
eq(dualCount, 4, '双含义指令恰好 4 条（G50/G90/G92/G94）');

/* 关键教学指令不能缺席 */
['G71','G72','G73','G74','G75','G76','G70','G96','G97','G99','G41','G42','G40'].forEach(function(c){
  ok(gSeen.has(c), '教学必讲指令已收录：' + c);
});

/* ---------- 3. M 代码表 ---------- */
const M = T.MCODES;
eq(M.length, 12, 'M 代码条数为 12');
const mSeen = new Set();
let badM = [];
M.forEach(function(it){
  if(!/^M\d{2}$/.test(it.c)) badM.push(it.c);
  if(mSeen.has(it.c)) badM.push('dup:' + it.c);
  mSeen.add(it.c);
  if(!it.n || !it.d) badM.push('empty:' + it.c);
});
eq(badM.length, 0, 'M 代码编号格式正确、无重复、文案非空', badM.join(','));
['M03','M05','M08','M30','M98','M99'].forEach(function(c){
  ok(mSeen.has(c), '常用 M 指令已收录：' + c);
});
eq(G.length + M.length, 54, '指令总数 54 条（G 42 + M 12）');

/* ---------- 4. 材料表 ---------- */
const MATS = T.MATERIALS;
eq(MATS.length, 12, '材料表 12 条');
const matKeys = new Set();
let matBad = [];
MATS.forEach(function(m){
  if(matKeys.has(m.k)) matBad.push('dup:' + m.k);
  matKeys.add(m.k);
  ['vcR','vcF','fR','fF','apR','apF'].forEach(function(f){
    if(!(typeof m[f] === 'number' && m[f] > 0)) matBad.push(m.k + '.' + f);
  });
  if(!(m.vcR <= m.vcF)) matBad.push(m.k + ':粗车线速度应不大于精车');
  if(!(m.fR >= m.fF)) matBad.push(m.k + ':粗车进给应不小于精车');
  if(!(m.apR >= m.apF)) matBad.push(m.k + ':粗车切深应不小于精车');
  if(!m.name || !m.note) matBad.push(m.k + ':缺少名称或备注');
  if(!(m.hb >= 0 && m.hb <= 350)) matBad.push(m.k + ':硬度超出合理范围');
});
eq(matBad.length, 0, '材料表数值自洽（粗≥精、均>0、硬度合理）', matBad.slice(0, 6).join(' | '));
ok(!!T.materialOf('45'), 'materialOf 能取到 45 钢');
eq(T.materialOf('不存在的材料'), null, 'materialOf 对未知键返回 null');

/* ---------- 5. 螺纹表 ---------- */
const TH = T.THREADS;
eq(TH.length, 20, '螺纹表 20 条');
const thSeen = new Set();
let thBad = [];
TH.forEach(function(t){
  const id = t.d + 'x' + t.p;
  if(thSeen.has(id)) thBad.push('dup:' + id);
  thSeen.add(id);
  if(!(t.d > 0) || !(t.p > 0)) thBad.push(id + ':数值非法');
  if(['粗牙','细牙'].indexOf(t.kind) < 0) thBad.push(id + ':类型非法');
});
eq(thBad.length, 0, '螺纹规格无重复且数值合法', thBad.join(','));
eq(TH.filter(function(t){ return t.kind === '粗牙'; }).length, 15, '粗牙 15 条');
eq(TH.filter(function(t){ return t.kind === '细牙'; }).length, 5, '细牙 5 条');

let basicBad = [];
TH.forEach(function(t){
  const b = T.threadBasic(t.d, t.p);
  if(!b){ basicBad.push(t.d + 'x' + t.p + ':返回空'); return; }
  if(!(b.d2 < t.d)) basicBad.push(t.d + 'x' + t.p + ':中径不小于大径');
  if(!(b.d1std < b.d2)) basicBad.push(t.d + 'x' + t.p + ':标准小径不小于中径');
  if(!(b.d1exp < b.d2)) basicBad.push(t.d + 'x' + t.p + ':经验小径不小于中径');
  if(!(b.d1exp > 0)) basicBad.push(t.d + 'x' + t.p + ':经验小径不为正');
  if(Math.abs(b.d2 - (t.d - 0.6495 * t.p)) > 1e-9) basicBad.push(t.d + 'x' + t.p + ':中径公式偏离');
  if(Math.abs(b.d1std - (t.d - 1.0825 * t.p)) > 1e-9) basicBad.push(t.d + 'x' + t.p + ':标准小径公式偏离');
  if(Math.abs(b.d1exp - (t.d - 1.299 * t.p)) > 1e-9) basicBad.push(t.d + 'x' + t.p + ':经验小径公式偏离');
  if(!(b.hExp > b.h1std)) basicBad.push(t.d + 'x' + t.p + ':经验牙深应大于标准牙型高');
});
eq(basicBad.length, 0, '20 条螺纹的基本尺寸全部符合公式', basicBad.slice(0, 5).join(' | '));

/* M30×3.5 具体数值 */
const b30 = T.threadBasic(30, 3.5);
near(b30.hExp, 2.2733, 0.001, 'M30×3.5 经验牙深 ≈ 2.2733mm');
near(b30.d1exp, 25.45, 0.01, 'M30×3.5 经验小径 ≈ 25.45mm（d − 1.3P）');
near(b30.d1std, 26.2112, 0.001, 'M30×3.5 标准小径 ≈ 26.211mm');
near(b30.d2, 27.7268, 0.001, 'M30×3.5 中径 ≈ 27.727mm');

/* ---------- 6. 螺纹分刀 ---------- */
[4, 5, 6].forEach(function(n){
  const h = 2.2733;
  const ps = T.threadPasses(h, n);
  eq(ps.length, n, '分刀数 ' + n + ' 时返回 ' + n + ' 刀');
  let accOk = true, desc = true, sum = 0;
  for(let i = 0; i < ps.length; i++){
    sum += ps[i].ap;
    if(i > 0 && !(ps[i].ap < ps[i - 1].ap)) desc = false;
    if(i > 0 && !(ps[i].acc > ps[i - 1].acc)) accOk = false;
  }
  ok(desc, '分刀 ' + n + '：每刀切深严格递减');
  ok(accOk, '分刀 ' + n + '：累计切深单调递增');
  near(sum, h, 0.02, '分刀 ' + n + '：各刀之和等于牙深');
  near(ps[ps.length - 1].acc, h, 0.02, '分刀 ' + n + '：末刀累计等于牙深');
  ok(ps[ps.length - 1].ap <= h * 0.2, '分刀 ' + n + '：末刀切深不超过牙深的 20%');
});
eq(T.threadPasses(2.27, 9).length, 5, '非法刀数回落到默认 5 刀');
eq(T.threadPasses(-1, 5).length, 0, '牙深非法时返回空数组');
ok(T.threadPasses(2.27, 4).every(function(p){ return typeof p.ap === 'number' && isFinite(p.ap); }), '分刀返回值全部为有限数');

/* ---------- 7. 转速 ---------- */
near(T.calcRpm(130, 50), 827.6, 0.1, 'vc130 + Φ50 → 828 r/min');
near(T.calcRpm(300, 20), 4774.6, 0.5, 'vc300 + Φ20 → 4775 r/min');
ok(isNaN(T.calcRpm(0, 50)), '线速度为 0 时转速返回 NaN');
ok(isNaN(T.calcRpm(130, 0)), '直径为 0 时转速返回 NaN');
eq(T.clampRpm(827.6, 800), 800, 'G50 限速 800 时转速被压到 800');
eq(T.clampRpm(500, 800), 500, '未超限速时转速不变');
eq(T.clampRpm(500, NaN), 500, '未设限速时返回原值');

/* ---------- 8. 工件卡规范化 ---------- */
const dft = T.cardNormalize(T.CARD_DEFAULT);
eq(dft.blankD, 50, '默认毛坯直径 50');
eq(dft.material, '45', '默认材料 45 钢');
const c1 = T.cardNormalize({blankD:'60', blankL:'100', clampLen:'30', partLen:'65', material:'6061', threadD:'20', threadP:'2.5'});
eq(c1.blankD, 60, '字符串数字被转成数值');
eq(c1.material, '6061', '合法材料键被保留');
const c2 = T.cardNormalize({blankD:9999, blankL:-5, clampLen:0, partLen:0, material:'乱写', threadD:0, threadP:0});
eq(c2.blankD, 500, '毛坯直径超上限被夹到 500');
eq(c2.blankL, 1, '毛坯长度低于下限被夹到 1');
eq(c2.material, '45', '非法材料键回落到默认');
const c3 = T.cardNormalize({});
eq(c3.blankD, 50, '空对象返回默认值');
const c4 = T.cardNormalize({blankD:NaN, blankL:undefined});
eq(c4.blankD, 50, 'NaN 回落到默认值');
Object.keys(c1).forEach(function(k){
  ok(typeof c1[k] === 'number' || typeof c1[k] === 'string' || Array.isArray(c1[k]), '规范化后字段类型正确：' + k);
});

/* ---------- 9. 工件卡校验 ---------- */
eq(T.cardValidate(dft).length, 0, '默认工件卡无问题');
const bad1 = T.cardValidate(T.cardNormalize({blankD:50, blankL:80, clampLen:80, partLen:10, material:'45', threadD:30, threadP:3.5}));
ok(bad1.some(function(i){ return i.field === 'clampLen' && i.level === 'bad'; }), '夹持长等于毛坯长时报错');
const bad2 = T.cardValidate(T.cardNormalize({blankD:50, blankL:80, clampLen:25, partLen:70, material:'45', threadD:30, threadP:3.5}));
ok(bad2.some(function(i){ return i.field === 'partLen' && i.level === 'bad'; }), '零件长超出可用长度时报错');
const bad3 = T.cardValidate(T.cardNormalize({blankD:50, blankL:80, clampLen:20, partLen:50, material:'45', threadD:30, threadP:3.5}));
ok(bad3.some(function(i){ return i.field === 'clampLen' && i.level === 'warn'; }), '夹持长不足半个直径时给警告');
const bad4 = T.cardValidate(T.cardNormalize({blankD:50, blankL:80, clampLen:25, partLen:50, material:'45', threadD:10, threadP:8}));
ok(bad4.some(function(i){ return i.field === 'threadP' && i.level === 'bad'; }), '螺距过大时报错');
const bad5 = T.cardValidate(T.cardNormalize({blankD:50, blankL:80, clampLen:25, partLen:55, material:'45', threadD:30, threadP:3.5}));
ok(bad5.some(function(i){ return i.field === 'partLen' && i.level === 'warn'; }), '零件长接近上限时给警告');
ok(bad1.concat(bad2, bad3, bad4, bad5).every(function(i){ return i.msg && i.msg.length > 6; }), '所有问题文案都可读（>6 字）');

/* ---------- 10. 导入导出往返 ---------- */
const card = T.cardNormalize({blankD:45, blankL:90, clampLen:28, partLen:60, material:'304', threadD:24, threadP:3});
const json = T.exportCard(card);
ok(json.indexOf('"schema": 1') > 0, '导出内容带 schema 版本');
ok(json.indexOf('"app": "turn-aid"') > 0, '导出内容带应用标识');
const back = T.importCard(json);
ok(back.ok, '导出的工件卡能重新导入');
eq(JSON.stringify(back.card), JSON.stringify(card), '导入导出往返数据完全一致');

eq(T.importCard('这不是 json').ok, false, '非 JSON 输入被拒绝');
ok(/JSON/.test(T.importCard('这不是 json').err), '拒绝原因指出 JSON 问题');
eq(T.importCard('{}').ok, false, '空对象被拒绝');
eq(T.importCard('{"card":{"blankD":50}}').ok, true, '只给一个数值字段也能导入');
eq(T.importCard(JSON.stringify({card:{nope:1}})).ok, false, '没有任何数值字段时拒绝');
eq(T.importCard(JSON.stringify({card:{blankD:9999,blankL:80,clampLen:25,partLen:60,material:'45',threadD:30,threadP:3.5}})).card.blankD, 500, '导入时越界值同样被规范化');

/* ---------- 11. 其他纯函数 ---------- */
near(T.round2(2.345), 2.35, 1e-9, 'round2 处理浮点边界 2.345 → 2.35');
near(T.round2(1.005), 1.01, 1e-9, 'round2 处理浮点边界 1.005 → 1.01');
ok(isNaN(T.round2(NaN)), 'round2(NaN) 返回 NaN');
ok(isNaN(T.round2(Infinity)), 'round2(Infinity) 返回 NaN');
eq(T.threadLabel({d:30, p:3.5, kind:'粗牙'}), 'M30×3.5（粗牙）', '螺纹标签格式正确');
ok(!!T.threadByDP(30, 3.5), 'threadByDP 能按公称+螺距命中');
eq(T.threadByDP(30, 2.5), null, '不存在的规格返回 null');
eq(T.threadByDP(10, 1.25).kind, '细牙', '同直径不同螺距能区分粗细牙');

/* ---------- 12. 单文件结构闸门 ---------- */
ok(/^<!DOCTYPE html>/i.test(html.trim()), 'HTML 以 DOCTYPE 开头');
ok(/<html lang="zh-CN">/.test(html), '语言声明为 zh-CN');
ok(/<meta charset="utf-8">/i.test(html), '声明了 UTF-8 编码');
ok(/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(html), '声明了 viewport');
ok(/<title>[^<]{4,}<\/title>/.test(html), '有非空 title');

const navIds = (html.match(/data-p="([a-z]+)"/g) || []).map(function(s){ return s.replace(/data-p="|"/g, ''); });
eq(navIds.length, 10, '导航按钮 10 个');
const panelIds = (html.match(/class="panel[^"]*" id="panel-([a-z]+)"/g) || []).map(function(s){ return s.replace(/.*panel-/, '').replace(/"$/, ''); });
eq(panelIds.length, 10, '面板容器 10 个');
const diff = navIds.filter(function(x){ return panelIds.indexOf(x) < 0; })
  .concat(panelIds.filter(function(x){ return navIds.indexOf(x) < 0; }));
eq(diff.length, 0, '导航与面板一一对应', diff.join(','));

const h2n = (html.match(/<h2[^>]*>[\s\S]{2,40}?<\/h2>/g) || []).length;
ok(h2n >= 10, '每个面板都有 h2 标题（实际 ' + h2n + ' 个）');

ok(!/(src|href)\s*=\s*["']https?:/i.test(html), '无外部 http(s) 资源引用（零依赖）');
ok(!/@import/.test(html), 'CSS 无 @import 外链');
ok(!/\son[a-z]+\s*=\s*"/i.test(html), '无内联 on* 事件属性（统一走 addEventListener）');
ok(html.indexOf('<script src=') < 0, '无外部 script 标签');

/* 无障碍：表单控件都要有 label[for] */
const ids = (html.match(/<(?:input|select)[^>]*\sid="([^"]+)"/g) || []).map(function(s){ return s.match(/id="([^"]+)"/)[1]; });
const noLabel = ids.filter(function(id){
  if(id === 'c-file') return false;               /* 隐藏的文件选择器，由按钮触发 */
  return !new RegExp('<label[^>]*\\sfor="' + id + '"').test(html);
});
eq(noLabel.length, 0, '所有可见表单控件都有 label[for]', noLabel.join(','));
ok(/<nav[^>]*aria-label=/.test(html), 'nav 有 aria-label');
ok(/<thead>/.test(html), '速查表有 thead');
ok(/aria-live="polite"/.test(html), '工件卡问题区为 live region');

/* ---------- 13. 体积闸门 ---------- */
const size = fs.statSync(APP).size;
ok(size < VOLUME_LIMIT, 'app.html 体积小于 600KB 闸门', Math.round(size / 1024) + 'KB');
ok(size < 300 * 1024, 'app.html 体积仍在 M0 预算 300KB 内', Math.round(size / 1024) + 'KB');
ok(html.indexOf('data:image/') < 0, '未嵌入 base64 图片（帮助配图须用内联 SVG）');

/* ---------- 14. E1 解析器：单行分词 ---------- */
const t1 = T.tokenize('G71 U2 R1;');
eq(t1.words.length, 3, '分词：G71 U2 R1 得到 3 个地址字');
eq(t1.words[0].a, 'G', '第一个地址字是 G');
eq(t1.words[0].num, 71, 'G 值为 71');
eq(t1.words[1].a, 'U', '第二个地址字是 U');
eq(t1.words[1].num, 2, 'U 值为 2');
eq(t1.multi, false, '单段行不标记 multi');

const t2 = T.tokenize('G01 Z0 F0.15 (车端面);');
eq(t2.comment, '车端面', '圆括号注释被提取');
eq(t2.code.indexOf('('), -1, '注释已从语句中剥离');
eq(t2.words.length, 3, '带注释行仍解析出 3 个地址字');

const t3 = T.tokenize('T0101;');
eq(t3.words[0].a, 'T', 'T 指令被识别');
eq(t3.words[0].raw, 'T0101', 'T 指令保留前导零的原始写法');

const t4 = T.tokenize('G00 X50;G01 Z0;');
eq(t4.multi, true, '一行多段被标记 multi');
eq(t4.code, 'G00 X50', '多段行只取首段');

const t5 = T.tokenize('');
eq(t5.code, '', '空行得到空语句');
eq(t5.words.length, 0, '空行没有地址字');

const t6 = T.tokenize('N10 G00 X26;');
eq(t6.words[0].a, 'N', 'N 顺序号被识别');
eq(t6.words[0].num, 10, 'N 值为 10');

const t7 = T.tokenize('G71 P10 Q20 U0.5 W0.1 F0.25;');
eq(t7.words.length, 6, 'G71 指定行解析出 6 个地址字');
eq(T.tokenize('O0004;').words[0].a, 'O', 'O 号被识别为地址字');

/* ---------- 15. 循环块配对 ---------- */
const g71Prog = T.TEMPLATES.filter(function(t){ return t.id === 'g71'; })[0].code;
const P71 = T.parseProgram(g71Prog);
eq(P71.blocks.length, 2, '模板 4 解析出 2 个循环块（G71 + G70）');
const b71 = P71.blocks[0];
eq(b71.type, 'G71', '第一个块是 G71');
eq(b71.p, 10, 'G71 的 P 段号为 10');
eq(b71.q, 20, 'G71 的 Q 段号为 20');
eq(b71.u1, 2, 'G71 参数行 U（每刀切深）为 2');
eq(b71.r1, 1, 'G71 参数行 R（退刀）为 1');
eq(b71.u2, 0.5, 'G71 指定行 U（X 余量·直径）为 0.5');
eq(b71.w2, 0.1, 'G71 指定行 W（Z 余量）为 0.1');
eq(b71.f, 0.25, 'G71 指定行进给 0.25');
ok(b71.bodyFrom > 0 && b71.bodyTo > b71.bodyFrom, 'G71 轮廓块的行号区间成立', b71.bodyFrom + '→' + b71.bodyTo);
eq(P71.rows[b71.bodyFrom - 1].label, 10, 'bodyFrom 指向 N10 所在行');
eq(P71.rows[b71.bodyTo - 1].label, 20, 'bodyTo 指向 N20 所在行');
eq(P71.stats.folded, b71.bodyTo - b71.bodyFrom + 1, '折叠行数等于轮廓段行数');
eq(P71.blocks[1].type, 'G70', '第二个块是 G70 精车');
eq(P71.blocks[1].p, 10, 'G70 的 P 段与粗车一致');

const P73 = T.parseProgram(T.TEMPLATES.filter(function(t){ return t.id === 'g73'; })[0].code);
eq(P73.blocks[0].type, 'G73', '模板 5 首块为 G73');
eq(P73.blocks[0].u1, 6, 'G73 的 U（X 向退让）为 6');
eq(P73.blocks[0].r1, 4, 'G73 的 R（分刀次数）为 4');

const P76 = T.parseProgram(T.TEMPLATES.filter(function(t){ return t.id === 'g76'; })[0].code);
eq(P76.blocks[0].type, 'G76', '模板 8 首块为 G76');
eq(P76.blocks[0].p1, 21060, 'G76 第一行 P 被读入');
eq(P76.blocks[0].x, 25.45, 'G76 第二行小径 25.45');
eq(P76.blocks[0].f, 3.5, 'G76 第二行螺距 3.5');

const bad = T.parseProgram('G71 U2 R1;\nG71 P10 Q99 U0.5 W0.1 F0.25;');
eq(bad.blocks.length, 1, 'P/Q 段号不存在时块仍被记录');
eq(bad.blocks[0].bodyFrom, null, '找不到 N10 时 bodyFrom 为空，不误判轮廓区间');

const h = T.g76Head(21060);
eq(h.m, '02', 'G76 的 P 拆出精车次数 02');
eq(h.r, '10', 'G76 的 P 拆出退尾 10');
eq(h.a, '60', 'G76 的 P 拆出牙型角 60');

/* ---------- 16. 解释器 ---------- */
const X71 = T.explainProgram(g71Prog);
const blockRows = X71.rows.filter(function(r){ return r.kind === 'block'; });
ok(blockRows.length >= 3, '解释结果里有块级条目（参数行 + 指定行 + G70）', blockRows.length);
const firstBlock = blockRows[0].text;
ok(firstBlock.indexOf('粗车') >= 0, 'G71 块被翻译成「粗车」语义', firstBlock.slice(0, 40));
ok(firstBlock.indexOf('2mm') >= 0, '块文案带出每刀切深 2mm');
ok(firstBlock.indexOf('0.5mm') >= 0, '块文案带出 X 余量 0.5mm');
const bodyRows = X71.rows.filter(function(r){ return r.kind === 'body-in'; });
eq(bodyRows.length, b71.bodyTo - b71.bodyFrom + 1, '轮廓段全部标为 body-in');
ok(bodyRows[0].text.indexOf('G71') >= 0, '轮廓段文案指明所属循环', bodyRows[0].text.slice(0, 30));
ok(bodyRows[0].text.indexOf('不会按顺序') >= 0, '轮廓段文案说明不按顺序执行');

const plain = X71.rows.filter(function(r){ return r.kind === 'stmt'; });
ok(plain.some(function(r){ return r.text.indexOf('主轴正转') >= 0; }), 'M03 被翻译成「主轴正转」');
ok(plain.some(function(r){ return r.text.indexOf('公制输入') >= 0; }), 'G21 被翻译成「公制输入」');
ok(plain.some(function(r){ return r.text.indexOf('刀补') >= 0; }), 'T 指令说明里带出刀补号');
ok(plain.some(function(r){ return r.text.indexOf('直径值') >= 0; }), 'X 地址字标注为直径值');
const Xf = T.explainProgram('G99;\nG01 X50 Z-10 F0.2;');
ok(Xf.rows.some(function(r){ return r.text.indexOf('mm/r') >= 0; }), 'G99 下 F 标注为每转进给 mm/r');
const Xg = T.explainProgram('G98;\nG01 X50 Z-10 F120;');
ok(Xg.rows.some(function(r){ return r.text.indexOf('mm/min') >= 0; }), 'G98 下 F 标注为每分钟进给 mm/min');

const X76 = T.explainProgram(T.TEMPLATES.filter(function(t){ return t.id === 'g76'; })[0].code);
const t76 = X76.rows.filter(function(r){ return r.kind === 'block'; })[0].text;
ok(t76.indexOf('牙型角 60') >= 0, 'G76 块文案带出牙型角 60°', t76.slice(0, 60));
ok(t76.indexOf('螺距 3.5') >= 0, 'G76 块文案带出螺距 3.5');
ok(t76.indexOf('2.273') >= 0, 'G76 块文案把 P2273 换算成 2.273mm 牙高');

const Xun = T.explainProgram('G71 U2 R1;\nG71 P10 Q20 U0.5 W0.1 F0.25;\nN10 G01 X50;\nN20 X52;');
const un76 = Xun.rows.filter(function(r){ return r.kind === 'body-in'; });
eq(un76.length, 2, '自造两行轮廓被正确折叠');

/* ---------- 17. 模板完整性 ---------- */
eq(T.TEMPLATES.length, 10, '模板 10 个');
eq(new Set(T.TEMPLATES.map(function(t){ return t.id; })).size, 10, '模板 id 无重复');
const tplBad = [];
T.TEMPLATES.forEach(function(t){
  if(!t.name || t.name.length < 4) tplBad.push(t.id + ':名称过短');
  if(!t.code || t.code.length < 60) tplBad.push(t.id + ':正文过短');
  if(!/^O\d{4};/.test(t.code)) tplBad.push(t.id + ':首行不是 O 号');
  if(!/M30;$/.test(t.code.trim())) tplBad.push(t.id + ':末行不是 M30');
  const P = T.parseProgram(t.code);
  if(P.stats.unknownG > 0) tplBad.push(t.id + ':含未收录 G ' + P.stats.unknownG);
  if(P.stats.stmt < 8) tplBad.push(t.id + ':段数过少');
});
eq(tplBad.length, 0, '10 个模板结构完整、指令全部已收录', tplBad.slice(0, 4).join(' | '));

const g71Tpl = T.TEMPLATES.filter(function(t){ return t.id === 'g71'; })[0];
eq(T.parseProgram(g71Tpl.code).blocks.length, 2, '粗车模板含 G71 与 G70 两个块');
const mixTpl = T.TEMPLATES.filter(function(t){ return t.id === 'mixed'; })[0];
eq(T.parseProgram(mixTpl.code).blocks.length, 3, '综合件模板含 G71/G70/G76 三个块');

eq(T.SNIPPETS.length, 14, '快捷片段 14 条');
ok(T.SNIPPETS.every(function(s){ return s.name && s.code; }), '每条片段都有名称和代码');

/* ---------- 18. 参数计算 ---------- */
const p1 = T.calcParams({matKey:'45', d:50, op:'rough', mode:'G97', rpmMax:2000});
eq(p1.vc, 130, '45 钢粗车 vc=130');
eq(p1.f, 0.3, '45 钢粗车 f=0.3');
eq(p1.ap, 2.5, '45 钢粗车 ap=2.5');
near(p1.rpm, 827.6, 0.1, 'Φ50 下转速 828 r/min');
eq(p1.limited, false, '未超最高转速时不标记限速');
near(p1.vcActual, 130, 1e-9, '未限速时实际线速度等于设定值');
near(p1.fmm, 248.3, 0.2, '每分钟进给 = f × n');

const p2 = T.calcParams({matKey:'45', d:50, op:'rough', rpmMax:800});
eq(p2.limited, true, '超最高转速时标记限速');
eq(p2.rpm, 800, '转速被压到 800');
near(p2.vcActual, 125.66, 0.05, '限速后实际线速度降到 125.66 m/min');

const p3 = T.calcParams({matKey:'6061', d:20, op:'finish', rpmMax:0});
eq(p3.vc, 450, '6061 精车 vc=450');
eq(p3.op, 'finish', '工序标记为精车');
near(p3.rpm, 7161.9, 1, 'Φ20 铝件精车转速约 7162');
eq(p3.limited, false, '未设限速时不标记限速');

const p4 = T.calcParams({matKey:'不存在的材料', d:50});
eq(p4.matName, T.MATERIALS[0].name, '未知材料回落第一项');
ok(isNaN(T.calcParams({matKey:'45', d:0}).rpm), '直径为 0 时转速为 NaN');

/* ---------- 19. 分刀与切槽 ---------- */
eq(T.pickPassCount(1), 4, '螺距 1.0 分 4 刀');
eq(T.pickPassCount(1.25), 4, '螺距 1.25 分 4 刀');
eq(T.pickPassCount(1.5), 5, '螺距 1.5 分 5 刀');
eq(T.pickPassCount(2.5), 5, '螺距 2.5 分 5 刀');
eq(T.pickPassCount(3.5), 6, '螺距 3.5 分 6 刀');
eq(T.pickPassCount(0), 5, '非法螺距回落到 5 刀');

const g1 = T.groovePasses(12, 3);
eq(g1.count, 4, '12mm 槽用 3mm 刀切 4 刀');
eq(g1.rest, 0, '12mm 槽正好切净');
eq(g1.steps[0].z, 0, '首刀 Z 位移为 0');
near(g1.steps[1].z, -3, 1e-9, '第二刀 Z 位移 -3mm');
const g2 = T.groovePasses(10, 3);
eq(g2.count, 4, '10mm 槽用 3mm 刀切 4 刀');
near(g2.steps[3].width, 1, 1e-9, '最后一刀只走 1mm 剩余量');
eq(g2.rest, 0, '10mm 槽切净无残料');
const g3 = T.groovePasses(2, 3);
eq(g3.count, 0, '刀宽大于槽宽时不出刀');
eq(g3.over, true, '刀宽大于槽宽时标记 over');
eq(T.groovePasses(0, 3), null, '槽宽为 0 返回 null');
eq(T.pad2(1), '01', 'pad2 补零到两位');
eq(T.pad2(71), '71', 'pad2 保留两位数');

/* ---------- 20. 解释器：双含义与特殊行 ---------- */
function exText(code){
  return T.explainProgram(code).rows.map(function(r){ return r.text; }).join(' | ');
}
ok(exText('O0004;').indexOf('程序号 O0004') >= 0, 'O 号被译成「程序号」而不是无指令字');
ok(exText('O0004;').indexOf('无 G/M 指令字') < 0, 'O 号行不再出现「无指令字」');
ok(exText('T0101;').indexOf('1 号刀 + 1 号刀补') >= 0, 'T 指令译出刀号与刀补号');
ok(exText('T0101;').indexOf('无 G/M 指令字') < 0, 'T 指令行不再自相矛盾');
ok(exText('T0303;').indexOf('3 号刀 + 3 号刀补') >= 0, 'T0303 译成 3 号刀 3 号刀补');

ok(exText('G50 S1800;').indexOf('限制主轴最高转速') >= 0, 'G50 带 S 判为限速');
ok(exText('G50 S1800;').indexOf('主轴最高转速上限') >= 0, 'G50 限速时 S 释义为转速上限');
ok(exText('G50 X100 Z100;').indexOf('设定工件坐标系') >= 0, 'G50 带 X/Z 判为设坐标系');
ok(exText('G90;').indexOf('绝对值编程方式') >= 0, 'G90 单独出现判为绝对值编程');
ok(exText('G90 X40 Z-30 F0.2;').indexOf('外圆切削循环') >= 0, 'G90 带坐标判为外圆循环');
ok(exText('G90 X40 Z-30 F0.2;').indexOf('绝对值编程方式') < 0, 'G90 循环行不再提示绝对值编程');
ok(exText('G92 X29 Z-28 F1.5;').indexOf('螺纹切削循环') >= 0, 'G92 带 X/Z/F 判为螺纹循环');
ok(exText('G96 S150 M03;').indexOf('恒线速 m/min') >= 0, 'G96 下 S 释义为线速度');
ok(exText('G01 Z-10 F0.2;').indexOf('每转进给 mm/r') >= 0, '默认 G99 下 F 释义为 mm/r');
ok(exText(';') === '', '只有分号的行解释为空');

/* ---------- 21. E2 校验引擎 ---------- */
const CORPUS = require('./corpus.js');
const R = T.RULES;
eq(R.length, 50, '规则总数 50 条');
eq(new Set(R.map(function(r){ return r.code; })).size, 50, '规则编号无重复');
eq(R.filter(function(r){ return r.lv === 'S'; }).length, 6, 'S 级（阻断）恰好 6 条');
const LV_OK = ['S','E','W','I'], GRP_OK = ['结构','循环','刀补','螺纹','参数安全','尺寸'];
const ruleBad = [];
R.forEach(function(r){
  if(LV_OK.indexOf(r.lv) < 0) ruleBad.push(r.code + ':级别非法');
  if(GRP_OK.indexOf(r.group) < 0) ruleBad.push(r.code + ':分组非法');
  if(!r.title || r.title.length < 4) ruleBad.push(r.code + ':标题过短');
  if(!r.why || r.why.length < 12) ruleBad.push(r.code + ':why 文案过短');
  if(!r.fix || r.fix.length < 6) ruleBad.push(r.code + ':fix 文案过短');
  if(typeof r.check !== 'function') ruleBad.push(r.code + ':缺少 check');
  if(!Array.isArray(r.needs)) ruleBad.push(r.code + ':needs 不是数组');
});
eq(ruleBad.length, 0, '50 条规则字段完整、级别与分组合法', ruleBad.slice(0, 4).join(' | '));
const NEED_KEYS = ['blankD','blankL','clampLen','partLen','material','threadD','threadP','tools'];
const needBad = [];
R.forEach(function(r){ r.needs.forEach(function(f){ if(NEED_KEYS.indexOf(f) < 0) needBad.push(r.code + ':' + f); }); });
eq(needBad.length, 0, 'needs 只引用工件卡真实字段', needBad.join(','));
const needCount = R.filter(function(r){ return r.needs.length > 0; }).length;
eq(needCount, 13, '需要上下文数据的规则 13 条');
eq(R.filter(function(r){ return r.group === '结构'; }).length, 9, '结构组 9 条');
eq(R.filter(function(r){ return r.group === '循环'; }).length, 15, '循环组 15 条');
eq(R.filter(function(r){ return r.group === '刀补'; }).length, 7, '刀补组 7 条');
eq(R.filter(function(r){ return r.group === '螺纹'; }).length, 7, '螺纹组 7 条');
eq(R.filter(function(r){ return r.group === '参数安全'; }).length, 8, '参数安全组 8 条');
eq(R.filter(function(r){ return r.group === '尺寸'; }).length, 4, '尺寸组 4 条');

eq(CORPUS.BAD.length, 50, '反例语料 50 条');
eq(new Set(CORPUS.BAD.map(function(c){ return c.rule; })).size, 50, '每条规则各有一条反例');

const CARD0 = T.cardNormalize(T.CARD_DEFAULT);
const missed = [];
CORPUS.BAD.forEach(function(c){
  const res = T.lintProgram(c.code, CARD0);
  const hit = res.issues.some(function(i){ return i.code === c.rule; });
  if(!hit) missed.push(c.rule + '（实际报出：' + (res.issues.map(function(i){ return i.code; }).join(',') || '无') + '）');
});
eq(missed.length, 0, '50 条反例全部被对应规则检出（0 漏报）', missed.slice(0, 5).join(' | '));

/* 10 个模板必须干净：0 个 S、0 个 E */
const dirty = [];
T.TEMPLATES.forEach(function(t){
  const res = T.lintProgram(t.code, CARD0);
  if(res.counts.s > 0 || res.counts.e > 0){
    dirty.push(t.id + '：S' + res.counts.s + ' E' + res.counts.e + ' [' + res.issues.filter(function(i){ return i.lv === 'S' || i.lv === 'E'; }).map(function(i){ return i.code; }).join(',') + ']');
  }
});
eq(dirty.length, 0, '10 个模板全部 0 个 S / 0 个 E（无假阳性）', dirty.join(' | '));

const tplScore = T.lintProgram(T.TEMPLATES[3].code, CARD0).score;
eq(tplScore, 100, '合格模板得满分 100');

const sHit = T.lintProgram(CORPUS.BAD.filter(function(c){ return c.rule === 'P04'; })[0].code, CARD0);
eq(sHit.score, 0, 'S 级问题直接判 0 分');
ok(sHit.issues.some(function(i){ return i.lv === 'S'; }), 'P04 反例确实判为 S 级');

/* NA：把夹持长度清零，依赖它的规则必须进「未判定」而不是静默通过 */
const cardNoClamp = T.cardNormalize({blankD:50, blankL:90, clampLen:0, partLen:60, material:'45', threadD:30, threadP:3.5});
const naRes = T.lintProgram(T.TEMPLATES[6].code, cardNoClamp);
ok(naRes.na.length >= 2, '缺夹持长度时有规则进入未判定', naRes.na.length);
ok(naRes.na.some(function(n){ return n.code === 'P05'; }), 'P05 因缺夹持长度进入未判定');
ok(naRes.na.some(function(n){ return n.code === 'M04'; }), 'M04 因缺夹持长度进入未判定');
ok(naRes.na.every(function(n){ return n.missing.length > 0; }), '每个未判定项都写明缺哪个字段');
ok(naRes.judged < 50, '未判定时已判定条数相应减少', naRes.judged);
eq(naRes.judged + naRes.na.length, 50, '已判定 + 未判定 = 50');

/* 上下文真的被消费：同一段程序换毛坯直径，P04 结论会变 */
const prog25 = 'O0001;\nG21 G99 G54;\nT0101;\nM03 S800;\nG00 X25 Z2;\nG01 Z-10 F0.2;\nM30;';
const with50 = T.lintProgram(prog25, T.cardNormalize({blankD:50, blankL:90, clampLen:25, partLen:60, material:'45', threadD:30, threadP:3.5}));
const with20 = T.lintProgram(prog25, T.cardNormalize({blankD:20, blankL:90, clampLen:25, partLen:60, material:'45', threadD:30, threadP:3.5}));
ok(with50.issues.some(function(i){ return i.code === 'P04'; }), '毛坯 Φ50 时 X25 被判为半径写法');
ok(!with20.issues.some(function(i){ return i.code === 'P04'; }), '毛坯 Φ20 时同样的 X25 不再误报');

/* 工具函数 */
eq(T.scoreOf([]), 100, '无问题得 100 分');
eq(T.scoreOf([{lv:'E'},{lv:'E'}]), 80, '两个 E 扣 20 分');
eq(T.scoreOf([{lv:'W'}]), 96, '一个 W 扣 4 分');
eq(T.scoreOf([{lv:'I'},{lv:'I'}]), 100, 'I 级不扣分');
eq(T.scoreOf([{lv:'S'},{lv:'E'}]), 0, '只要出现 S 就是 0 分');
eq(T.scoreOf([{lv:'E'},{lv:'E'},{lv:'E'},{lv:'E'},{lv:'E'},{lv:'E'},{lv:'E'},{lv:'E'},{lv:'E'},{lv:'E'},{lv:'E'}]), 0, '扣到负数时归 0');

/* 工件卡刀具表 */
eq(T.cardDefault().tools.length, 4, '默认刀具表 4 把刀');
eq(T.cardDefault().tools[0].tip, 3, '1 号外圆刀方位号 3');
const dupTool = T.cardNormalize({tools:[{t:1,type:'外圆刀',r:0.4,tip:3},{t:1,type:'内孔刀',r:0.4,tip:2}]});
ok(T.cardValidate(dupTool).some(function(i){ return i.field === 'tools' && i.level === 'bad'; }), '刀具表同号重复会被校验拦下');
const weirdTool = T.cardNormalize({tools:[{t:5,type:'外圆刀',r:0.4,tip:3,blade:3}]});
ok(T.cardValidate(weirdTool).some(function(i){ return i.level === 'warn'; }), '外圆刀填了刀宽会给警告');

/* ---------- 22. E3 刀轨引擎 ---------- */
function pathOf(code){
  const P = T.parseProgram(code);
  T.walkRows(P);
  return T.buildPath(P, T.cardNormalize(T.CARD_DEFAULT));
}
const PA = pathOf(T.TEMPLATES[3].code);
ok(PA.segs.length >= 8, '粗车模板能生成 8 段以上轨迹', PA.segs.length);
ok(PA.counts.rapid >= 1, '轨迹里有快速移动段', PA.counts.rapid);
ok(PA.counts.cut >= 5, '轨迹里有切削段', PA.counts.cut);
ok(PA.maxX >= 52, '轨迹最大直径不低于 52', PA.maxX);
ok(PA.minZ <= -45, '轨迹最深 Z 到 -45 以下', PA.minZ);
eq(PA.segs[0].type, 'rapid', '第一段是快速移动');
near(PA.segs[0].from.x, 52, 1e-9, '第一段从起刀点 X52 出发');
near(PA.segs[0].to.x, 26, 1e-9, '第一段快速移动到 X26');
ok(PA.segs.some(function(x){ return x.contour === 'G71'; }), '轮廓段被标记为 G71 块内');
ok(PA.segs.every(function(x){ return typeof x.ln === 'number' && x.ln > 0; }), '每段都带程序行号（供联动）');

const arcPath = pathOf('O0001;\nG21 G99 G54;\nT0101;\nM03 S800;\nG00 X50 Z2;\nG01 Z0 F0.2;\nG02 X40 Z-5 R5 F0.1;\nM30;');
eq(arcPath.counts.arc, 1, 'G02 段被识别为圆弧');
eq(arcPath.segs.filter(function(x){ return x.type === 'arc'; })[0].cw, true, 'G02 标记为顺时针');

const groovePath = pathOf(T.TEMPLATES[5].code);
ok(groovePath.segs.some(function(x){ return x.groove; }), '切槽模板里 G75 段被标记');

const threadPath = pathOf(T.TEMPLATES[6].code);
ok(threadPath.segs.some(function(x){ return x.thread; }), '螺纹模板里螺纹段被标记');

const emptyPath = pathOf('');
eq(emptyPath.segs.length, 0, '空程序没有轨迹段');
const dupPath = pathOf('O0001;\nG21;\nG00 X50 Z0;\nX50;\nM30;');
eq(dupPath.segs.length, 0, '原地不动的段不生成轨迹');

/* ---------- 23. M3：变异、出题、批改、刀具 ---------- */
const BATCHTEXT = [
  T.TEMPLATES[3].code,
  T.TEMPLATES[3].code.replace('G50 S1800;\n', ''),
  T.TEMPLATES[3].code.replace(/X(\d+(?:\.\d+)?)/g, function(m, n){ return 'X' + (parseFloat(n) / 2); }),
  T.TEMPLATES[3].code.replace('U0.5 W0.1', 'U0 W0')
].join('\n=====\n');
eq(T.MUTATIONS.length, 10, '变异库 10 种');
eq(new Set(T.MUTATIONS.map(function(m){ return m.id; })).size, 10, '变异 id 无重复');
const mutBad = [];
T.MUTATIONS.forEach(function(m){
  const base = m.baseCode || T.TEMPLATES.filter(function(t){ return t.id === m.base; })[0].code;
  const mutated = m.apply(base);
  if(mutated === base) mutBad.push(m.id + '：注入后程序没变化');
  const res = T.lintProgram(mutated, CARD0);
  if(!res.issues.some(function(i){ return i.code === m.rule; })) mutBad.push(m.id + '：未被 ' + m.rule + ' 检出');
});
eq(mutBad.length, 0, '10 种变异全部被对应规则检出', mutBad.join(' | '));

const d1 = T.makeDrill(7), d2 = T.makeDrill(7);
eq(d1.index, d2.index, '同一 seed 出同一道题');
eq(d1.code, d2.code, '同一 seed 的题目内容一致');
eq(d1.mutation.id, T.MUTATIONS[7].id, 'seed 7 对应第 8 种变异');
ok(T.makeDrill(13).index === 3, 'seed 超出范围时取模回绕', T.makeDrill(13).index);

eq(T.splitBySep('A\n=====\nB\n=====\nC').length, 3, '按 ===== 切成 3 份');
eq(T.splitBySep('   ').length, 0, '空白输入切出 0 份');
eq(T.splitBySep('A\n==\nB').length, 1, '分隔符不足 3 个等号时不切');

const batchRows = T.runBatch(BATCHTEXT, CARD0);
eq(batchRows.length, 4, '演示批次 4 份');
eq(batchRows[0].score, 100, '第一份（合格模板）100 分');
ok(batchRows[1].score < batchRows[0].score, '漏 G50 的那份分数更低');
eq(batchRows[2].s >= 1, true, 'X 按半径写的那份出现 S 级');
ok(batchRows[3].score < 100, '余量写 0 的那份被扣分');
ok(batchRows.every(function(r){ return r.judged > 0; }), '每份都记录了已判定规则数');
const csv = T.batchCsv(batchRows);
eq(csv.split('\n').length, 5, 'CSV 含表头 + 4 行');
ok(csv.indexOf('序号,段数,得分') === 0, 'CSV 表头正确');

eq(T.TIP_TABLE.length, 6, '方位号对照表 6 条');
eq(T.tipInfo('外圆刀', '车外圆（右→左）').tip, 3, '外圆刀车外圆方位号 3');
eq(T.tipInfo('外圆刀', '车外圆（右→左）').comp, 'G42', '外圆刀配 G42');
eq(T.tipInfo('内孔刀', '车内孔（孔口向内）').comp, 'G41', '内孔刀配 G41');
eq(T.tipInfo('切槽刀', '径向切槽').comp, 'G40', '切槽不用刀补');
eq(T.tipInfo('不存在', '不存在'), null, '未知组合返回 null');

const of1 = T.offsetFix(49.6, 50);
near(of1.delta, -0.4, 1e-9, '实测 49.6 / 程序 50 -> 差 -0.4');
ok(of1.note.indexOf('加') >= 0, '偏小时提示往加的方向修');
const of2 = T.offsetFix(50.3, 50);
near(of2.delta, 0.3, 1e-9, '实测 50.3 -> 差 +0.3');
ok(of2.note.indexOf('减') >= 0, '偏大时提示往减的方向修');
eq(T.offsetFix(0, 50), null, '实测为 0 时返回 null');
eq(T.offsetFix(50, 50).delta, 0, '刚好时差值为 0');

/* ---------- 24. M4：帮助与讲义 ---------- */
eq(T.HELP.length, 9, '帮助条目 9 条');
ok(T.HELP.every(function(h){ return h.t && h.id; }), '每条帮助都有标题与 id');
eq(T.helpSearch('').length, 9, '空关键词返回全部');
eq(T.helpSearch('刀补').length >= 1, true, '搜「刀补」能命中');
ok(T.helpSearch('刀补').length < 9, '搜「刀补」是筛选而非全量', T.helpSearch('刀补').length);
eq(T.helpSearch('G71').length >= 1, true, '搜「G71」能命中');
eq(T.helpSearch('不存在的词').length, 0, '无匹配时返回空');
eq(T.helpSearch('  刀补  ').length, T.helpSearch('刀补').length, '关键词首尾空格被忽略');
eq(T.helpSearch('刀补').length, T.helpSearch('刀补'.toUpperCase()).length, '大小写不敏感');

const HO = T.handoutText(T.TEMPLATES[3].code, CARD0);
ok(HO.indexOf('# 数控车削编程讲义') === 0, '讲义以标题开头');
ok(HO.indexOf('## 二、程序') > 0, '讲义含程序章节');
ok(HO.indexOf('## 三、校验结果：100 分') > 0, '讲义含校验结果且得分为 100', HO.slice(0, 0) || '');
ok(HO.indexOf('## 四、轨迹统计') > 0, '讲义含轨迹统计');
ok(HO.indexOf('未经真实试切验证') > 0, '讲义带安全声明');
ok(HO.indexOf('T1 外圆刀') > 0, '讲义列出刀具表');
ok(HO.split('\n').length > 25, '讲义内容有足够篇幅', HO.split('\n').length);

const HO2 = T.handoutText(CORPUS.BAD.filter(function(c){ return c.rule === 'P04'; })[0].code, CARD0);
ok(HO2.indexOf('0 分') > 0, '含 S 级的作业讲义标 0 分');
ok(HO2.indexOf('为什么：') > 0, '讲义里问题带原因');
ok(HO2.indexOf('怎么改：') > 0, '讲义里问题带改法');

/* ---------- 25. 圆弧插值、刀尖 R、题库 ---------- */
const ap1 = T.arcPoints({x:0,z:0}, {x:20,z:0}, 10, false, 12);
ok(!!ap1, '半圆能算出采样点');
eq(ap1.pts.length, 12, '采样点数等于步数');
near(ap1.pts[ap1.pts.length - 1].x, 20, 1e-6, '末点 X 回到终点');
near(ap1.pts[ap1.pts.length - 1].z, 0, 1e-6, '末点 Z 回到终点');
near(ap1.center.z, -8.660254, 1e-5, '圆心在弦的一侧（离弦 8.66）');
near(Math.abs(ap1.sweep), Math.PI / 3, 1e-6, '弦长 10、R10 时扫角为 60°');
const onCircle = ap1.pts.every(function(pt){
  const dx = pt.x / 2 - ap1.center.x / 2, dz = pt.z - ap1.center.z;
  return Math.abs(Math.sqrt(dx*dx + dz*dz) - 10) < 1e-6;
});
ok(onCircle, '所有采样点都落在半径 10 的圆上');
const apCw = T.arcPoints({x:0,z:0}, {x:20,z:0}, 10, true, 8);
ok(apCw.sweep < 0 && ap1.sweep > 0, 'G02 与 G03 取相反方向的圆心', apCw.sweep);

const arcSeg = (function(){
  const P = T.parseProgram('O0001;\nG21 G99 G54;\nT0101;\nM03 S800;\nG00 X50 Z0;\nG02 X30 Z-10 R10 F0.1;\nM30;');
  T.walkRows(P);
  return T.buildPath(P, CARD0).segs.filter(function(x){ return x.type === 'arc'; })[0];
})();
ok(!!arcSeg.pts && arcSeg.pts.length > 5, '轨迹里的圆弧段带采样点', arcSeg.pts ? arcSeg.pts.length : 0);
ok(!!arcSeg.center, '圆弧段记下了圆心');

eq(T.noseResidual(0.4), 0.4, '刀尖 R0.4 的端面残留取 0.4');
eq(T.noseResidual(0), 0, '无效刀尖半径返回 0');

eq(T.QUIZ.length, 10, '题库 10 题');
const quizBad = T.QUIZ.filter(function(x){ return !x.q || !x.opts || x.opts.length !== 4 || typeof x.ans !== 'number' || !x.why; });
eq(quizBad.length, 0, '每题四个选项、有答案与解析', quizBad.length);
eq(T.QUIZ.filter(function(x){ return x.ans < 0 || x.ans > 3; }).length, 0, '答案索引都在 0~3');
const allRight = T.gradeQuiz(T.QUIZ.map(function(x){ return x.ans; }));
eq(allRight.right, 10, '全对得 10 题');
eq(allRight.score, 100, '全对 100 分');
const allWrong = T.gradeQuiz(T.QUIZ.map(function(x){ return (x.ans + 1) % 4; }));
eq(allWrong.right, 0, '全错 0 题');
eq(allWrong.score, 0, '全错 0 分');
const half = T.gradeQuiz([0,1,2,3,0,1,2,3,0,1]);
eq(half.detail.length, 10, '判分返回 10 条明细');
ok(half.detail.filter(function(d){ return d.ok; }).length === half.right, '明细里的正确数与总分一致');
eq(T.gradeQuiz([]).right, 0, '未作答按 0 分');

/* ---------- 汇总 ---------- */
const total = pass + fails.length;
console.log('');
console.log('数控车削编程助手 · M0+M1+M2 断言测试');
console.log('--------------------------------------------');
console.log('文件体积：' + Math.round(size / 1024) + ' KB（闸门 ' + (VOLUME_LIMIT / 1024) + ' KB）');
console.log('数据规模：G ' + G.length + ' + M ' + M.length + ' · 材料 ' + MATS.length + ' · 螺纹 ' + TH.length);
console.log('断言结果：' + pass + ' / ' + total + ' 通过');
if(fails.length){
  console.log('');
  fails.forEach(function(f, i){ console.log('  ✗ [' + (i + 1) + '] ' + f); });
  console.log('');
  process.exit(1);
}
console.log('全部断言通过（0 失败）');
process.exit(0);
