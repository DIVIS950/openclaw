# Muse cloud desktop: a persistent Chromium on a virtual screen that the agent drives over CDP
# and that you can watch or take over from your phone over noVNC.
ARG BASE_IMAGE=debian:bookworm-slim@sha256:98f4b71de414932439ac6ac690d7060df1f27161073c5036a7553723881bffbe
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-core \
    novnc \
    openbox \
    procps \
    socat \
    tini \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/muse-desktop
COPY watch/ /usr/share/novnc/
RUN chmod 0755 /usr/local/bin/muse-desktop \
  && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
  && useradd --create-home --uid 1001 --shell /bin/bash muse \
  && mkdir -p /data/chrome \
  && chown -R muse:muse /data/chrome

USER muse
WORKDIR /home/muse
VOLUME ["/data/chrome"]
EXPOSE 9222 6080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/muse-desktop"]
