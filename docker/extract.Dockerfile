# The extraction step's image: Node for the tools, ffmpeg to decode Sonic Origins' CRIWARE audio.
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.base.json ./
COPY packages/engine packages/engine
COPY tools tools
COPY games games
COPY docker/extract.sh docker/extract.sh
CMD ["sh", "docker/extract.sh"]
