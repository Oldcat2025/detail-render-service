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

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
