FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run server:build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PERSONAL_HOST=0.0.0.0 PERSONAL_PORT=3003
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY scripts/personal-approve.mjs ./scripts/personal-approve.mjs
RUN mkdir .data && chown -R node:node /app
USER node
EXPOSE 3003
VOLUME ["/app/.data"]
CMD ["npm","start"]
