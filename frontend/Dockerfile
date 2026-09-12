FROM node:20-bookworm-slim AS build

WORKDIR /app

# node:20-alpine is musl; @pnpm/exe@10.22.0 has no linux-arm64-musl binary.
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Nginx
FROM nginx:stable-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD [ "nginx", "-g", "daemon off;" ]