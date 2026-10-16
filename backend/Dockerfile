FROM node:22.22.0-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY database ./database
COPY tests ./tests
COPY scripts ./scripts
COPY templates ./templates
USER node
EXPOSE 4000
CMD ["node", "src/server.js"]
