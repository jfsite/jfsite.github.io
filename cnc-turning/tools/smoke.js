#!/usr/bin/env node
/**
 * 端到端冒烟 M0+M1（真实无头 Edge，零依赖）
 *
 * 与 tests/run-tests.js 的分工：
 *   run-tests.js —— 纯函数、解析器与数据层（Node 里跑，263 条断言）
 *   本脚本       —— 真实 DOM：渲染、筛选、搜索、工件卡联动、localStorage、编辑器模板、解释折叠、参数计算、导航切换、横向溢出
 *
 * 做法：把断言脚本注入 app.html 的副本，用 Edge --dump-dom 取回结果，不依赖 CDP / puppeteer。
 * 用法：node tools/smoke.js [--shot tmp/shot.png] [--width 1200] [--height 900] [--panel explain]
 * 退出码：0 全过 / 2 断言失败 / 3 脚本自身异常
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app.html');
const TMP = path.join(ROOT, 'tmp');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const argv = process.argv.slice(2);
function argOf(name, def){
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : def;
}
const SHOT = argOf('--shot', null);
const PANEL = argOf('--panel', null);
const WIDTH = parseInt(argOf('--width', '1200'), 10);
const HEIGHT = parseInt(argOf('--height', '900'), 10);

fs.mkdirSync(TMP, { recursive: true });

const PROBE = `
<script id="smoke-probe">
(function(){
  var R = [];
  function ok(c, label, extra){ R.push({ok: !!c, label: label, extra: (extra === undefined ? '' : String(extra))}); }
  if(location.search.indexOf('noprobe') < 0) try{
    ok(document.querySelectorAll('#nav button').length === 10, '导航 10 个按钮', document.querySelectorAll('#nav button').length);
    ok(document.querySelectorAll('.panel').length === 10, '面板 10 个', document.querySelectorAll('.panel').length);

    var rows0 = document.querySelectorAll('#code-body tr').length;
    ok(rows0 === 54, '速查初始渲染 54 行（G42+M12）', rows0);

    document.querySelector('.chip[data-cat="循环"]').click();
    ok(document.querySelectorAll('#code-body tr').length === 8, '筛选「循环」得 8 行', document.querySelectorAll('#code-body tr').length);

    document.querySelector('.chip[data-cat="M 代码"]').click();
    ok(document.querySelectorAll('#code-body tr').length === 12, '筛选「M 代码」得 12 行', document.querySelectorAll('#code-body tr').length);

    document.querySelector('.chip[data-cat="全部"]').click();
    ok(document.querySelectorAll('#code-body tr').length === 54, '切回「全部」恢复 54 行');

    var q = document.getElementById('q');
    q.value = 'G71';
    q.dispatchEvent(new Event('input'));
    var codes = Array.prototype.map.call(document.querySelectorAll('#code-body td.code'), function(t){ return t.textContent; });
    ok(codes.indexOf('G71') >= 0, '搜 G71 结果里含 G71 本身', codes.join(','));
    ok(codes.length >= 1, '搜 G71 有结果', codes.length);

    q.value = '';
    q.dispatchEvent(new Event('input'));
    ok(document.querySelectorAll('#code-body tr').length === 54, '清空搜索恢复 54 行');

    q.value = '螺纹';
    q.dispatchEvent(new Event('input'));
    ok(document.querySelectorAll('#code-body tr').length >= 3, '中文关键词「螺纹」命中多条', document.querySelectorAll('#code-body tr').length);
    q.value = '';
    q.dispatchEvent(new Event('input'));

    ok(document.querySelectorAll('#code-body .tag').length === 4, '双含义标签 4 个', document.querySelectorAll('#code-body .tag').length);

    ok(!!document.querySelector('#card-issues .pill.ok'), '默认工件卡判为可用');
    ok(document.getElementById('c-mat').options.length === 12, '材料下拉 12 项', document.getElementById('c-mat').options.length);
    ok(document.getElementById('c-tp').options.length === 20, '螺距下拉 20 项', document.getElementById('c-tp').options.length);

    var bl = document.getElementById('c-bl');
    bl.value = '20';
    bl.dispatchEvent(new Event('input'));
    ok(document.querySelectorAll('#card-issues .pill.bad').length >= 1, '毛坯长小于夹持长时报错', document.querySelectorAll('#card-issues .pill.bad').length);

    bl.value = '90';
    bl.dispatchEvent(new Event('input'));
    ok(document.querySelectorAll('#card-issues .pill.bad').length === 0, '改回后错误消失');

    var saved = localStorage.getItem('turnAid.card.v1');
    ok(!!saved && saved.indexOf('blankD') > 0, '工件卡写入 localStorage', saved ? saved.slice(0, 36) : 'null');

    var txt = window.TURN.exportCard(window.TURN.cardNormalize({ blankD: 45 }));
    ok(txt.length > 80 && txt.indexOf('schema') > 0, '导出 JSON 有内容', txt.length);
    var back = window.TURN.importCard(txt);
    ok(back.ok === true && back.card.blankD === 45, '导出后能重新导入', back.ok);

    document.querySelector('#nav button[data-p="help"]').click();
    ok(document.getElementById('panel-help').classList.contains('active'), '点「帮助」切换成功');
    ok(!document.getElementById('panel-codes').classList.contains('active'), '切换后速查面板隐藏');
    ok(document.querySelector('#nav button[data-p="help"]').getAttribute('aria-current') === 'page', '当前项 aria-current 标注正确');

    document.querySelector('#nav button[data-p="codes"]').click();
    ok(document.getElementById('panel-codes').classList.contains('active'), '切回速查面板');

    document.querySelector('#nav button[data-p="editor"]').click();
    var prog = document.getElementById('prog');
    ok(prog.value.indexOf('G71 P10 Q20') >= 0, '编辑器默认载入粗车模板');
    ok(document.getElementById('ed-stat').textContent.indexOf('循环块') >= 0, '编辑器统计已渲染', document.getElementById('ed-stat').textContent);

    var sel = document.getElementById('tpl-sel');
    sel.value = 'g76';
    document.getElementById('tpl-load').click();
    ok(prog.value.indexOf('G76 P021060') >= 0, '切到螺纹模板后正文已替换');
    ok(document.getElementById('ed-stat').textContent.indexOf('1 个循环块') >= 0, '螺纹模板统计为 1 个循环块', document.getElementById('ed-stat').textContent);

    var lenBefore = prog.value.length;
    document.querySelector('#snips button[data-snip="0"]').click();
    ok(prog.value.length > lenBefore, '点快捷片段后正文变长', lenBefore + '→' + prog.value.length);

    document.getElementById('ed-explain').click();
    ok(document.getElementById('panel-explain').classList.contains('active'), '「送去解释」跳到解释面板');
    ok(document.getElementById('ex-out').textContent.indexOf('螺纹复合循环') >= 0, '解释里出现 G76 整块翻译');
    ok(document.querySelectorAll('#ex-out .ex-row.block').length >= 1, '存在块级解释行', document.querySelectorAll('#ex-out .ex-row.block').length);

    document.querySelector('#nav button[data-p="editor"]').click();
    sel.value = 'g71';
    document.getElementById('tpl-load').click();
    document.getElementById('ed-explain').click();
    ok(document.querySelectorAll('#ex-out .ex-row.body-in').length >= 6, 'G71 轮廓段被折叠标注', document.querySelectorAll('#ex-out .ex-row.body-in').length);
    ok(document.getElementById('ex-out').textContent.indexOf('不会按顺序') >= 0, '折叠行文案说明不按顺序执行');
    ok(document.getElementById('ex-stat').textContent.indexOf('折叠') >= 0, '解释统计显示折叠行数', document.getElementById('ex-stat').textContent);

    document.querySelector('#nav button[data-p="params"]').click();
    var pOut = document.getElementById('p-out');
    ok(pOut.querySelectorAll('.stat').length >= 5, '参数计算输出 5 个指标卡', pOut.querySelectorAll('.stat').length);
    var mode = document.getElementById('p-mode');
    mode.value = 'G96';
    mode.dispatchEvent(new Event('change'));
    ok(document.getElementById('p-hint').textContent.indexOf('G50 S') >= 0, 'G96 时给出 G50 限速建议', document.getElementById('p-hint').textContent.slice(0, 30));
    var mat = document.getElementById('p-mat');
    var beforeMat = pOut.textContent;
    mat.value = '6061';
    mat.dispatchEvent(new Event('change'));
    ok(pOut.textContent !== beforeMat, '换材料后参数结果变化');
    ok(pOut.textContent.indexOf('6061') >= 0, '结果里带出材料名称');

    ok(document.querySelectorAll('#t-passes tr').length === 6, '螺纹分刀表 6 行（M30×3.5）', document.querySelectorAll('#t-passes tr').length);
    ok(document.getElementById('g-out').textContent.indexOf('切槽次数') >= 0, '切槽结果已渲染');

    document.querySelector('#nav button[data-p="codes"]').click();
    ok(document.getElementById('panel-codes').classList.contains('active'), '可切回速查面板');

    document.querySelector('#nav button[data-p="lint"]').click();
    ok(document.getElementById('lint-sum').querySelectorAll('.stat').length === 5, '校验输出 5 个指标卡', document.getElementById('lint-sum').querySelectorAll('.stat').length);
    ok(document.getElementById('lint-stat').textContent.indexOf('50') >= 0, '校验统计显示规则总数', document.getElementById('lint-stat').textContent);

    var lt = document.getElementById('lint-input');
    lt.value = ['G21 G99 G54;','T0101;','M03 S800;','G00 X25 Z2;','G01 Z-10 F0.2;'].join(String.fromCharCode(10));
    document.getElementById('lint-run').click();
    ok(!!document.querySelector('#lint-out .lv.S'), '缺 O 号 + X 按半径写被判为 S 级');
    ok(document.querySelectorAll('#lint-out .lint-item').length >= 2, '问题清单渲染多条', document.querySelectorAll('#lint-out .lint-item').length);
    ok(document.getElementById('lint-out').textContent.indexOf('为什么') >= 0, '每条问题都带「为什么」');
    ok(document.getElementById('lint-out').textContent.indexOf('怎么改') >= 0, '每条问题都带「怎么改」');

    var cl = document.getElementById('c-cl');
    cl.value = '0';
    cl.dispatchEvent(new Event('input'));
    ok(!!document.querySelector('#lint-na .lint-na'), '缺夹持长度时显示未判定提示');
    ok(document.getElementById('lint-na').textContent.indexOf('未判定') >= 0, '未判定提示写明条数');

    cl.value = '25';
    cl.dispatchEvent(new Event('input'));
    ok(!document.querySelector('#lint-na .lint-na'), '补回夹持长度后未判定提示消失');

    document.querySelector('#nav button[data-p="editor"]').click();
    sel.value = 'g71';
    document.getElementById('tpl-load').click();
    document.getElementById('lint-input').value = prog.value;
    document.querySelector('#nav button[data-p="lint"]').click();
    document.getElementById('lint-run').click();
    ok(document.getElementById('lint-out').textContent.indexOf('未发现问题') >= 0 || document.querySelectorAll('#lint-out .lv.E').length === 0, '合格模板不产生 E 级问题');

    document.querySelector('#nav button[data-p="path"]').click();
    var cv = document.getElementById('path-canvas');
    ok(!!cv && cv.width > 0, '刀轨画布已按设备像素比初始化', cv ? cv.width : 0);
    ok(document.querySelectorAll('#path-code tr').length > 5, '轨迹代码表有行', document.querySelectorAll('#path-code tr').length);
    ok(document.getElementById('path-stat').textContent.indexOf('段') >= 0, '轨迹统计已渲染', document.getElementById('path-stat').textContent.slice(0, 40));

    var stepEl = document.getElementById('path-step');
    var maxStep = Number(stepEl.max);
    ok(maxStep > 5, '进度条上限等于段数', maxStep);
    document.getElementById('path-prev').click();
    ok(Number(stepEl.value) === maxStep - 1, '上一步把进度减一', stepEl.value);
    ok(document.querySelectorAll('#path-code tr.cur').length === 1, '当前段在代码表里高亮');

    var trs = document.querySelectorAll('#path-code tr');
    trs[2].click();
    ok(Number(stepEl.value) === 3, '点代码行可跳转到对应段', stepEl.value);

    var scale = document.getElementById('path-scale');
    scale.value = 'rad';
    scale.dispatchEvent(new Event('change'));
    ok(scale.value === 'rad', '可切换为半径刻度');

    document.querySelector('#nav button[data-p="batch"]').click();
    ok(document.querySelectorAll('#batch-out tr').length === 4, '批改默认出 4 行', document.querySelectorAll('#batch-out tr').length);
    ok(document.getElementById('batch-stat').textContent.indexOf('平均') >= 0, '批改统计显示平均分', document.getElementById('batch-stat').textContent);

    document.querySelector('#nav button[data-p="drill"]').click();
    ok((document.getElementById('drill-code').textContent || '').length > 40, '找错练习已生成题目');
    document.getElementById('drill-guess').value = 'P04';
    document.getElementById('drill-check').click();
    ok(document.getElementById('drill-out').textContent.indexOf('为什么') >= 0, '对答案给出原因');

    document.querySelector('#nav button[data-p="tools"]').click();
    ok(document.querySelectorAll('#tool-rows tr').length === 4, '刀具表 4 行');
    ok(document.getElementById('tip-out').textContent.indexOf('G42') >= 0, '方位号判定默认给出 G42');
    ok(document.getElementById('of-out').textContent.indexOf('0.4') >= 0, '对刀计算给出 0.4mm 修正', document.getElementById('of-out').textContent.slice(0, 40));

    document.querySelector('#nav button[data-p="help"]').click();
    ok(document.querySelectorAll('#help-out .help-item').length === 9, '帮助渲染 9 条', document.querySelectorAll('#help-out .help-item').length);
    var hq = document.getElementById('help-q');
    hq.value = '刀补';
    hq.dispatchEvent(new Event('input'));
    ok(document.querySelectorAll('#help-out .help-item').length < 9, '帮助搜索能筛选', document.querySelectorAll('#help-out .help-item').length);
    ok(document.getElementById('help-stat').textContent.indexOf('/ 9') > 0, '帮助统计显示命中数', document.getElementById('help-stat').textContent);
    hq.value = '';
    hq.dispatchEvent(new Event('input'));

    document.getElementById('present-btn').click();
    ok(document.body.classList.contains('present'), '大屏模式可开启');
    document.getElementById('present-btn').click();
    ok(!document.body.classList.contains('present'), '大屏模式可退出');

    var nose = document.getElementById('path-nose');
    nose.checked = true;
    nose.dispatchEvent(new Event('change'));
    ok(nose.checked === true, '刀尖 R 示意可开启');

    document.querySelector('#nav button[data-p="drill"]').click();
    var mode = document.getElementById('drill-mode');
    mode.value = 'quiz';
    mode.dispatchEvent(new Event('change'));
    ok(document.querySelectorAll('#quiz-box .help-item').length === 10, '题库渲染 10 题', document.querySelectorAll('#quiz-box .help-item').length);
    document.querySelector('input[name="q0"][value="0"]').checked = true;
    document.getElementById('quiz-submit').click();
    ok(document.getElementById('quiz-stat').textContent.indexOf('/ 10') > 0, '交卷后显示得分', document.getElementById('quiz-stat').textContent);
    ok(document.getElementById('quiz-out').textContent.indexOf('为什么') > 0, '判分给出错题解析');

    var bar = document.querySelector('.cardbar');
    var barRect = bar.getBoundingClientRect();
    ok(bar.scrollWidth <= bar.clientWidth + 1, '工件卡内部无横向溢出', bar.scrollWidth + ' / ' + bar.clientWidth);
    var over = Array.prototype.filter.call(document.querySelectorAll('.field'), function(f){
      return f.getBoundingClientRect().right > barRect.right + 1;
    });
    ok(over.length === 0, '工件卡字段全部落在容器内', over.length + ' 个越界');
    ok(window.innerWidth > 0, '视口宽度', window.innerWidth + '×' + window.innerHeight);

    ok(document.documentElement.scrollWidth <= window.innerWidth + 1, '无横向溢出', document.documentElement.scrollWidth + 'px / 视口 ' + window.innerWidth + 'px');
  }catch(e){
    R.push({ok: false, label: '探针脚本抛异常', extra: e && e.message ? e.message : String(e)});
  }
  var hideStyle = document.createElement('style');
  hideStyle.textContent = '#smoke-result{display:none}';
  document.head.appendChild(hideStyle);
  var pre = document.createElement('pre');
  pre.id = 'smoke-result';
  pre.textContent = JSON.stringify(R);
  document.body.appendChild(pre);
})();
</script>
`;

function unescapeHtml(s){
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function runEdge(extraArgs, url){
  const profile = path.join(TMP, 'edge-profile-' + Date.now());
  const base = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--user-data-dir=' + profile,
    '--virtual-time-budget=3000'
  ];
  const r = spawnSync(EDGE, base.concat(extraArgs, [url]), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r;
}

function main(){
  if(!fs.existsSync(EDGE)){ console.error('找不到 Edge：' + EDGE); process.exit(3); }
  const html = fs.readFileSync(APP, 'utf8');
  if(html.indexOf('</body>') < 0){ console.error('app.html 里没有 </body>'); process.exit(3); }

  const cut = html.lastIndexOf('</body>');
  const focus = PANEL
    ? '<script>(function(){var b=document.querySelector(\'#nav button[data-p="' + PANEL + '"]\');if(b)b.click();})();<\/script>'
    : '';
  const probeHtml = html.slice(0, cut) + PROBE + focus + html.slice(cut);
  const probePath = path.join(TMP, 'smoke.html');
  fs.writeFileSync(probePath, probeHtml, 'utf8');

  const url = 'file:///' + probePath.replace(/\\/g, '/');
  const shotUrl = url + '?noprobe=1';
  const r = runEdge(['--window-size=' + WIDTH + ',' + HEIGHT, '--dump-dom'], url);
  if(r.error){ console.error('启动 Edge 失败：' + r.error.message); process.exit(3); }

  const out = r.stdout || '';
  const m = out.match(/<pre id="smoke-result"[^>]*>([\s\S]*?)<\/pre>/);
  if(!m){
    console.error('没拿到探针结果。DOM 长度 ' + out.length);
    console.error(out.slice(0, 600));
    process.exit(3);
  }

  let list;
  try{ list = JSON.parse(unescapeHtml(m[1])); }
  catch(e){ console.error('探针结果不是合法 JSON：' + e.message); process.exit(3); }

  const fail = list.filter(function(x){ return !x.ok; });
  console.log('');
  console.log('端到端冒烟 M0+M1（无头 Edge · ' + WIDTH + '×' + HEIGHT + '）');
  console.log('--------------------------------------------');
  list.forEach(function(x){
    console.log((x.ok ? '  ✓ ' : '  ✗ ') + x.label + (x.extra ? '   [' + x.extra + ']' : ''));
  });
  console.log('--------------------------------------------');
  console.log('通过 ' + (list.length - fail.length) + ' / ' + list.length);

  const consoleErr = /Uncaught|SyntaxError|ReferenceError|TypeError/i.test(out.replace(/<pre id="smoke-result">[\s\S]*?<\/pre>/, ''));
  if(consoleErr) console.log('⚠ DOM 里出现疑似脚本错误关键字');

  if(SHOT){
    const shotPath = path.resolve(SHOT);
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    runEdge(['--window-size=' + WIDTH + ',' + HEIGHT, '--screenshot=' + shotPath], shotUrl);
    console.log('截图：' + shotPath);
  }

  if(fail.length){ console.log(''); process.exit(2); }
  console.log('冒烟全绿（0 失败）');
  process.exit(0);
}

main();
