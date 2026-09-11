#!/bin/zsh
cd -- "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  exec node server.mjs
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  exec "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" server.mjs
else
  print 'Please install Node.js 22 or newer, then open this launcher again.'
  read -r '?Press Return to close.'
fi
