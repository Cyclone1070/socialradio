# --- BUILD STAGE ---
FROM node:26-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- PRODUCTION DEPS STAGE ---
FROM node:26-slim AS deps
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# --- PRODUCTION RUNNER STAGE ---
FROM node:26-slim AS runner
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Copy production modules and built application
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

# Use non-root node user for security
USER node

EXPOSE 3000
CMD ["node", "dist/main"]
