FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG VITE_CONVEX_URL=http://127.0.0.1:3210
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

COPY package.json package-lock.json* tsconfig.base.json tsconfig.json vitest.config.ts ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
COPY convex/_generated ./convex/_generated

RUN npm run build --workspace @bcbid/web

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app/apps/web/dist ./dist

RUN npm install --global serve

EXPOSE 4173

CMD ["serve", "-s", "dist", "-l", "4173"]
