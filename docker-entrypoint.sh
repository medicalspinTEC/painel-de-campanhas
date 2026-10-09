#!/bin/sh
# Acerta o dono das pastas de dados (volumes montados chegam como root) e inicia o app como `nextjs`.
set -e
for dir in "${AUDIO_STORAGE_DIR:-/app/data/audios}" "${CAMPANHA_ANEXO_DIR:-/app/data/campanhas}"; do
  mkdir -p "$dir"
  chown -R nextjs:nodejs "$dir" 2>/dev/null || echo "aviso: não foi possível ajustar o dono de $dir"
done
exec su-exec nextjs "$@"
