FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package*.json ./
COPY --from=build /app/apply-migrations.js ./

RUN mkdir -p /app/uploads /app/uploads/photos /app/logs && \
    chown -R node:node /app/uploads /app/logs

EXPOSE 5000
USER node
CMD ["sh", "-c", "node apply-migrations.js && node dist/index.js"]
