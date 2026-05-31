# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o server .

# Runtime stage
FROM alpine:latest

WORKDIR /app

COPY --from=builder /app/server .
COPY --from=builder /app/index.html .
COPY --from=builder /app/static ./static
COPY --from=builder /app/credit ./credit
COPY --from=builder /app/hisa ./hisa

# Hisa stores project state in this JSON-backed directory. Mount this path
# as a Docker volume/bind mount in production to keep runtime edits across
# container rebuilds/recreates. The current project.json is also copied into
# the image as the initial state.
ENV HISA_DATA_DIR=/app/hisa/data
VOLUME ["/app/hisa/data"]

EXPOSE 8080

CMD ["./server"]
