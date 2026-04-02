FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:all

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install moltlaunch CLI globally
RUN npm install -g moltlaunch

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3777

CMD ["/app/start.sh"]
