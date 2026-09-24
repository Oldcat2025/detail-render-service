/* 项目29 · A+ Detail 图确定性贴字渲染器（v1.2）
 *
 * v1.2 修的问题（客户实拍反馈）：「文字盖住了产品一部分」。
 *   根因：底图里产品占满整个画布，而文案区直接叠在左侧 —— 两者必然压在一起。
 *   修法（两侧一起做，缺一边都还会压产品）：
 *     A. **底图那边留空**：模块F 的 Detail 提示词改成「产品完整落在右侧 N%，
 *        左侧 N% 必须是干净背景、不要任何文字」——这是"版面契约"。
 *     B. **渲染这边只在保留区内作画**：色板只覆盖保留区（不再横跨到产品上）、
 *        文案宽度超出保留区时**自动整组缩小**（确定性地，不改断词规则）。
 *   另外支持 spec.panel = 'left' | 'right'，产品在哪边就把文案放另一边。
 *
 * 设计约定：
 *   1. 预览与真推必须调用同一个 renderDetail()；
 *   2. 所有几何量按画布尺寸比例算（方图 / 宽图同一套参数）；
 *   3. 断行按整词测量，绝不拆词（AI 断词 bug 的结构性修复）；
 *   4. 返回布局元数据（实际文案宽度 / 是否触发缩放），供调用方记录与验收。
 *
 * 用法（CLI）：node render.js --base <图片路径|URL> --spec spec.json --out out.png
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const FONT_CANDIDATES = [
  ['fonts/DejaVuSans-Bold.ttf', 'RenderSans', 'bold'],
  ['fonts/DejaVuSans.ttf', 'RenderSans', 'normal'],
  ['C:/Windows/Fonts/arialbd.ttf', 'ArialB', 'bold'],
  ['C:/Windows/Fonts/arial.ttf', 'ArialR', 'normal'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVuB', 'bold'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVuR', 'normal'],
];
const FONT_STACK = [];
for (const [file, family, weight] of FONT_CANDIDATES) {
  const p = path.isAbsolute(file) ? file : path.join(__dirname, file);
  if (!fs.existsSync(p)) continue;
  try { GlobalFonts.registerFromPath(p, family); FONT_STACK.push({ family, weight }); } catch (e) { /* 忽略单个失败 */ }
}
if (!FONT_STACK.length) console.error('[render] 没有可用字体：请把 ttf 放进 ./fonts 或安装系统字体');
const fontOf = (weight, size) => {
  const hit = FONT_STACK.find((f) => f.weight === weight) || FONT_STACK[0];
  return (weight === 'bold' ? '700 ' : '400 ') + Math.round(size) + 'px "' + hit.family + '"';
};

const DEFAULTS = {
  panel: 'left',            // 文案区在哪一侧：left | right（产品在哪边就放另一边）
  reserveRatio: 0.42,       // 保留区宽度占画布宽比例（必须与底图提示词里的留空比例一致）
  marginRatio: 0.045,       // 保留区内边距（占画布宽）
  scrim: true,              // 保留区内的渐隐色板（不越界到产品上）
  titleRatio: 0.072, badgeRatio: 0.028, bulletRatio: 0.033, ctaRatio: 0.033,
  gapRatio: 0.024, lineHeight: 1.16,
  minScale: 0.62,           // 文案超宽时允许缩到的最小比例
};

