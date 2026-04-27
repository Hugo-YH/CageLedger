FROM python:3.13-slim

WORKDIR /app

COPY . .

ENV CAGELEDGER_HOST=0.0.0.0
ENV CAGELEDGER_PORT=5173
ENV CAGELEDGER_DB=/app/data/cageledger.sqlite

EXPOSE 5173

CMD ["python3", "server.py"]
