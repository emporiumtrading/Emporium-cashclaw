FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:all

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

# Install moltlaunch CLI globally
RUN npm install -g moltlaunch

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3777

# Startup script: symlink moltlaunch wallet to persistent volume, then start
COPY <<'EOF' /app/start.sh
#!/bin/sh
if [ -n "$FLY_APP_NAME" ]; then
  mkdir -p /data/melista /data/moltlaunch
  # Symlink moltlaunch wallet dir to persistent volume
  rm -rf /root/.moltlaunch
  ln -sf /data/moltlaunch /root/.moltlaunch
  # Symlink melista config dir to persistent volume
  rm -rf /root/.melista
  ln -sf /data/melista /root/.melista
fi
exec node dist/index.js
EOF
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
