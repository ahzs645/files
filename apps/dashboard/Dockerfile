FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG VITE_CONVEX_URL=http://127.0.0.1:3210
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY apps/dashboard ./apps/dashboard
COPY packages/shared ./packages/shared
COPY convex/_generated ./convex/_generated

RUN npm run build --workspace @bcbid/dashboard

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app/apps/dashboard/dist ./dist

RUN npm install --global serve

EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "5173"]
