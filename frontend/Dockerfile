# Digest-pinned so two builds of the same commit produce the same image. The
# tags ride in these comments for humans: node:24-alpine, nginx:stable-alpine
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build

WORKDIR /app

# The lockfile arrives on its own so the install layer stays cached across
# every build that changed only source. npm ci installs exactly what the
# lockfile pins and fails if package.json has drifted from it.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:stable-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
