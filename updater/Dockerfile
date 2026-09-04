FROM golang:1.26.8-alpine AS build

WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS="${TARGETOS:-linux}" GOARCH="${TARGETARCH:-amd64}" \
    go build -trimpath -ldflags='-s -w' -o /out/xboard-updater ./cmd/xboard-updater

FROM docker:28-cli

LABEL org.opencontainers.image.title="Xboard Panel Updater"
LABEL org.opencontainers.image.description="Restricted updater sidecar for the Xboard Remnawave fork"
LABEL org.opencontainers.image.source="https://github.com/FengYuchen1314/backend"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"

RUN apk add --no-cache docker-cli-compose ca-certificates

COPY --from=build /out/xboard-updater /usr/local/bin/xboard-updater

USER 0:0
ENTRYPOINT ["/usr/local/bin/xboard-updater"]
CMD ["serve"]
