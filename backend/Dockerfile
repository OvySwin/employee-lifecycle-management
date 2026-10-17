FROM node:24.14.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev --workspace=backend --include-workspace-root=false

FROM node:24.14.1-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node backend/package.json backend/package.json
COPY --chown=node:node backend/src backend/src
COPY --chown=node:node database/migrations database/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=4s --start-period=15s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]
