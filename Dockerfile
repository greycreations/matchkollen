FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8787 MATCHKOLLEN_DATA_DIR=/data/wrangler
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev
COPY . .
RUN npm run build
EXPOSE 8787
VOLUME ["/data"]
CMD ["npm", "run", "start:docker"]
