FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY package.json* ./
RUN npm install --only=production || true
COPY . .
RUN chown -R nextjs:nodejs /app
USER 1001
EXPOSE 3000
CMD ["npm", "start"]
