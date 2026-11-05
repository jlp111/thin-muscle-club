#!/bin/sh
# 薄肌俱乐部 · 一键回归
# 用法：
#   sh tests/run.sh                                             # 源系统回归（index.html）
#   TM_TARGET=migrate/out/index-tracker.html sh tests/run.sh    # 合并版回归（交付物）
# 说明：  逻辑层零依赖；DOM 层需要 jsdom（缺失时自动跳过，不影响逻辑层结果）
#         TZ 必须是本机实际时区，否则日期口径断言会失去意义
#         verify-dom.js 只认**源系统** DOM 契约（#app + [data-tab]）；
#         合并版是另一套契约（#page-<key> + [data-page]），请用 verify-integration.js。
#         两者不通用——拿 verify-dom.js 跑合并版会直接崩溃（P1 架构的教训）。
set -e
# TM_TARGET 相对路径按**调用时**的工作目录解析成绝对路径——
# 本脚本随后会 cd 到 tests/，不先转绝对路径的话，node 的 path.resolve
# 会以 tests/ 为基准拼出 tests/migrate/out/… 而找不到文件。
if [ -n "${TM_TARGET:-}" ]; then
  case "$TM_TARGET" in
    /*) ;;                                  # 已是绝对路径
    *)  TM_TARGET="$PWD/$TM_TARGET" ;;      # 相对 → 绝对
  esac
  export TM_TARGET
fi
cd "$(dirname "$0")"
NODE_BIN="${NODE:-node}"
export TZ="${TZ:-Asia/Shanghai}"

echo "==> 逻辑层回归 (TZ=$TZ)"
"$NODE_BIN" verify-logic.js

if [ -n "$TM_TARGET" ]; then
  echo ""
  echo "==> 合并版 DOM 验收（目标：$TM_TARGET）"
  code=0
  "$NODE_BIN" verify-integration.js || code=$?
  if [ "$code" = "2" ]; then
    echo "（已跳过 DOM 层：缺少 jsdom）"
  elif [ "$code" != "0" ]; then
    exit "$code"
  fi

  echo ""
  echo "==> 脱敏回归（合并版，S1-S7 全节必须全绿）"
  code=0
  "$NODE_BIN" verify-privacy.js || code=$?
  if [ "$code" = "2" ]; then
    echo "（已跳过脱敏回归：缺少 jsdom）"
  elif [ "$code" != "0" ]; then
    exit "$code"
  fi

  echo ""
  echo "==> 全部通过（合并版）。源系统回归请跑：sh tests/run.sh"
else
  echo ""
  echo "==> DOM 冒烟测试"
  code=0
  "$NODE_BIN" verify-dom.js || code=$?
  if [ "$code" = "2" ]; then
    echo "（已跳过 DOM 层：缺少 jsdom）"
  elif [ "$code" != "0" ]; then
    exit "$code"
  fi

  echo ""
  echo "==> 开源脱敏回归"
  code=0
  "$NODE_BIN" verify-privacy.js || code=$?
  if [ "$code" = "2" ]; then
    echo "（已跳过脱敏回归：缺少 jsdom）"
  elif [ "$code" != "0" ]; then
    exit "$code"
  fi

  echo ""
  echo "==> 全部通过（源系统）。合并版回归请跑：TM_TARGET=migrate/out/index-tracker.html sh tests/run.sh"
fi
