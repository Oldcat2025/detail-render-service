/* 生成「模块F 修好之后应该产出的底图」样例：左侧保留区干净、产品完整落在右侧。
   用途：验证贴字在真实版面契约下不会再压到产品（客户反馈的问题）。
   用法：node make_mock_base.js <产品图> <输出> [宽] [高] [保留区比例] */
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('node:fs');

(async () => {
  const src = process.argv[2];
  const out = process.argv[3];
  const W = Number(process.argv[4] || 1464);
  const H = Number(process.argv[5] || 600);
  const reserve = Number(process.argv[6] || 0.42);
  if (!src || !out) { console.error('usage: node make_mock_base.js <product> <out> [W] [H] [reserve]'); process.exit(1); }

  const img = await loadImage(src);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');

  /* 背景：主题辅色 + 轻渐层，模拟影棚背景 */
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#F7F1E6');
  bg.addColorStop(1, '#EFE3D2');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* 产品完整落在右侧区域：等比缩放到「右侧可放区域」内，垂直居中 */
  const zoneX = Math.round(W * reserve);
  const zoneW = W - zoneX;
  const padX = Math.round(zoneW * 0.10), padY = Math.round(H * 0.08);
  const maxW = zoneW - padX * 2, maxH = H - padY * 2;
  const s = Math.min(maxW / img.width, maxH / img.height);
  const dw = Math.round(img.width * s), dh = Math.round(img.height * s);
  ctx.drawImage(img, Math.round(zoneX + padX + (maxW - dw) / 2), Math.round((H - dh) / 2), dw, dh);

  fs.writeFileSync(out, cv.toBuffer('image/png'));
  console.log(JSON.stringify({ ok: true, out, W, H, reserveZone: zoneX + '..' + W, product: dw + 'x' + dh, bytes: fs.statSync(out).size }));
})().catch((e) => { console.error('mock base failed:', e && e.message); process.exit(1); });
