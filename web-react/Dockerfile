# 构建上下文为仓库根目录（需要同时访问 web-react/、web/public 与 deploy/）
FROM node:22-alpine AS build

WORKDIR /app
COPY web-react/package.json web-react/package-lock.json ./web-react/
RUN cd web-react && npm ci --no-audit --no-fund

COPY web-react/ ./web-react/
COPY web/public/ ./web/public/
RUN cd web-react && npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
