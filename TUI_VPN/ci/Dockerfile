ARG BASE_IMAGE=ubuntu:22.04
FROM ${BASE_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive PYTHONDONTWRITEBYTECODE=1 LC_ALL=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 ca-certificates curl iproute2 nftables perl openssl procps locales systemd
COPY TUI_VPN /src
RUN apt-get install -y "/src/dist/tui-vpn_$(cat /src/VERSION)_all.deb"
WORKDIR /src
CMD ["/bin/bash", "/src/ci/container_test.sh"]
