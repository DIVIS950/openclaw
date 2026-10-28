# Home Control web app + home server. Build from this folder:
#   docker build -t home-control .
#   docker run -d --name home-control --restart unless-stopped --network host -v home-control-data:/data home-control
FROM node:22-alpine
WORKDIR /app/web
COPY joinmap.example.json /app/joinmap.example.json
COPY web/package.json web/package-lock.json /app/web/
RUN npm ci --omit=dev
COPY web/ /app/web/
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
