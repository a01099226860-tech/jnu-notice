#!/usr/bin/env bash
# 한국 리전 클라우드 서버(Ubuntu 22.04/24.04)에서 한 번만 실행하는 설치 스크립트.
#   curl -fsSL https://raw.githubusercontent.com/a01099226860-tech/jnu-notice/main/server/setup.sh | bash
#
# 하는 일
#  1) git, python3-venv 설치
#  2) 이 저장소에만 쓰기 권한이 있는 SSH 배포 키(deploy key) 생성 → 공개키 출력
#  3) 공개키가 GitHub 에 등록되면 저장소 clone + 가상환경 + 패키지 설치
#  4) 매시간 17분에 server/run.sh 가 돌도록 crontab 등록
set -euo pipefail

REPO_SSH="git@github.com:a01099226860-tech/jnu-notice.git"
APP_DIR="$HOME/jnu-notice"
KEY="$HOME/.ssh/jnu_notice_deploy"

echo "== 1. 패키지 설치"
sudo apt-get update -qq
sudo apt-get install -y -qq git python3 python3-venv curl ca-certificates tzdata >/dev/null
sudo timedatectl set-timezone Asia/Seoul 2>/dev/null || true

echo "== 2. 배포 키 준비"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N "" -C "jnu-notice-server" -f "$KEY" >/dev/null
fi
ssh-keyscan -t ed25519 github.com 2>/dev/null >> "$HOME/.ssh/known_hosts"
sort -u -o "$HOME/.ssh/known_hosts" "$HOME/.ssh/known_hosts"
if ! grep -q "jnu_notice_deploy" "$HOME/.ssh/config" 2>/dev/null; then
  cat >> "$HOME/.ssh/config" <<EOF
Host github.com
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
  chmod 600 "$HOME/.ssh/config"
fi

echo
echo "아래 공개키를 GitHub 저장소 Settings → Deploy keys → Add deploy key 에 등록하세요."
echo "('Allow write access' 체크 필수)"
echo "--------------------------------------------------------------------------"
cat "$KEY.pub"
echo "--------------------------------------------------------------------------"
echo

until ssh -o BatchMode=yes -T git@github.com 2>&1 | grep -q "successfully authenticated"; do
  read -r -p "등록을 마쳤으면 Enter (그만두려면 Ctrl+C) " _ </dev/tty
done
echo "GitHub 인증 확인 완료"

echo "== 3. 저장소 clone + 가상환경"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone -q "$REPO_SSH" "$APP_DIR"
fi
cd "$APP_DIR"
git config user.name "jnu-notice-server"
git config user.email "jnu-notice-server@users.noreply.github.com"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
chmod +x server/run.sh

echo "== 4. 학교 서버 접속 테스트"
# 접속 가능 여부만 본다 (학교 서버 인증서 체인 문제는 수집기가 따로 처리하므로 여기선 --insecure)
if curl -sS -m 15 -o /dev/null -w "%{http_code}" --insecure https://www.jejunu.ac.kr/ara/noticesurvey/outEvent.htm | grep -q "200"; then
  echo "제주대 서버 접속 OK"
else
  echo "⚠ 제주대 서버에 접속하지 못했습니다. 이 서버 IP 도 차단되었을 수 있어요."
fi

echo "== 5. crontab 등록 (매시간 17분)"
CRON_LINE="17 * * * * $APP_DIR/server/run.sh >> $HOME/jnu-notice.log 2>&1"
( crontab -l 2>/dev/null | grep -v "jnu-notice/server/run.sh" ; echo "$CRON_LINE" ) | crontab -

echo "== 6. 첫 실행"
"$APP_DIR/server/run.sh"

echo
echo "설치 완료. 로그 보기: tail -f ~/jnu-notice.log"
