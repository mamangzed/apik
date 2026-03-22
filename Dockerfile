FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./package.json
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm install --prefix backend && npm install --prefix frontend

COPY backend ./backend
COPY frontend ./frontend

ARG VITE_CLERK_PUBLISHABLE_KEY=
ARG VITE_APP_BASE_URL=
ARG VITE_API_BASE_URL=
ARG VITE_WS_BASE_URL=

ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_APP_BASE_URL=$VITE_APP_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_BASE_URL=$VITE_WS_BASE_URL

RUN npm run build
RUN npm prune --prefix backend --omit=dev

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=2611

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates iptables \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN mkdir -p ./backend/data/intercept-ca

EXPOSE 2611
EXPOSE 8080

CMD ["node", "backend/dist/index.js"]