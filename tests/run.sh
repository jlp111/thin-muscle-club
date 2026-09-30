#!/bin/sh
# 薄肌训练系统 · 一键回归
# 用法：  sh tests/run.sh
# 说明：  逻辑层零依赖；DOM 层需要 jsdom（缺失时自动跳过，不影响逻辑层结果）
#         TZ 必须是本机实际时区，否则日期口径断言会失去意义
set -e
cd "$(dirname "$0")"
NODE_BIN="${NODE:-node}"
export TZ="${TZ:-Asia/Shanghai}"

echo "==> 逻辑层回归 (TZ=$TZ)"
"$NODE_BIN" verify-logic.js

echo ""
echo "==> DOM 冒烟测试"
if ! "$NODE_BIN" verify-dom.js; then
  code=$?
  if [ "$code" = "2" ]; then
    echo "（已跳过 DOM 层：缺少 jsdom）"
  else
    exit "$code"
  fi
fi

echo ""
echo "==> 开源脱敏回归"
if ! "$NODE_BIN" verify-privacy.js; then
  code=$?
  if [ "$code" = "2" ]; then
    echo "（已跳过脱敏回归：缺少 jsdom）"
  else
    exit "$code"
  fi
fi

echo ""
echo "全部通过。"
