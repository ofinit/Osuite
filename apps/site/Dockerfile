# Marketing website for osuite.business: static pages served by nginx.
# Build from the repository root:
#   docker build -f apps/site/Dockerfile --build-arg SITE_API=https://api.osuite.business -t osuite-site .
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/site ./apps/site
RUN pnpm install --frozen-lockfile --filter @osuite/site...
# Prices and business details are read from here at build time and refreshed in the browser.
ARG SITE_API=https://api.osuite.business
ENV SITE_API=$SITE_API
RUN pnpm --filter @osuite/site build

FROM nginx:1.29-alpine
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/site/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
