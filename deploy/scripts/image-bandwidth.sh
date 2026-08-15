#!/usr/bin/env bash
# 图片带宽统计(2026-08-15 A 项): 汇总 nginx access log 中 /images/* 的请求数与字节数。
#
# 背景: 图片走自有服务器直出后,带宽是真金白银(轻量服务器常见 5Mbps / 几十 GB 月流量包)。
# nginx 的 images location 把日志打到 stdout(combined 格式,含 $body_bytes_sent),
# 因此日常可直接从容器日志取数,无需额外落盘。
#
# 用法(二选一):
#   1. docker 容器日志(生产推荐):
#      docker logs wallflow-nginx --since 24h 2>&1 | deploy/scripts/image-bandwidth.sh
#   2. 日志文件(nginx 本地落盘 /var/log/nginx/access.log 时):
#      deploy/scripts/image-bandwidth.sh < /var/log/nginx/access.log
#
# 输出: /images/* 请求数、总字节(GB/MB)、按日拆分行。脚本只读,无副作用。
set -uo pipefail

awk '
  /GET \/images\// {
    reqs++
    bytes += $NF          # combined 格式最后一列为 $body_bytes_sent
  }
  END {
    if (reqs == 0) { print "0 请求 /images/*(窗口内无图片访问,或日志未命中)"; exit 0 }
    printf "图片请求数: %d\n", reqs
    printf "总字节: %.1f MB (%.3f GB)\n", bytes/1048576, bytes/1073741824
    printf "估算(按 1GB=0.8 元 CDN 参考价): ¥%.2f\n", bytes/1073741824*0.8
  }
'
