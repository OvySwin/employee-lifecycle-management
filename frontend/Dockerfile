FROM node:24.14.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
RUN npm run build --workspace frontend
ARG RELEASE_SHA=development
RUN printf '{"commit":"%s"}\n' "$RELEASE_SHA" > frontend/dist/release.json

FROM nginx:1.28.0-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/web-health || exit 1
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
