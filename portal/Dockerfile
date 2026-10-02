# Multi-stage build: compile the customer-portal SPA, then serve the
# static output from nginx. Identical shape to admin/Dockerfile -- the
# final image contains no Node runtime, no source, no dev-server, and
# runs as a non-root user.

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# nginx:alpine ships a default nginx.conf that runs worker processes as
# the "nginx" user and listens on port 80. We override the server block
# to listen on 8080 (allows running the master as non-root) and drop
# privileges everywhere. The published host port differs from admin's
# (8081 in docker-compose.yml), the container port does not.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

ENV API_UPSTREAM_URL=http://api:5000
ENV API_UPSTREAM_HOST=api:5000

RUN chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html /etc/nginx/conf.d /etc/nginx/templates \
    && chmod -R 755 /usr/share/nginx/html \
    && sed -i -E -e 's|^pid[[:space:]]+/[^;]+;|pid /tmp/nginx.pid;|' \
                 -e '/^user /d' \
                 /etc/nginx/nginx.conf

USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
