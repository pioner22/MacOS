#!/bin/bash
set -u
# Immutable launcher for the syntax-checked Catalina Recovery rescue script.
exec /bin/bash -c "curl -fL -H 'Cache-Control: no-cache' 'https://raw.githubusercontent.com/pioner22/MacOS/1d16aa04f95879cc13d45e8b682e5a4bfcc30338/s.sh' | /bin/bash"
