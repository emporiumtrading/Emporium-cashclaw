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

CMD ["node", "dist/index.js"]
