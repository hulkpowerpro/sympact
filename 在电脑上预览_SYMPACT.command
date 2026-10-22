#!/bin/bash
set -e
cd "$(dirname "$0")"
PORT=4173
if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3。请安装 Python 3，或用 Codex 打开此项目。"
  read -r -p "按回车退出…" _
  exit 1
fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  PORT=4174
fi
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/sympact-pwa-http.log 2>&1 &
SERVER_PID=$!
cleanup(){ kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
sleep 1
open "http://localhost:$PORT" || true
echo "SYMPACT 本地预览地址：http://localhost:$PORT"
echo "保持此窗口开启；关闭窗口会停止本地预览。手机无法通过此 localhost 地址访问。"
echo "按 Ctrl+C 退出。"
wait "$SERVER_PID"
