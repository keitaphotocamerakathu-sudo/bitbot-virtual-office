FROM node:24.11.1-alpine3.22
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node supabase/functions/bitbot-v10/ ./supabase/functions/bitbot-v10/
COPY --chown=node:node services/rea/ ./services/rea/
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","services/rea/runner.mjs"]
