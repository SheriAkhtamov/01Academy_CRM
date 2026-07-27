FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS production
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
