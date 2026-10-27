FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
RUN mkdir -p /app/.runtime && chown node:node /app /app/.runtime
USER node
ENV HOST=0.0.0.0 PORT=8790 HGTV_FFMPEG=/usr/bin/ffmpeg
EXPOSE 8790
CMD ["node","server.mjs"]
