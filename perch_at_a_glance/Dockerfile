# Perch at a Glance — Home Assistant add-on image.
# Built by the Supervisor; BUILD_FROM is supplied per architecture from
# build.yaml. The default below (amd64) only matters for local `docker build`
# runs without --build-arg; the Supervisor always overrides it per arch.
ARG BUILD_FROM=ghcr.io/hassio-addons/base/amd64:21.0.11
FROM ${BUILD_FROM}

# Node.js + npm from Alpine, plus a compiler toolchain for the better-sqlite3
# native module (prebuilt binaries exist for most platforms; the toolchain is
# the fallback). The HA base image's Alpine release determines the Node major
# version — run.sh logs `node --version` at startup so a mismatch is visible
# in the add-on log. Target: Node 20 LTS.
RUN apk add --no-cache nodejs npm python3 make g++ \
    && node --version && npm --version

WORKDIR /app

COPY app/package.json app/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY app/ ./

COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
