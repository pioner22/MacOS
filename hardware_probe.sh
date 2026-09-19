#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Local validated package entry. Use st.sh when downloading through a pipe.
ROOT=${MACDIAG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}
[ -f "$ROOT/diagnostics/run.sh" ] || {
    echo 'RESULT=INCONCLUSIVE use_st_launcher'; exit 3;
}
export MACDIAG_ROOT=$ROOT
exec /bin/bash "$ROOT/diagnostics/run.sh" hardware
