FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json tsup.config.ts vite.config.ts ./
COPY src/ src/
RUN npm run build:all

# --- Production image ---
FROM node:20-slim

WORKDIR /app

# Install mltl CLI (required for marketplace operations)
RUN npm install -g @moltlaunch/cli 2>/dev/null || true

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/dist/ dist/

# Create data directory with proper permissions
RUN mkdir -p /data/.cashclaw && chown -R node:node /data

# Run as non-root user
USER node

# Point config dir at persistent volume
ENV HOME=/data
ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 3777

CMD ["node", "dist/index.js"]
