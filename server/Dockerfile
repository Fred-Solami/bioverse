FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts

COPY tsconfig.json ./
COPY migrations ./migrations
COPY seed ./seed
COPY src ./src

EXPOSE 3000

CMD ["sh", "-c", "npx tsx src/migrate.ts && npx tsx src/seed.ts && npx tsx src/index.ts"]
