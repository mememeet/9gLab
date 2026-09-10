#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ ! ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  echo 'Only a main deployment command is allowed'
  exit 1
fi
commit=${BASH_REMATCH[1]}
bundle=$(mktemp /opt/9glab/staging/github-main.XXXXXX.bundle)
trap 'rm -f "$bundle"' EXIT
cat > "$bundle"
export NATIVE_DEPLOY_BUNDLE="$bundle"
/usr/local/sbin/9glab-update-from-main "$commit"
