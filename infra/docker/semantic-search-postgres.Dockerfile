FROM planetscale/lead:1.0.6-pg17@sha256:46b8c4533f9e7127c01447d43f019aeefb0e62802c9631e97d45f1ceb11c878a

# Keep the test extension pinned when the live repository rotates older builds.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && printf '%s\n' 'deb [signed-by=/usr/local/share/keyrings/postgres.gpg.asc] https://apt-archive.postgresql.org/pub/repos/apt trixie-pgdg-archive main' \
        > /etc/apt/sources.list.d/pgdg-archive.list \
    && apt-get update \
    && apt-get install --yes --no-install-recommends postgresql-17-pgvector=0.8.6-1.pgdg13+2 \
    && rm /etc/apt/sources.list.d/pgdg-archive.list \
    && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="Quieter search verification database" \
    org.opencontainers.image.description="PostgreSQL 17 with Lead and pgvector for disposable development and CI tests. Never use Lead in production."
