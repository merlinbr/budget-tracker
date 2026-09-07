FROM node:24-alpine AS build

WORKDIR /workspace
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2.10-alpine
COPY --from=build /workspace/dist/budget-tracker/browser /srv
COPY Caddyfile /etc/caddy/Caddyfile
