# deepslate-designer: tools/designer (server.mjs and the instructions) on node, so a new server.mjs arrives with a
# redeploy. The CLI it runs stays on the host (DESIGNER_BIN_DIR, docs/39). Built by CI from the repo root.
FROM node:lts-slim

COPY tools/designer /designer

CMD ["node", "/designer/server.mjs"]
