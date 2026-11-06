FROM planetscale/lead:1.0.6-pg17@sha256:46b8c4533f9e7127c01447d43f019aeefb0e62802c9631e97d45f1ceb11c878a

RUN apt-get update \
    && apt-get install --yes --no-install-recommends postgresql-17-pgvector=0.8.6-1.pgdg13+2 \
    && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="Quieter search verification database" \
    org.opencontainers.image.description="PostgreSQL 17 with Lead and pgvector for disposable development and CI tests. Never use Lead in production."
