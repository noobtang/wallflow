# 多阶段构建: install → build → runtime
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# 容器内自迁移(#12): migrate 一次性服务跑 node-pg-migrate up,启动前完成
COPY migrations ./migrations
EXPOSE 3000
CMD ["node", "dist/server.js"]
