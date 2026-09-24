# detail-render · A+ Detail 图确定性贴字服务（项目29）

把 A+ Detail 图的文案**确定性地**画在底图上（canvas），替代原先「把文案塞进提示词让 AI 画字」的做法。

## 为什么

AI 画字会产出 `Crafts-manship` 这类**断词/错字**，且字重、行距、颜色不可控。
本服务断行按**整词测量**（代码里没有连字符这条路），字号/颜色来自 `theme_config`（权威源）。

## 与底图之间的「版面契约」（重要）

文案只画在**保留区**内，因此底图必须把保留区留空：

| 参数 | 默认 | 含义 |
|---|---|---|
| `panel` | `left` | 文案在左还是右（产品在哪边就放另一边） |
| `reserveRatio` | `0.42` | 保留区宽度占画布比例 —— **必须与提示词里的留空比例一致** |

色板只在保留区内渐隐；文案超宽时**整组等比缩小**（不改断词规则，最小 0.62 倍）。

## 接口

```
GET  /health                  → { ok, fonts:[...], authRequired }
POST /render                  → { ok, imageBase64, bytes, ms, layout }
         body: { baseImageUrl | baseImageBase64, spec }
         ?format=png          → 直接回 image/png 二进制
鉴权：设了 RENDER_TOKEN 就必须带 Authorization: Bearer <token>
```

`spec` 示例（值全部来自 6.2 主题包 / Product DNA）：

```json
{
  "badge": "BEST SELLER",
  "title": "Cozy Coastal Throw Pillow Covers",
  "bullets": ["Chenille Fabric", "Handwoven Texture", "Indoor Outdoor", "Machine Washable"],
  "cta": "SHOP NOW",
  "colors": { "primary": "#1E5C8B", "secondary": "#F5EDE0", "accent": "#5C3A26" },
  "panel": "left",
  "reserveRatio": 0.42
}
```

返回的 `layout`（`reserveW / textMaxW / scale / blockH`）是**可验收的版面证据**：
`textMaxW ≤ reserveW - 2×pad` 且 `scale = 1` 表示文案完整落在保留区内、未被压缩。

## 本服务不碰 OSS 凭据

出图交给已有上传服务 `/upload` 落 OSS（凭据只有一处），因此本服务零密钥、可随时重建。

## 本地跑

```bash
npm install
node server.js                                  # 默认 8080
node render.js --base _samples/mock_wide.png --spec spec_coastal.json --out out.png
```

CLI 与 HTTP 服务调用的是**同一个 `renderDetail()`** —— 预览什么样，出图就什么样。

## 部署

Zeabur（arbitrary git + Dockerfile）。镜像里装 `fonts-dejavu-core` 提供字体
（`render.js` 的字体候选列表已覆盖 `/usr/share/fonts/truetype/dejavu/*.ttf`）。
