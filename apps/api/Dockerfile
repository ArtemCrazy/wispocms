FROM node:24-alpine AS builder

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter api...

COPY apps/api apps/api
RUN pnpm --filter api build

FROM node:24-alpine AS production-dependencies

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --prod --frozen-lockfile --filter api...

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# YouTube audio is downloaded and converted inside the worker before it is
# sent to Groq Whisper. Both tools are installed in the runtime image only;
# they are never exposed to the browser or accepted as user-supplied commands.
RUN apk add --no-cache ffmpeg yt-dlp
RUN apk add --no-cache chromium

RUN mkdir -p /data/media && chown node:node /data/media

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json

USER node

EXPOSE 4000
CMD ["node", "apps/api/dist/main"]
