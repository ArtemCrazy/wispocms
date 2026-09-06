FROM node:24-alpine AS builder

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter web...

ARG API_PROXY_URL=http://api:4000
ARG WISPO_ASSET_VERSION
ENV API_PROXY_URL=$API_PROXY_URL
ENV WISPO_ASSET_VERSION=$WISPO_ASSET_VERSION

COPY apps/web apps/web
RUN pnpm --dir apps/web build

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --chown=node:node --from=builder /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=builder /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
