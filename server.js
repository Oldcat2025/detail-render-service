/* 项目29 · A+ Detail 贴字渲染服务
 *
 * 职责：收「底图 + 文案 spec」→ 用 canvas 确定性地把文案画上去 → 返回 PNG（base64）。
 * 它**不碰 OSS 凭据**：出图交给已有的上传服务 /upload 落 OSS（凭据只有一处），
 * 这样新服务零密钥、可随时重建。
 *
 * 与本地预览共用同一份 render.js（预览什么样、出图就什么样）。
 *
 * 路由：
 *   GET  /health            健康检查（含字体注册情况，字体缺失会在这里暴露）
 *   POST /render            渲染；默认回 base64 JSON，?format=png 回二进制 PNG
 *        body: { baseImageUrl? | baseImageBase64?, spec:{badge,title,bullets[],cta,colors{},panel,reserveRatio,style{}} }
 *        回：  { ok:true, format:'base64', imageBase64, layout }
 *   鉴权：设了 RENDER_TOKEN 就必须带 Authorization: Bearer <token>
 */
'use strict';
const http = require('node:http');
const { renderDetail } = require('./render');

const PORT = parseInt(process.env.PORT || '8080', 10);
const TOKEN = process.env.RENDER_TOKEN || '';
const MAX_BODY = 12 * 1024 * 1024; // 12MB，够放 1K 底图的 base64

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    const { GlobalFonts } = require('@napi-rs/canvas');
    let families = [];
    try { families = GlobalFonts.families.map((f) => f.family); } catch (e) { families = ['<err:' + e.message + '>']; }
    return send(res, 200, { ok: true, service: 'detail-render', fonts: families, authRequired: !!TOKEN });
  }

  if (req.method === 'POST' && url.pathname === '/render') {
    if (TOKEN) {
      const auth = req.headers['authorization'] || '';
      if (auth !== 'Bearer ' + TOKEN) return send(res, 401, { ok: false, error: 'unauthorized' });
    }
    try {
      const raw = await readBody(req);
      const p = JSON.parse(raw || '{}');
      const spec = p.spec || {};
      let base = p.baseImageUrl || '';
      if (!base && p.baseImageBase64) base = Buffer.from(String(p.baseImageBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (!base) return send(res, 400, { ok: false, error: 'baseImageUrl 或 baseImageBase64 必填' });

      const t0 = Date.now();
      const r = await renderDetail({ base, spec });
      const ms = Date.now() - t0;
      if (url.searchParams.get('format') === 'png') {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': r.buffer.length });
        return res.end(r.buffer);
      }
      return send(res, 200, { ok: true, format: 'base64', imageBase64: r.buffer.toString('base64'), bytes: r.buffer.length, ms, layout: r.layout });
    } catch (e) {
      return send(res, 500, { ok: false, error: String((e && e.message) || e) });
    }
  }

  send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => console.log('detail-render listening on ' + PORT + ' (auth=' + (TOKEN ? 'on' : 'off') + ')'));
