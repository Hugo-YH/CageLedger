ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.13-slim@sha256:09a17cad02668ae61ece136b4fd36ac3849e14f670ebedb637ea3e15580525bc
ARG TARGETARCH
ARG FRONTEND_OUTPUT=frontend
ARG RUNTIME_IMAGE=runtime-deps

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS frontend-deps

WORKDIR /build

COPY package.json package-lock.json ./
COPY scripts/retry_command.sh scripts/with_build_ca.sh ./scripts/
RUN --mount=type=cache,id=cageledger-npm,target=/root/.npm,sharing=locked \
    --mount=type=secret,id=proxy_ca \
    --mount=type=secret,id=ca_bundle \
    bash scripts/with_build_ca.sh bash scripts/retry_command.sh npm ci --legacy-peer-deps --prefer-offline --no-audit \
    --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000

FROM frontend-deps AS frontend
COPY scripts ./scripts
COPY index.html vite.config.ts tsconfig.json ./
COPY assets ./assets
COPY src ./src
COPY server_app/resources/intake ./server_app/resources/intake
COPY wiki ./wiki
RUN --mount=type=secret,id=proxy_ca \
    --mount=type=secret,id=ca_bundle \
    bash scripts/with_build_ca.sh env CAGELEDGER_DOCS_LAST_UPDATED=false npm run build

# Managed cloud packaging supplies the already verified application/docs build.
# The default still builds from source for standalone Docker builds.
FROM scratch AS frontend-artifact
COPY --from=frontend-assets / /build/web-dist/

FROM ${FRONTEND_OUTPUT} AS web-assets

FROM ${PYTHON_IMAGE} AS runtime-deps
ARG TARGETARCH

WORKDIR /app

COPY scripts/with_build_ca.sh ./scripts/with_build_ca.sh
RUN --mount=type=cache,id=cageledger-apt-archives-${TARGETARCH},target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=cageledger-apt-lists-${TARGETARCH},target=/var/lib/apt/lists,sharing=locked \
    --mount=type=secret,id=proxy_ca \
    --mount=type=secret,id=ca_bundle \
    bash scripts/with_build_ca.sh bash -c '\
    if [ -f /etc/apt/apt.conf.d/docker-clean ]; then mv /etc/apt/apt.conf.d/docker-clean /tmp/cageledger-docker-clean; fi \
    && sed -i "s|http://deb.debian.org|https://deb.debian.org|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        libreoffice-writer \
        poppler-utils \
        fontconfig \
        fonts-noto-cjk \
    && if [ -f /tmp/cageledger-docker-clean ]; then mv /tmp/cageledger-docker-clean /etc/apt/apt.conf.d/docker-clean; fi'

COPY requirements-runtime.txt ./requirements.txt
COPY scripts/retry_command.sh ./scripts/retry_command.sh
RUN --mount=type=cache,id=cageledger-pip-${TARGETARCH},target=/root/.cache/pip,sharing=locked \
    --mount=type=secret,id=proxy_ca \
    --mount=type=secret,id=ca_bundle \
    bash scripts/with_build_ca.sh bash scripts/retry_command.sh pip install --retries 5 --timeout 60 \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    -r requirements.txt

ARG CAGELEDGER_RUNTIME_FINGERPRINT=standalone
LABEL org.cageledger.runtime.inputs=${CAGELEDGER_RUNTIME_FINGERPRINT}

FROM ${RUNTIME_IMAGE} AS runtime
COPY server.py package.json LICENSE NOTICE ./
COPY server_app ./server_app
COPY --from=web-assets /build/web-dist ./web-dist

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
