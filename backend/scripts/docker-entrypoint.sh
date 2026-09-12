#!/bin/sh
set -eu

# Surplus static TLS for memvid's late-loaded native extension on linux/arm64.
export GLIBC_TUNABLES="${GLIBC_TUNABLES:-glibc.rtld.optional_static_tls=0x20000}"

exec "$@"
