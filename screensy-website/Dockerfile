FROM node:24.21.0-alpine3.24 AS typescript_builder

WORKDIR /home/node/app

COPY tsconfig.json ./
COPY screensy.ts ./

RUN npm install typescript@7.0.2 -g
RUN tsc --sourceMap false

FROM golang:1.27.1-alpine3.24 AS go_builder

WORKDIR /go/src/app

COPY main.go main_test.go go.mod go.sum ./

RUN go test ./...
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o screensy-website .

FROM alpine:3.24.2

RUN apk add --no-cache wget \
    && adduser -D -H screensy

WORKDIR /home/screensy

COPY --from=typescript_builder --chown=screensy:screensy /home/node/app/screensy.js ./
COPY --from=go_builder --chown=screensy:screensy /go/src/app/screensy-website /usr/local/bin/screensy-website
COPY --chown=screensy:screensy translations/ ./translations
COPY --chown=screensy:screensy styles.css ./

USER screensy

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["/usr/local/bin/screensy-website"]
