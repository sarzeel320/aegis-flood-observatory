FROM node:22-alpine
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 PORT=4173 NODE_ENV=production AEGIS_DB_PATH=/app/data/aegis.sqlite
RUN mkdir -p /app/data
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4173/api/ready || exit 1
CMD ["node", "server.mjs"]
