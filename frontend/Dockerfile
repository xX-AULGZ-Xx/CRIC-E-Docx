FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set maxsockets 3 \
    && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund)
COPY . .
ARG NEXT_PUBLIC_API_URL=same-origin
ARG NEXT_PUBLIC_SSO_URL=https://sso.cric.ac.th
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SSO_URL=$NEXT_PUBLIC_SSO_URL
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "run", "start"]
