#!/usr/bin/env bash
# cron 이 매시간 실행: 최신 코드 받기 → 수집 → 데이터가 바뀌었으면 커밋·push
set -uo pipefail
export TZ=Asia/Seoul
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

# 이전 실행이 아직 돌고 있으면 건너뜀
exec 9>"/tmp/jnu-notice.lock"
flock -n 9 || { echo "$(date '+%F %T') 이전 실행 중, 건너뜀"; exit 0; }

echo "===== $(date '+%F %T') 시작"
git fetch -q origin main && git reset -q --hard origin/main   # 서버는 원격 상태를 그대로 따른다

.venv/bin/pip install -q -r requirements.txt
.venv/bin/python scraper/crawl.py
status=$?

if git diff --quiet -I '"updated_at"' -- docs/data; then
  echo "변경 없음"
else
  git add docs/data
  git commit -q -m "data: 공지 업데이트 $(date '+%Y-%m-%d %H:%M')"
  git push -q origin HEAD:main && echo "push 완료"
fi

[ $status -eq 0 ] || echo "⚠ 수집기 종료 코드 $status (학교 서버 접속 실패 등)"
echo "===== $(date '+%F %T') 끝"
