# api + worker 共用。worker 需要系统 ffmpeg。
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci

ENV NODE_ENV=production
EXPOSE 4000

CMD ["npm", "run", "start", "-w", "@videox/api"]
