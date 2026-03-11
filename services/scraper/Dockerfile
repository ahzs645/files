FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/scraper/package.json services/scraper/package.json

RUN npm install
RUN npx playwright install --with-deps chromium

COPY packages/shared ./packages/shared
COPY services/scraper ./services/scraper

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace", "@bcbid/scraper"]
