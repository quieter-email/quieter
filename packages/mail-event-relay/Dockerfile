FROM node:26.13.1-bookworm-slim
WORKDIR /relay
COPY --chown=node:node dist/ ./
USER node
CMD ["node", "index.mjs"]