function wrapWords(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const probe = cur ? cur + ' ' + w : w;
    if (ctx.measureText(probe).width <= maxWidth || !cur) cur = probe;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* 测量：返回 {blockH, maxW}；scale 用于超宽时整组缩放 */
function measure(ctx, spec, g, scale) {
  const H = g.H, st = g.st;
  const sz = (r) => Math.max(10, Math.round(H * r * scale));
  const gap = Math.round(H * st.gapRatio * scale);
  const textW = g.reserveW - g.pad * 2;
  let h = 0, maxW = 0;

  if (spec.badge) {
    const fs = sz(st.badgeRatio);
    ctx.font = fontOf('bold', fs);
    const w = ctx.measureText(spec.badge).width + fs * 0.75 * 2;
    maxW = Math.max(maxW, w); h += fs * 1.9 + gap;
  }
  const titleFont = sz(st.titleRatio), lh = Math.round(titleFont * st.lineHeight);
  let titleLines = [];
  if (spec.title) {
    ctx.font = fontOf('bold', titleFont);
    titleLines = wrapWords(ctx, spec.title, textW).slice(0, 3);
    titleLines.forEach((l) => { maxW = Math.max(maxW, ctx.measureText(l).width); });
    h += titleLines.length * lh + Math.round(gap * 0.4);
  }
  const bullets = [];
  for (const b of (spec.bullets || []).slice(0, 5)) {
    const label = String(typeof b === 'string' ? b : (b && (b.text || b.label)) || '').trim();
    if (!label) continue;
    const fs = sz(st.bulletRatio), r = Math.round(fs * 0.26);
    const tx = r * 2 + Math.round(fs * 0.55);
    ctx.font = fontOf('bold', fs);
    const lines = wrapWords(ctx, label.toUpperCase(), textW - tx).slice(0, 2);
    lines.forEach((l) => { maxW = Math.max(maxW, ctx.measureText(l).width + tx); });
    bullets.push({ label, lines, fs, r, tx });
    h += lines.length * Math.round(fs * 1.2) + Math.round(fs * 0.55);
  }
  let ctaH = 0, ctaW = 0, ctaFs = 0;
  if (spec.cta) {
    ctaFs = sz(st.ctaRatio);
    ctx.font = fontOf('bold', ctaFs);
    ctaW = ctx.measureText(spec.cta).width + ctaFs * 1.15 * 2;
    ctaH = ctaFs * 2.3;
    maxW = Math.max(maxW, ctaW);
    h += Math.round(gap * 0.5) + ctaH;
  }
  return { blockH: h, maxW, titleFont, titleLines, bullets, ctaW, ctaH, ctaFs, gap, textW };
}

function draw(ctx, spec, g, m) {
  const st = g.st, x0 = g.reserveX + g.pad;
  let y = g.y0;
  const gap = m.gap;
  if (spec.badge) {
    const fs = Math.max(10, Math.round(g.H * st.badgeRatio * g.scale));
    ctx.font = fontOf('bold', fs);
    const tw = ctx.measureText(spec.badge).width, padX = fs * 0.75, bh = fs * 1.9;
    ctx.fillStyle = g.accent; roundRect(ctx, x0, y, tw + padX * 2, bh, bh / 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle';
    ctx.fillText(spec.badge, x0 + padX, y + bh / 2 + 1);
    y += bh + gap;
  }
  if (m.titleLines.length) {
    ctx.font = fontOf('bold', m.titleFont); ctx.fillStyle = g.primary; ctx.textBaseline = 'alphabetic';
    const lh = Math.round(m.titleFont * st.lineHeight);
    for (const ln of m.titleLines) { ctx.fillText(ln, x0, y + m.titleFont); y += lh; }
    y += Math.round(gap * 0.4);
  }
  for (const b of m.bullets) {
    ctx.font = fontOf('bold', b.fs);
    const cy = y + Math.round(b.fs * 0.55);
    ctx.fillStyle = g.accent;
    ctx.beginPath(); ctx.arc(x0 + b.r, cy, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g.primary;
    let ty = y;
    for (const ln of b.lines) { ctx.fillText(ln, x0 + b.tx, ty + b.fs); ty += Math.round(b.fs * 1.2); }
    y += b.lines.length * Math.round(b.fs * 1.2) + Math.round(b.fs * 0.55);
  }
  if (spec.cta) {
    y += Math.round(gap * 0.5);
    ctx.font = fontOf('bold', m.ctaFs);
    const padX = m.ctaFs * 1.15;
    ctx.fillStyle = g.primary;
    roundRect(ctx, x0, y, m.ctaW, m.ctaH, Math.round(m.ctaH * 0.18)); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle';
    ctx.fillText(spec.cta, x0 + padX, y + m.ctaH / 2 + 1);
  }
}

/**
 * 在底图的「保留区」内确定性地绘制文案（预览与真推共用）。
 * @param {{base: Buffer|string, spec: object}} opt
 * @returns {Promise<{buffer: Buffer, layout: object}>}
 */
async function renderDetail({ base, spec }) {
  const image = typeof base === 'string' ? await loadImage(base) : await loadImage(Buffer.from(base));
  const W = image.width, H = image.height;
  const st = Object.assign({}, DEFAULTS, (spec && spec.style) || {});
  const c = (spec && spec.colors) || {};
  const reserveW = Math.round(W * st.reserveRatio);
  const pad = Math.round(W * st.marginRatio);
  const g = {
    W, H, st, reserveW, pad,
    primary: c.primary || '#1E5C8B',
    secondary: c.secondary || '#F5EDE0',
    accent: c.accent || '#5C3A26',
    panel: st.panel === 'right' ? 'right' : 'left',
    reserveX: st.panel === 'right' ? W - reserveW : 0,
    scale: 1, y0: 0,
  };
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.drawImage(image, 0, 0);

  /* 先按 1.0 量；文案超宽就整组缩小（确定性地，不拆词） */
  let m = measure(ctx, spec, g, 1);
  if (m.maxW > m.textW && m.maxW > 0) {
    g.scale = Math.max(st.minScale, Math.min(1, m.textW / m.maxW));
    m = measure(ctx, spec, g, g.scale);
  }
  /* 文案块在画布内垂直居中；高于可用高度则从顶部排起 */
  const avail = H - pad * 2;
  g.y0 = m.blockH >= avail ? pad : Math.round((H - m.blockH) / 2);

  if (st.scrim) {
    const edge = g.panel === 'right' ? W : 0;
    const inner = g.panel === 'right' ? W - reserveW - pad : reserveW + pad;
    const grad = ctx.createLinearGradient(edge, 0, inner, 0);
    const solid = 'F2', mid = 'CC', clear = '00';
    if (g.panel === 'right') { grad.addColorStop(0, g.secondary + solid); grad.addColorStop(0.75, g.secondary + mid); grad.addColorStop(1, g.secondary + clear); }
    else { grad.addColorStop(0, g.secondary + solid); grad.addColorStop(0.75, g.secondary + mid); grad.addColorStop(1, g.secondary + clear); }
    ctx.fillStyle = grad;
    if (g.panel === 'right') ctx.fillRect(W - reserveW - pad, 0, reserveW + pad, H);
    else ctx.fillRect(0, 0, reserveW + pad, H);
  }
  draw(ctx, spec, g, m);
  return {
    buffer: cv.toBuffer('image/png'),
    layout: { panel: g.panel, reserveW, pad, textMaxW: Math.round(m.maxW), scale: Number(g.scale.toFixed(3)), blockH: Math.round(m.blockH), canvas: W + 'x' + H },
  };
}

module.exports = { renderDetail, wrapWords, fontOf };

if (require.main === module) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  if (!args.base || !args.out) { console.error('usage: node render.js --base <path|url> --spec spec.json --out out.png'); process.exit(1); }
  const spec = args.spec ? JSON.parse(fs.readFileSync(args.spec, 'utf8')) : {};
  renderDetail({ base: args.base, spec })
    .then((r) => { fs.writeFileSync(args.out, r.buffer); console.log(JSON.stringify({ ok: true, out: args.out, bytes: r.buffer.length, layout: r.layout })); })
    .catch((e) => { console.error('render failed:', e && e.message); process.exit(1); });
}
