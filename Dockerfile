FROM node:26.10.0-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
COPY infra ./infra
ENV PORT=4300 HOST=0.0.0.0 DB_PATH=/app/data/relay.sqlite DEMO_MODE=true PUBLIC_BASE_URL=http://127.0.0.1:4300 ALLOWED_DESTINATION_HOSTS=example.com
EXPOSE 4300
CMD ["node", "apps/api/server.mjs"]
