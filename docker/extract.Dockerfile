# The extraction step's image: Node for the tools, ffmpeg to decode Sonic Origins' CRIWARE audio.
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
