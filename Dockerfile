FROM node:20-slim AS builder
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ .

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080
CMD ["node", "src/index.js"]
