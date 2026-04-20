FROM node:22-slim AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "process.exit(0)"

CMD ["node", "agent.js"]
