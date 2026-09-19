#!/usr/bin/env python3
"""Regenerate the exact source-package manifest. No binaries or user data."""
import hashlib
from pathlib import Path
root = Path(__file__).resolve().parents[1] / 'diagnostics_v2'
names = ['common.sh', 'count_stream.pl', 'fixtures.txt', 'metal_vram.m', 'net.sh',
         'profile.sh', 'ram_native.c', 'run.sh', 'storage_file.c', 'supervise.pl', 'report.sh']
rows = []
for name in names:
    data = (root / name).read_bytes()
    rows.append(f'{hashlib.sha256(data).hexdigest()}\t{len(data)}\t{name}\n')
(root / 'manifest.tsv').write_text(''.join(rows), encoding='ascii')
print(hashlib.sha256((root/'manifest.tsv').read_bytes()).hexdigest())
