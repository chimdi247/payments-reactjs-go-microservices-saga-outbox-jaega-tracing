# syntax=docker/dockerfile:1
# Stage 1 builds the app with Node. None of it ships.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` when a lockfile is committed (reproducible), `npm install` until then.
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi
COPY . .
RUN npm run build

# Stage 2 is what ships: static files behind nginx, as an unprivileged user.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
    CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
