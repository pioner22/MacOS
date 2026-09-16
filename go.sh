#!/bin/bash
set -u
exec /bin/bash -c "curl -fL -H 'Cache-Control: no-cache' 'https://raw.githubusercontent.com/pioner22/MacOS/bf8abba53fb3e488873fbae204e0231a0b8dc18b/rescue.sh' | /bin/bash"
