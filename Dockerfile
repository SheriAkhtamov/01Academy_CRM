FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/package*.json ./
COPY --from=build /app/apply-migrations.js ./
COPY --from=build /app/tsconfig.json ./

RUN mkdir -p /app/logs /app/uploads/board \
    && chmod -R a+rX /app/migrations \
    && chown -R node:node /app/logs /app/uploads

EXPOSE 5001
USER node
CMD ["sh", "-c", "node apply-migrations.js && node dist/index.js"]
