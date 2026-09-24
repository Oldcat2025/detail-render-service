/* 生成一张 1464×600 的宽图底（A+ Detail 常见比例），用于验证贴字在宽画布上的排版。
   把方图按 cover 方式裁切缩放居中，空白处填主题辅色。仅用于样例验证。 */
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('node:fs');

(async () => {
  const src = process.argv[2] || '_samples/base_clean.png';
  const out = process.argv[3] || '_samples/base_wide.png';
  const W = Number(process.argv[4] || 1464);
  const H = Number(process.argv[5] || 600);
  const img = await loadImage(src);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  const s = Math.max(W / img.width, H / img.height);
  const dw = Math.round(img.width * s), dh = Math.round(img.height * s);
  ctx.fillStyle = '#F5EDE0';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
  fs.writeFileSync(out, cv.toBuffer('image/png'));
  console.log(JSON.stringify({ ok: true, out, w: W, h: H, bytes: fs.statSync(out).size }));
})().catch((e) => { console.error('make wide base failed:', e && e.message); process.exit(1); });
