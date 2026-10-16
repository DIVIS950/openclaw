# Piña's image: the official OpenClaw image (with Chromium) plus `gog` for Gmail + Calendar.
# Do not set ENTRYPOINT or CMD here: the base image's entrypoint runs `openclaw doctor --fix`
# before the gateway starts.
ARG OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.10.4-browser
FROM ${OPENCLAW_IMAGE}
ARG GOG_VERSION=latest
USER root
COPY install-gog.mjs /tmp/install-gog.mjs
RUN node /tmp/install-gog.mjs "$GOG_VERSION" \
    || echo "WARNING: gog was not installed. Piña works, but Gmail and Google Calendar stay off."; \
    rm -f /tmp/install-gog.mjs
USER node
