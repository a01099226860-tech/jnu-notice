"""사이트를 인터넷 없이 열리는 HTML 파일 1개로 묶는다.

docs/index.html + style.css + app.js + data/*.json 을 한 파일에 넣어
docs/jnu-notice-offline.html 로 저장한다. (사이트의 '파일로 받기' 버튼이 이 파일을 내려받음)
데이터는 만든 시점 기준이며, 글꼴은 인터넷이 없으면 기본 글꼴로 보인다.
"""
import json
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "jnu-notice-offline.html"


def main() -> None:
    html = (DOCS / "index.html").read_text(encoding="utf-8")
    css = (DOCS / "style.css").read_text(encoding="utf-8")
    js = (DOCS / "app.js").read_text(encoding="utf-8")

    data = {}
    for name in ("notices.json", "news.json", "weather.json"):
        p = DOCS / "data" / name
        if p.exists():
            data[name] = json.loads(p.read_text(encoding="utf-8"))
    # </script> 가 본문에 섞여 있어도 태그가 끊기지 않게
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")

    html = re.sub(r'<link rel="stylesheet" href="style\.css[^"]*">',
                  lambda _: f"<style>\n{css}\n</style>", html)
    html = re.sub(r'<script src="app\.js[^"]*"></script>',
                  lambda _: f"<script>window.__OFFLINE = {payload};</script>\n<script>\n{js}\n</script>", html)
    # 오프라인 파일 안에서는 다운로드 버튼 대신 안내 문구
    html = re.sub(r'<p class="schedule download">.*?</p>',
                  '<p class="schedule download">📁 오프라인 저장본이에요. 최신 공지는 '
                  '<a href="https://a01099226860-tech.github.io/jnu-notice/">사이트</a>에서 확인하세요.</p>',
                  html, flags=re.S)
    OUT.write_text(html, encoding="utf-8")
    print(f"오프라인 파일 생성: {OUT.name} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
