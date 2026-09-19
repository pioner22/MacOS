#!/usr/bin/env python3
"""Rebuild the payload manifest and bootstrap digest (not its release commit).
Publication still requires pinning st.sh to the commit containing this exact payload.
"""
import hashlib
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
files = sorted(p for p in (root / 'diagnostics/v2').iterdir()
               if p.is_file() and p.name != 'package.tsv')
manifest = root / 'diagnostics/v2/package.tsv'
manifest.write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}\t{p.stat().st_size}\t{p.relative_to(root)}\n' for p in files), encoding='utf-8')
bootstrap = root / 'st.sh'
if bootstrap.exists():
    text, n = re.subn(r'local manifest_sha=[A-Za-z0-9_]+',
                     'local manifest_sha=' + hashlib.sha256(manifest.read_bytes()).hexdigest(),
                     bootstrap.read_text())
    if n != 1:
        raise SystemExit('Expected one bootstrap manifest digest')
    bootstrap.write_text(text, encoding='utf-8')
print(f'Manifest rebuilt for {len(files)} payload files. Pin the payload commit before publishing.')
