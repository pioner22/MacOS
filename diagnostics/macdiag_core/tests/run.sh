#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
perl -I lib -c bin/macdiag.pl
for file in lib/MacDiag/*.pm; do perl -I lib -c "$file"; done
bash -n macdiag
prove -I lib tests/*.t
python3 -m unittest discover -s tests -p 'test_*.py' -v
