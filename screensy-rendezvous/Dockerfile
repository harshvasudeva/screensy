FROM node:24.21.0-alpine3.24 AS builder

WORKDIR /home/node/app

COPY tsconfig.json package.json package-lock.json ./
COPY *.ts ./

RUN npm ci
RUN npx tsc

FROM node:24.21.0-alpine3.24

WORKDIR /home/node/app

COPY --from=builder /home/node/app/package.json ./
COPY --from=builder /home/node/app/package-lock.json ./
COPY --from=builder /home/node/app/server.js ./
COPY --from=builder /home/node/app/protocol.js ./
COPY --from=builder /home/node/app/turn.js ./
COPY --from=builder /home/node/app/ratelimit.js ./
COPY --from=builder /home/node/app/token.js ./

RUN npm ci --omit=dev && chown -R node:node /home/node/app

USER node

CMD ["node", "server.js"]
