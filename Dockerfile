FROM node:22-alpine
LABEL io.voxi.project="voxi"
WORKDIR /app
COPY gateway/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY gateway/*.mjs ./
COPY gateway/*.html gateway/*.css gateway/radio-schematic.svg gateway/connection-marks.svg gateway/connection-marks.LICENSE ./
COPY gateway/voxi-openclaw.py gateway/voxi-context-sync.py ./
RUN mkdir /state && chown node:node /state
RUN node --test
ARG REVISION=dev
ENV NODE_ENV=production PORT=8787 REVISION=$REVISION
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
