FROM node:20-slim AS build

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY tsconfig.json ./tsconfig.json
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json

RUN npm install --ignore-scripts

COPY shared ./shared
COPY server ./server

RUN npm run build -w shared
RUN node /app/node_modules/prisma/build/index.js generate --schema /app/server/prisma/schema.prisma
RUN npm run build -w server

FROM node:20-slim AS runtime

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/package.json ./server/package.json

EXPOSE 3000

CMD ["node", "server/dist/index.js"]