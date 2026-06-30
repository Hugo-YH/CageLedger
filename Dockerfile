FROM node:22-bookworm-slim AS frontend

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY assets ./assets
COPY src ./src
RUN npm run build

FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

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
ENV CAGELEDGER_GITEA_TOKEN=

EXPOSE 5173

RUN mkdir -p /app/data

CMD ["python3", "server.py"]
