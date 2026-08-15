#!/usr/bin/env bash
# 图片卷备份(2026-08-15 D 项): 快照自有存储图片目录到备份位置,带保留策略。
#
# 背景: pg_backup.sh 只备数据库;images 卷(当前 ~170MB,持续增长)不在备份内,
# 服务器故障(磁盘损坏/误删/被清)图片即丢失 — 而图片是经转码的独有资产(从 Wikimedia 下载后 sharp 压缩),
# 重跑导入虽有 manifest 可重建,但需重新下载限流 + 重新转码,恢复成本高。
#
# 用法: deploy/scripts/backup-images.sh [源目录] [备份目录] [保留份数]
#   默认源: /data/wallflow/images(compose images 卷挂载点)
#   默认备份: /data/wallflow/backups/images
#   默认保留: 7 份(滚动删除最旧)
#
# 方案: 时间戳快照目录 + rsync --link-dest(硬链接去重,只占增量空间)。
# 异地/对象存储冷备可在此之上加 rsync push 或 rclone copy(按需)。
set -euo pipefail

SRC="${1:-/data/wallflow/images}"
BACKUP_ROOT="${2:-/data/wallflow/backups/images}"
KEEP="${3:-7}"

if [ ! -d "$SRC" ]; then
  echo "源目录不存在: $SRC(生产 compose 用 docker compose exec 或宿主机挂载路径)" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_ROOT"

# 找最近一份快照作为 --link-dest 基准(硬链接复用,增量落盘)
PREV="$(ls -1 "$BACKUP_ROOT" 2>/dev/null | grep -v '^\.' | sort | tail -1 || true)"
LINK_DEST=""
if [ -n "$PREV" ] && [ -d "$BACKUP_ROOT/$PREV" ]; then
  LINK_DEST="--link-dest=$BACKUP_ROOT/$PREV"
fi

echo "备份 $SRC → $DEST(基准: ${PREV:-无})"
rsync -a --delete $LINK_DEST "$SRC"/ "$DEST"/

# 保留策略: 超过 KEEP 份的旧快照滚动删除(rm -rf 只作用于备份根下的快照目录)
COUNT="$(ls -1 "$BACKUP_ROOT" | grep -v '^\.' | wc -l)"
if [ "$COUNT" -gt "$KEEP" ]; then
  for old in $(ls -1 "$BACKUP_ROOT" | grep -v '^\.' | sort | head -n $((COUNT - KEEP))); do
    echo "清理旧快照: $BACKUP_ROOT/$old"
    rm -rf "$BACKUP_ROOT/$old"
  done
fi

echo "✅ 图片备份完成: $(du -sh "$DEST" | cut -f1)(快照 ${KEEP} 份)"
