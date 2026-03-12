FROM node:22-bookworm

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PIP_BREAK_SYSTEM_PACKAGES=1

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/scraper/package.json services/scraper/package.json
COPY services/scraper/botright/requirements.txt services/scraper/botright/requirements.txt

RUN apt-get update && apt-get install -y python3 python3-pip chromium && rm -rf /var/lib/apt/lists/*
RUN npm install
RUN python3 -m pip install -r services/scraper/botright/requirements.txt && \
    mkdir -p /home/node/.config /home/node/.cache && \
    chown -R node:node \
      /home/node \
      /usr/local/lib/python3.11/dist-packages/hcaptcha_challenger \
      /usr/local/lib/python3.11/dist-packages/botright
RUN npx playwright install --with-deps chromium

COPY packages/shared ./packages/shared
COPY scripts ./scripts
COPY convex/_generated ./convex/_generated
COPY services/scraper ./services/scraper

RUN mkdir -p /data && chown -R node:node /app /data /ms-playwright

USER node

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace", "@bcbid/scraper"]
