# ---- 生产阶段 ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app

# 创建非 root 用户
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

# 仅复制运行时依赖
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/server ./server
COPY --from=builder --chown=app:app /app/package.json ./

# 种子数据也复制到 data/ 目录（运行时会挂载 volume 覆盖）
COPY --from=builder --chown=app:app /app/server/data ./data

ENV NODE_ENV=production
ENV PORT=4174
ENV DATA_DIR=/app/data

USER app
EXPOSE 4174

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:4174/api/auth/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({member_id:'_health',pin:'_'})}).then(r=>{if(r.status===404||r.status===401)process.exit(0);process.exit(1)})"

CMD ["node", "--import", "tsx", "server/index.ts"]
