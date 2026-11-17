"""수동 업데이트: 최신 상태 받기 → 공지·뉴스·날씨 수집 → 바뀐 데이터만 GitHub 에 올리기.

제주대 서버가 해외 IP(GitHub Actions 등)를 차단하므로, 한국 IP 인 이 PC 에서 실행한다.
사용법: 프로젝트 폴더의 update.bat 더블클릭  (또는  py scripts/update.py)
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://a01099226860-tech.github.io/jnu-notice/"


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, check=check, text=True,
                          capture_output=True, encoding="utf-8", errors="replace")


def main() -> int:
    print("1/4 GitHub 최신 상태 받는 중…")
    if git("status", "--porcelain", "--", "docs/data").stdout.strip():
        # 이전 실행에서 올리지 못한 데이터가 있으면 버리고 새로 수집한다
        git("checkout", "--", "docs/data")
    r = git("pull", "--rebase", "-q", check=False)
    if r.returncode != 0:
        print("  ⚠ git pull 실패:\n" + r.stderr)
        return 1

    print("2/4 공지·뉴스·날씨 수집 중… (새 글이 많으면 몇 분 걸려요)")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "FORCE_NEWS": "1"}
    crawl = subprocess.run([sys.executable, str(ROOT / "scraper" / "crawl.py")], cwd=ROOT, env=env)
    if crawl.returncode == 2:
        print("  ⚠ 학교 서버에 접속하지 못했어요. 인터넷 연결을 확인하세요. (뉴스·날씨는 계속 올립니다)")

    print("3/4 바뀐 내용 확인 중…")
    changed = git("diff", "--quiet", "-I", '"updated_at"', "--", "docs/data", check=False).returncode != 0
    if not changed:
        print("  새 글이나 바뀐 내용이 없어요. 올릴 것 없음.")
        git("checkout", "--", "docs/data")
        return 0

    print("4/4 GitHub 에 올리는 중…")
    git("add", "docs/data")
    from datetime import datetime
    git("commit", "-q", "-m", f"data: 공지 업데이트 {datetime.now():%Y-%m-%d %H:%M}")
    r = git("push", "-q", check=False)
    if r.returncode != 0:
        print("  ⚠ push 실패:\n" + r.stderr)
        return 1
    print(f"\n완료! 1~2분 뒤 사이트에 반영돼요 → {SITE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
