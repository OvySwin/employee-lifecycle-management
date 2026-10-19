FROM node:24.14.1-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY playwright.deployed.config.js ./
COPY e2e/deployed e2e/deployed
CMD ["npx", "playwright", "test", "--config=playwright.deployed.config.js"]
