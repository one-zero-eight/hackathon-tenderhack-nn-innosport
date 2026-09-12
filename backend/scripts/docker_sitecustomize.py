"""Load memvid's native extension before other .so files consume static TLS."""

import ctypes
from pathlib import Path

for path in (
    Path("/usr/lib/aarch64-linux-gnu/libatomic.so.1"),
    Path("/usr/lib/x86_64-linux-gnu/libatomic.so.1"),
    Path("/usr/lib/aarch64-linux-gnu/libstdc++.so.6"),
    Path("/usr/lib/x86_64-linux-gnu/libstdc++.so.6"),
):
    if path.is_file():
        ctypes.CDLL(str(path), mode=ctypes.RTLD_GLOBAL)

import memvid_sdk._lib as _memvid_lib  # noqa: F401
