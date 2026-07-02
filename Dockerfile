ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.13-slim

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS frontend

WORKDIR /build

COPY package.json package-lock.json ./
COPY scripts/retry_command.sh ./scripts/retry_command.sh
RUN bash scripts/retry_command.sh npm ci --prefer-offline --no-audit \
    --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000

COPY index.html vite.config.ts tsconfig.json ./
COPY assets ./assets
COPY src ./src
RUN npm run build

FROM ${PYTHON_IMAGE}

WORKDIR /app

COPY requirements.txt ./
COPY scripts/retry_command.sh ./scripts/retry_command.sh
RUN bash scripts/retry_command.sh pip install --no-cache-dir --retries 5 --timeout 60 -r requirements.txt

COPY server.py package.json LICENSE NOTICE ./
COPY server_app ./server_app
COPY --from=frontend /build/web-dist ./web-dist

ARG CAGELEDGER_APP_VERSION=unknown
ARG CAGELEDGER_REVISION=unknown

ENV CAGELEDGER_HOST=0.0.0.0
ENV CAGELEDGER_PORT=5173
ENV CAGELEDGER_DB=/app/data/cageledger.sqlite
ENV CAGELEDGER_APP_VERSION=${CAGELEDGER_APP_VERSION}
ENV CAGELEDGER_REVISION=${CAGELEDGER_REVISION}
ENV CAGELEDGER_REPOSITORY_URL=https://git.cellnucle.us/hugo/cageledger
ENV CAGELEDGER_BRANCH=main
ENV CAGELEDGER_UPDATE_CHECK_ENABLED=false

EXPOSE 5173

RUN mkdir -p /app/data

CMD ["python3", "server.py"]
