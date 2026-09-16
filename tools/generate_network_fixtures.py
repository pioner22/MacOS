#!/usr/bin/env python3
"""Generate deterministic binary assets for network integrity testing.

Each MiB chunk is generated with SHAKE-256 from a stable seed containing
(size_mib, chunk_index). Files are therefore reproducible, incompressible-ish,
and every MiB differs from every other MiB. The script also emits SHA-256
manifests used by Recovery diagnostics.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path

MIB = 1024 * 1024
SIZES_MIB = [1, 8, 32, 128, 512]
PREFIX = "MacOSDiag"
OUT = Path(os.environ.get("FIXTURE_OUT", "dist/network-fixtures"))
OUT.mkdir(parents=True, exist_ok=True)

rows = []
for size_mib in SIZES_MIB:
    name = f"nettest-{size_mib:03d}MiB.bin"
    path = OUT / name
    h = hashlib.sha256()
    with path.open("wb") as f:
        for idx in range(size_mib):
            chunk = hashlib.shake_256(f"{PREFIX}|{size_mib}|{idx}".encode()).digest(MIB)
            f.write(chunk)
            h.update(chunk)
    digest = h.hexdigest()
    rows.append((size_mib, size_mib * MIB, digest, name))
    print(f"{name}: {size_mib} MiB sha256={digest}")

sha_path = OUT / "network-fixtures.sha256"
with sha_path.open("w", encoding="utf-8") as f:
    for _, _, digest, name in rows:
        f.write(f"{digest}  {name}\n")

manifest = OUT / "network-fixtures.tsv"
with manifest.open("w", encoding="utf-8") as f:
    f.write("size_mib\tbytes\tsha256\tfilename\n")
    for size_mib, nbytes, digest, name in rows:
        f.write(f"{size_mib}\t{nbytes}\t{digest}\t{name}\n")

# Stable 16 MiB range hash from the 512 MiB asset, starting at MiB 256.
rh = hashlib.sha256()
for idx in range(256, 272):
    rh.update(hashlib.shake_256(f"{PREFIX}|512|{idx}".encode()).digest(MIB))
with (OUT / "range-512MiB-offset256MiB-len16MiB.sha256").open("w", encoding="utf-8") as f:
    f.write(rh.hexdigest() + "\n")
print("range sha256=", rh.hexdigest())
