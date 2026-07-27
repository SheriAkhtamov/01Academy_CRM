FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force

FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS production
WORKDIR /app
RUN apk add --no-cache tini

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package*.json ./
COPY --from=build /app/apply-migrations.js ./

RUN mkdir -p /app/logs /app/uploads/board \
    && chmod -R a+rX /app/migrations \
    && chown -R node:node /app/logs /app/uploads

EXPOSE 5001
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node apply-migrations.js && node dist/index.js"]
