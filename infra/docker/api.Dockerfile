FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S appuser -u 1001
COPY package.json* ./
RUN npm install --only=production || true
COPY . .
RUN chown -R appuser:nodejs /app
USER 1001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD curl -f http://localhost:3001/api/health || exit 1
CMD ["node", "apps/api/src/main.js"]
