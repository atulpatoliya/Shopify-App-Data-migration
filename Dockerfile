# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl

WORKDIR /app

# Install ALL deps (dev + prod) so build tools like react-router/dev are present
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000

# Install production-only deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built app from builder stage
COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/app ./app
COPY --from=builder /app/shopify.app.toml ./shopify.app.toml

CMD ["npm", "run", "docker-start"]
