#!/usr/bin/env python3
"""Build an allowlisted source-package manifest (not a digital signature)."""
from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]
ENTRIES = [
    'current.sh', 'ssd_test.sh', 'ram_quick_test.sh', 'ram_full_test.sh',
    'ram_triage.sh', 'ram_test.sh', 'ram_map.sh', 'cpu_test.sh', 'gpu_test.sh',
    'display_video_test.sh', 'network_test.sh', 'download_test.sh',
    'power_thermal_test.sh', 'hardware_probe.sh', 'full_safe_suite.sh',
    'full_all_suite.sh', 'toolkit_selftest.sh', 'network-fixtures.tsv',
    'diagnostics/core.sh', 'diagnostics/run.sh', 'diagnostics/net.sh',
    'diagnostics/count_stream.pl', 'diagnostics/ram_fallback.pl',
    'diagnostics/ram_native.c', 'diagnostics/storage_file.c',
    'diagnostics/metal_vram.m',
]
if __name__ == '__main__':
    lines = []
    for relative in sorted(ENTRIES):
        data = (ROOT / relative).read_bytes()
        if not data or len(data) > 1048576:
            raise ValueError(f'Invalid packaged size: {relative}')
        lines.append(f'{hashlib.sha256(data).hexdigest()} {len(data)} {relative}\n')
    (ROOT/'diagnostics/package.tsv').write_text(''.join(lines), encoding='ascii')
