#!/usr/bin/env bash
set -euo pipefail
umask 027
export PATH=/usr/local/bin:/usr/bin:/bin
export GOMAXPROCS=2 GOFLAGS=-p=2 GOPROXY=https://goproxy.cn,direct
root=/opt/9glab
exec 9>/run/lock/9glab-deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
if [[ -n ${NATIVE_DEPLOY_BUNDLE:-} ]]; then
  git -C "$root/repository" bundle verify "$NATIVE_DEPLOY_BUNDLE"
  git -C "$root/repository" fetch --update-shallow "$NATIVE_DEPLOY_BUNDLE" +HEAD:refs/remotes/origin/main
else
  git -C "$root/repository" fetch --prune origin main
fi
commit=$(git -C "$root/repository" rev-parse refs/remotes/origin/main)
if [[ -n ${1:-} && $1 != "$commit" ]]; then
  echo 'Requested commit is no longer the current main; refusing stale deployment'
  exit 1
fi
release="$root/releases/$commit"
previous=$(readlink -f "$root/current" || true)
if [[ $previous == "$release" ]] && systemctl is-active --quiet 9glab; then
  curl --fail --silent http://127.0.0.1:8081/api/health/ready
  exit 0
fi
mkdir -p "$release"
git -C "$root/repository" archive "$commit" | tar -x -C "$release"
chmod -R a+rX "$release"
mkdir -p "$release/bin"
cd "$release/backend"
version=$(tr -d '\r\n' < ../VERSION)
flags="-s -w -X infinite-canvas/backend/internal/buildinfo.Version=$version -X infinite-canvas/backend/internal/buildinfo.Commit=$commit -X infinite-canvas/backend/internal/buildinfo.BuildTime=$(date -u +%FT%TZ)"
go test ./internal/database ./internal/protocol
go test ./internal/service -run 'Test(GatewayAsset|PrepareGatewayAsset|PublishLocalProviderResource|PluginViewIncludesDocumentation|PluginRuntime|AutoDLPlugin|DeclarativeProtocol|.*Appearance|.*Seedream)' -count=1
for target in server migrate-schema migrate-sqlite-postgres; do
  CGO_ENABLED=1 go build -trimpath -ldflags="$flags" -o "$release/bin/$target" "./cmd/$target"
done
cd "$release"
PAYMENT_PLUGIN_GOOS=linux PAYMENT_PLUGIN_GOARCH=amd64 PAYMENT_PLUGIN_CGO_ENABLED=0 bash plugin-packages/build-packages.sh --payments-only
PAYMENT_PLUGIN_SMOKE_TEST=1 sh plugin-packages/verify-payment-packages.sh linux amd64
cd "$release/web"
bun install --frozen-lockfile
bun run build
chmod -R a+rX "$release/web/dist"
cd "$release"
sha256sum bin/* web/dist/index.html > release-checksums.txt
printf '%s\n' "$commit" > REVISION
chmod -R a+rX "$release/bin" "$release/plugin-packages"
chmod a+r "$release/REVISION" "$release/release-checksums.txt"

# Stop writes only after builds succeed, then retain a consistent rollback backup.
systemctl stop 9glab
backup="/var/backups/9glab/$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}"
mkdir -m 700 "$backup"
trap 'if [[ -n "$previous" ]]; then ln -sfn "$previous" "$root/current"; systemctl start 9glab; fi' ERR
runuser -u postgres -- pg_dump --format=custom --dbname=nineglab > "$backup/database.dump"
tar -czf "$backup/data.tar.gz" -C /var/lib/9glab data
printf '%s\n' "$previous" > "$backup/previous-release"
set -a
source /etc/9glab/production.env
set +a
# Auto-migrations are disabled during normal service starts.
"$release/bin/migrate-schema" up
ln -sfn "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl start 9glab
ready=false
for attempt in $(seq 1 45); do
  if curl --fail --silent http://127.0.0.1:8081/api/health/ready >/dev/null; then ready=true; break; fi
  sleep 2
done
if [[ $ready != true ]]; then
  systemctl stop 9glab
  runuser -u postgres -- pg_restore --clean --if-exists --exit-on-error --dbname=nineglab < "$backup/database.dump"
  mv /var/lib/9glab/data "$backup/failed-data"
  tar -xzf "$backup/data.tar.gz" -C /var/lib/9glab
  echo 'Health check failed; restoring previous application and data'
  false
fi
trap - ERR
nginx -t
systemctl reload nginx
curl --fail --silent https://sj.tiangua.net.cn/api/health/ready
echo "Deployed main $commit"
