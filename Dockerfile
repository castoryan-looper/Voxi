FROM node:22-alpine
LABEL io.voxi.project="voxi"
WORKDIR /app
COPY gateway/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY gateway/*.mjs ./
RUN node --test
ARG REVISION=dev
ENV NODE_ENV=production PORT=8787 REVISION=$REVISION
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
