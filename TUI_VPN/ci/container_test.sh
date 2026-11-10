#!/bin/bash
# Runs only inside the disposable CI container, with no external network.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1 LC_ALL=C.UTF-8
mkdir -p /tmp/tui-vpn-ci
python3 -B -m unittest discover -s /src/tests -p 'test_*.py'
daemon_pid=''
version=$(cat /src/VERSION)
cleanup() {
  if [ -n "$daemon_pid" ]; then kill "$daemon_pid" 2>/dev/null || true; wait "$daemon_pid" 2>/dev/null || true; daemon_pid=''; fi
}
trap cleanup EXIT
start_controller() {
  /usr/bin/python3 -I -B /opt/tui-vpn/current/app/src/entry.py _daemon &
  daemon_pid=$!
  for attempt in $(seq 1 40); do
    if /usr/local/bin/tui-vpn status >/tmp/tui-vpn-ci/status.txt 2>&1; then return; fi
    sleep 0.25
  done
  cat /tmp/tui-vpn-ci/status.txt
  exit 1
}
start_controller
tui-vpn off
cleanup
daemon_pid=''
start_controller
tui-vpn status
cleanup
daemon_pid=''
# A dummy egress in the container namespace has no link to the host network.
ip link set lo up
ip link add egress0 type dummy
ip address add 192.0.2.2/24 dev egress0
ip link set egress0 up
ip route add default via 192.0.2.1 dev egress0
python3 -B /src/tests/native_lab.py --tun --core /opt/tui-vpn/current/core/sing-box \
  --output /tmp/tui-vpn-ci/native-linux.json
cat /tmp/tui-vpn-ci/native-linux.json
apt-get remove -y tui-vpn
test ! -e /usr/local/bin/tui-vpn
test -f /var/lib/tui-vpn/catalog.sqlite3
apt-get install -y "/src/dist/tui-vpn_${version}_all.deb"
start_controller
tui-vpn status
