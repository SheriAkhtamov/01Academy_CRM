FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit
COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --no-audit && npm cache clean --force

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS production
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
