ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.13-slim
ARG TARGETARCH

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS frontend-deps

WORKDIR /build

COPY package.json package-lock.json ./
COPY scripts/retry_command.sh ./scripts/retry_command.sh
RUN --mount=type=cache,id=cageledger-npm,target=/root/.npm,sharing=locked \
    bash scripts/retry_command.sh npm ci --legacy-peer-deps --prefer-offline --no-audit \
    --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000

FROM frontend-deps AS frontend
COPY scripts ./scripts
COPY index.html vite.config.ts tsconfig.json ./
COPY assets ./assets
COPY src ./src
COPY server_app/resources/intake ./server_app/resources/intake
COPY wiki ./wiki
RUN CAGELEDGER_DOCS_LAST_UPDATED=false npm run build

FROM ${PYTHON_IMAGE} AS runtime-deps
ARG TARGETARCH

WORKDIR /app

RUN --mount=type=cache,id=cageledger-apt-archives-${TARGETARCH},target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=cageledger-apt-lists-${TARGETARCH},target=/var/lib/apt/lists,sharing=locked \
    if [ -f /etc/apt/apt.conf.d/docker-clean ]; then mv /etc/apt/apt.conf.d/docker-clean /tmp/cageledger-docker-clean; fi \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        libreoffice-writer \
        fontconfig \
        fonts-noto-cjk \
    && if [ -f /tmp/cageledger-docker-clean ]; then mv /tmp/cageledger-docker-clean /etc/apt/apt.conf.d/docker-clean; fi

COPY requirements.txt ./
COPY scripts/retry_command.sh ./scripts/retry_command.sh
RUN --mount=type=cache,id=cageledger-pip-${TARGETARCH},target=/root/.cache/pip,sharing=locked \
    bash scripts/retry_command.sh pip install --retries 5 --timeout 60 \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    -r requirements.txt

FROM runtime-deps AS runtime
COPY server.py package.json LICENSE NOTICE ./
COPY server_app ./server_app
COPY --from=frontend /build/web-dist ./web-dist

ARG CAGELEDGER_APP_VERSION=unknown
ARG CAGELEDGER_REVISION=unknown

ENV CAGELEDGER_HOST=0.0.0.0
ENV CAGELEDGER_ENV=production
ENV CAGELEDGER_PORT=5173
ENV CAGELEDGER_DB=/app/data/cageledger.sqlite
ENV CAGELEDGER_APP_VERSION=${CAGELEDGER_APP_VERSION}
ENV CAGELEDGER_REVISION=${CAGELEDGER_REVISION}
ENV CAGELEDGER_REPOSITORY_URL=https://git.cellnucle.us/hugo/cageledger
ENV CAGELEDGER_BRANCH=main
ENV CAGELEDGER_UPDATE_CHECK_ENABLED=false
ENV CAGELEDGER_CHROMIUM_BIN=/usr/bin/chromium
ENV CAGELEDGER_LIBREOFFICE_BIN=/usr/bin/libreoffice

EXPOSE 5173

RUN python3 -m pip check \
    && python3 -c "import server" \
    && mkdir -p /app/data

CMD ["python3", "server.py"]
