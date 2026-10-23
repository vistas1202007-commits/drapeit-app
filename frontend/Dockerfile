# Drapeit website (Next.js). Used by docker-compose.yml; Vercel builds the website itself and does not need this.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The NEXT_PUBLIC_ values from .env.local are written into the website while it is built.
RUN npm run build

# Second stage: only what "next start" needs (no source code, no .env.local file).
FROM node:22-slim
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next

# Run as a normal user, not root.
USER node
EXPOSE 3000
CMD ["npm", "start"]
