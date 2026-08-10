#!/usr/bin/env bash
# WallFlow DB 定时备份(#12): 每日 pg_dump → gzip → 保留 7 天;可选 COSCLI 上传 COS。
# 用法:
#   chmod +x deploy/pg_backup.sh
#   (crontab -l 2>/dev/null; echo "0 3 * * * /data/wallflow/deploy/pg_backup.sh") | crontab -
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/data/backup/sql}"
CONTAINER="${PG_CONTAINER:-wallflow-postgres}"
DB_USER="${POSTGRES_USER:-wallflow}"
DB_NAME="${POSTGRES_DB:-wallflow}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"

mkdir -p "$BACKUP_DIR"
DATE="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/pg_${DATE}.sql.gz"

echo "[backup] dumping ${DB_NAME} -> ${OUT}"
docker exec -t "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$OUT"

# 可选: 上传 COS(需安装 coscli 并配置,见 https://github.com/tencentyun/coscli)
if [ -n "${COS_BUCKET:-}" ]; then
  coscli cp "$OUT" "cos://${COS_BUCKET}/db-backup/$(basename "$OUT")" >/dev/null 2>&1 \
    && echo "[backup] uploaded to cos://${COS_BUCKET}/db-backup/" || echo "[backup] coscli upload failed (skipped)"
fi

# 清理过期备份
find "$BACKUP_DIR" -name 'pg_*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "[backup] done. remaining: $(find "$BACKUP_DIR" -name 'pg_*.sql.gz' | wc -l)"
