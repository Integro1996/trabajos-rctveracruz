FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine
COPY --from=frontend /build/dist /srv/www
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
