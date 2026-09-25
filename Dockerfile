FROM node:20-alpine AS base
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY package.json* ./
RUN npm install --only=production || true
COPY . .
RUN chown -R nextjs:nodejs /app
USER 1001
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD curl -f http://localhost:3001/api/health || curl -f http://localhost:3000/api/health || exit 1
CMD ["npm", "start"]
