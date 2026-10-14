# Admin / licensing API + admin web UI (one container). Build from the repository root:
#   docker build -f apps/admin-api/Dockerfile -t osuite-admin-api .
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-api ./apps/admin-api
COPY apps/admin-web ./apps/admin-web
RUN pnpm install --frozen-lockfile --filter @osuite/admin-api... --filter @osuite/admin-web...
RUN pnpm --filter @osuite/admin-web build && pnpm --filter @osuite/admin-api build

FROM node:24-alpine
ENV NODE_ENV=production PORT=47900 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/admin-api/dist ./
USER node
EXPOSE 47900
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:47900/health || exit 1
CMD ["node", "--enable-source-maps", "admin-api.cjs"]
