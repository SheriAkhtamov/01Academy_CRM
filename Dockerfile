FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit
COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --no-audit && npm cache clean --force

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS production
WORKDIR /app
RUN apk add --no-cache tini

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package*.json ./
COPY --from=build /app/apply-migrations.js ./

RUN mkdir -p /app/logs /app/uploads/board /app/uploads/payments /app/uploads/portfolio \
    && chmod -R a+rX /app/migrations \
    && chown -R node:node /app/logs /app/uploads

EXPOSE 5001
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node apply-migrations.js && node dist/index.js"]
