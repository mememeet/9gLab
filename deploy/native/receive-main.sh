#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ ! ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  echo 'Only a main deployment command is allowed'
  exit 1
fi
commit=${BASH_REMATCH[1]}
root=/opt/9glab
bundle=$(mktemp /opt/9glab/staging/github-main.XXXXXX.bundle)
updater=$(mktemp /opt/9glab/staging/update-from-main.XXXXXX.sh)
trap 'rm -f "$bundle" "$updater"' EXIT
cat > "$bundle"
git -C "$root/repository" bundle verify "$bundle"
git -C "$root/repository" fetch --update-shallow "$bundle" +HEAD:refs/remotes/origin/main
fetched_commit=$(git -C "$root/repository" rev-parse refs/remotes/origin/main)
if [[ $fetched_commit != "$commit" ]]; then
  echo 'Received bundle does not match the requested commit'
  exit 1
fi
git -C "$root/repository" show "$commit:deploy/native/update-from-main.sh" > "$updater"
chmod 0700 "$updater"
export NATIVE_DEPLOY_BUNDLE="$bundle"
"$updater" "$commit"
