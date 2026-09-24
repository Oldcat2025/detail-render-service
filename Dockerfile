FROM node:20-slim

# 字体：canvas 画字必须有字体文件。dejavu 覆盖拉丁字母、免费可分发，
# 路径 /usr/share/fonts/truetype/dejavu/*.ttf 已被 render.js 的字体候选列表覆盖。
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY render.js server.js ./
# 字体随代码一起打包：本地预览与线上出图用**同一份字体文件**，
# 否则字体度量不同 → 同一段文案的断行位置/宽度会不一致（预览就不等于出图了）。
COPY fonts/ ./fonts/

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
