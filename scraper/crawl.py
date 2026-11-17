"""제주대학교 공지사항 수집기.

탭(category)별 목록을 읽어 새 글(seq 기준)만 상세 페이지에서 본문을 가져오고,
마감일·주최기관 등을 추출해 docs/data/notices.json 에 저장한다.

사용법:  python scraper/crawl.py
환경변수:
  MAX_PAGES  카테고리당 최대 몇 페이지까지 내려가 볼지 (기본 3, 페이지당 20건)
  KEEP       카테고리당 보관할 최대 글 수 (기본 120)
  DELAY      요청 사이 대기 초 (기본 0.7)
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://www.jejunu.ac.kr"
BOARD = BASE + "/ara/noticesurvey/outEvent.htm"

# 탭 순서 = 화면에 보여줄 순서
CATEGORIES = [
    {"id": 197, "name": "봉사", "key": "volunteer"},
    {"id": 321, "name": "수업", "key": "class"},
    {"id": 203, "name": "일반", "key": "general"},
    {"id": 323, "name": "장학", "key": "scholarship"},
    {"id": 322, "name": "등록", "key": "tuition"},
    {"id": 200, "name": "행사", "key": "event"},
]

MAX_PAGES = int(os.getenv("MAX_PAGES", "3"))
KEEP = int(os.getenv("KEEP", "120"))
DELAY = float(os.getenv("DELAY", "0.7"))
EXCERPT_LEN = 220
REPARSE = bool(os.getenv("REPARSE"))  # 1 이면 기존 글도 상세 페이지를 다시 분석

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "notices.json"

KST = timezone(timedelta(hours=9))
session = requests.Session()
session.headers["User-Agent"] = "JNU-Notice-Board/1.0 (student project; low-frequency crawler)"

# 학교 서버가 중간 인증서를 보내지 않아 Python 에서 SSL 검증이 실패한다.
# 서버 인증서의 AIA 에 적힌 Sectigo 공식 주소에서 중간 인증서를 받아
# 기본 CA 번들에 덧붙여 검증한다 (검증을 끄지 않음).
INTERMEDIATE_URL = "http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt"


def setup_ca_bundle() -> None:
    import ssl
    import tempfile

    import certifi

    try:
        der = requests.get(INTERMEDIATE_URL, timeout=20).content
        pem = ssl.DER_cert_to_PEM_cert(der)
    except Exception as e:  # noqa: BLE001
        print(f"중간 인증서 다운로드 실패: {e}", file=sys.stderr)
        return
    bundle = Path(tempfile.gettempdir()) / "jnu_ca_bundle.pem"
    bundle.write_text(Path(certifi.where()).read_text(encoding="utf-8") + "\n" + pem, encoding="utf-8")
    session.verify = str(bundle)


def get(params: dict) -> BeautifulSoup:
    time.sleep(DELAY)
    r = session.get(BOARD, params=params, timeout=20)
    r.raise_for_status()
    r.encoding = r.apparent_encoding if r.encoding in (None, "ISO-8859-1") else r.encoding
    return BeautifulSoup(r.text, "html.parser")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


# ---------------------------------------------------------------- 목록 파싱
def parse_list(cat: dict, page: int) -> list[dict]:
    soup = get({"category": cat["id"], "page": page})
    rows = []
    for tr in soup.select("table tbody tr"):
        a = tr.select_one("td.title a[href*='act=view']")
        if not a:
            continue
        m = re.search(r"seq=(\d+)", a["href"])
        if not m:
            continue
        seq = int(m.group(1))
        tds = tr.find_all("td", recursive=False)
        texts = [clean(td.get_text(" ")) for td in tds]
        date_txt = next((t for t in texts if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t)), "")
        # 작성자 = 날짜 바로 앞 칸, 조회수 = 마지막 칸
        author, views = "", 0
        if date_txt:
            idx = texts.index(date_txt)
            author = texts[idx - 1] if idx > 0 else ""
            if idx + 1 < len(texts) and texts[idx + 1].isdigit():
                views = int(texts[idx + 1])
        is_notice = "notice" in " ".join(tr.get("class", [])) or not texts[0].strip().isdigit()
        rows.append({
            "seq": seq,
            "cat": cat["key"],
            "title": clean(a.get("title") or a.get_text()),
            "author": author,
            "date": date_txt,
            "views": views,
            "pinned": is_notice,
        })
    return rows


# ---------------------------------------------------------------- 상세 파싱
def parse_view(cat: dict, seq: int) -> dict:
    soup = get({"category": cat["id"], "act": "view", "seq": seq})
    view = soup.select_one(".board-view")
    body_el = view.select_one(".view-contents") if view else None
    # 줄 단위 텍스트 (마감일 추출용). <span> 단위가 아니라 문단·<br> 단위로 나눈다.
    lines = []
    if body_el:
        for br in body_el.find_all("br"):
            br.replace_with("\n")
        for tag in body_el.find_all(["p", "div", "li", "tr", "td", "h1", "h2", "h3", "h4", "h5", "h6", "table"]):
            tag.append("\n")
        for raw in body_el.get_text("").split("\n"):
            t = clean(raw)
            if t:
                lines.append(t)
    body = " ".join(lines)

    attachments = []
    for a in (view.select("a[href*='act=download']") if view else []):
        name = clean(a.get_text())
        name = re.sub(r"^\d+\.\s*", "", name)
        href = a["href"]
        attachments.append({"name": name, "url": BASE + href if href.startswith("/") else href})

    posted = None
    if view:
        m = re.search(r"작성일\s*:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", clean(view.get_text(" ")))
        if m:
            posted = m.group(1)

    return {"body": body, "lines": lines, "attachments": attachments, "posted": posted}


# ---------------------------------------------------------------- 정보 추출
DATE_PATTERNS = [
    # 2026. 11. 20.  / 2026-11-20 / 2026.11.20 / 2026년 11월 20일
    re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?"),
    # 11. 20.(목) / 11월 20일  (연도 없음)
    re.compile(r"(?<![\d.])(\d{1,2})\s*[.월/]\s*(\d{1,2})(?!\d)\s*[.일]?"),
]
DEADLINE_KEYS = re.compile(r"마감|신청|접수|제출|모집\s*기간|지원\s*기간|납부\s*기간|기한|까지")


def find_dates(text: str, base: date) -> list[date]:
    found: list[date] = []
    used = []
    for m in DATE_PATTERNS[0].finditer(text):
        try:
            found.append(date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
            used.append(m.span())
        except ValueError:
            pass
    for m in DATE_PATTERNS[1].finditer(text):
        if any(s <= m.start() < e for s, e in used):
            continue
        mo, dy = int(m.group(1)), int(m.group(2))
        if not (1 <= mo <= 12 and 1 <= dy <= 31):
            continue
        year = base.year
        # 연말(10~12월) 게시글의 1~3월 날짜만 다음 해로 본다 (예: 12월 게시글의 1월 마감)
        if base.month >= 10 and mo <= 3:
            year += 1
        try:
            found.append(date(year, mo, dy))
        except ValueError:
            pass
    return found


def guess_deadline(title: str, lines: list[str], posted: date) -> str | None:
    """'신청/접수/마감' 등이 들어간 줄의 날짜 중 가장 늦은 날짜를 마감일로 추정."""
    candidates: list[date] = []
    all_lines = [title] + lines[:80]
    for i, line in enumerate(all_lines):
        if "기존" in line:  # 변경 공지의 이전 일정은 제외
            continue
        if DEADLINE_KEYS.search(line):
            found = find_dates(line, posted)
            # "신청기간:" 처럼 제목만 있고 날짜가 다음 줄에 오는 경우
            if not found and i + 1 < len(all_lines):
                found = find_dates(all_lines[i + 1], posted)
            candidates += found
    # 게시일 이후 ~ 1년 이내만 인정
    candidates = [d for d in candidates if posted <= d <= posted + timedelta(days=365)]
    return max(candidates).isoformat() if candidates else None


def extract_periods(title: str, lines: list[str], posted: date) -> list[dict]:
    """등록금 공지용: 'A ~ B' 형태의 기간을 {label, start, end} 로 추출 (캘린더 표시용)."""
    periods: list[dict] = []
    for line in lines[:60]:
        if "기존" in line:  # 변경 공지의 이전 일정은 제외
            continue
        dates = [d for d in find_dates(line, posted) if posted - timedelta(days=7) <= d <= posted + timedelta(days=240)]
        if not dates:
            continue
        if "~" in line or "∼" in line or "부터" in line:
            if len(dates) < 2:
                continue
            start, end = dates[0], dates[1]
        elif re.search(r"납부|등록|마감|기한|까지", line):
            start = end = dates[0]
        else:
            continue
        if end < start:
            continue
        starts = [m.start() for p in DATE_PATTERNS for m in [p.search(line)] if m]
        label = line[: min(starts)] if starts else ""
        label = re.sub(r"^[\s\-*·○◎※▶■□•]+|[\s:：\-]+$", "", label).strip()
        label = re.sub(r"^\((변경|수정)\)$", "", label).strip()
        periods.append({"label": label[:30], "start": start.isoformat(), "end": end.isoformat()})
    # 중복 제거
    seen, uniq = set(), []
    for p in periods:
        k = (p["start"], p["end"])
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    return uniq[:8]


SKIP_PAREN = re.compile(r"완료|마감|육성|재안내|연장|변경|추가|수정|정정|긴급|필독|\d")


def guess_org(title: str) -> str | None:
    m = re.match(r"^\s*(?:\[[^\]]*\]\s*)*\(([^)]{2,30})\)", title)
    if m and not SKIP_PAREN.search(m.group(1)):
        return m.group(1).strip()
    return None


def is_closed(title: str) -> bool:
    return bool(re.search(r"[\[(]\s*(완료|마감|종료)\s*[\])]", title))


# ---------------------------------------------------------------- 메인
def load() -> dict:
    if OUT.exists():
        return json.loads(OUT.read_text(encoding="utf-8"))
    return {"notices": []}


def main() -> int:
    setup_ca_bundle()
    data = load()
    by_seq: dict[int, dict] = {n["seq"]: n for n in data.get("notices", [])}
    new_count = 0
    failed_cats = 0

    for cat in CATEGORIES:
        for page in range(1, MAX_PAGES + 1):
            try:
                rows = parse_list(cat, page)
            except Exception as e:  # noqa: BLE001
                print(f"[{cat['name']}] page {page} 실패: {e}", file=sys.stderr)
                if page == 1:
                    failed_cats += 1
                break
            if not rows:
                break
            page_new = 0
            for row in rows:
                old = by_seq.get(row["seq"])
                needs_reparse = REPARSE or (cat["key"] == "tuition" and "periods" not in old) if old else False
                if old and not needs_reparse:
                    # 이미 있는 글: 제목·조회수만 갱신
                    old.update({k: row[k] for k in ("title", "views", "pinned")})
                    old["closed"] = is_closed(row["title"])
                    continue
                try:
                    detail = parse_view(cat, row["seq"])
                except Exception as e:  # noqa: BLE001
                    print(f"  seq {row['seq']} 상세 실패: {e}", file=sys.stderr)
                    continue
                posted = date.fromisoformat(row["date"]) if row["date"] else datetime.now(KST).date()
                body = detail["body"]
                row.update({
                    "posted": detail["posted"] or row["date"],
                    "excerpt": body[:EXCERPT_LEN] + ("…" if len(body) > EXCERPT_LEN else ""),
                    "attachments": detail["attachments"],
                    "deadline": guess_deadline(row["title"], detail["lines"], posted),
                    "org": guess_org(row["title"]),
                    "closed": is_closed(row["title"]),
                    "url": f"{BOARD}?category={cat['id']}&act=view&seq={row['seq']}",
                })
                if cat["key"] == "tuition":
                    row["periods"] = extract_periods(row["title"], detail["lines"], posted)
                    if row["periods"]:  # 등록금은 납부기간의 마지막 날을 마감일로
                        row["deadline"] = max(p["end"] for p in row["periods"])
                by_seq[row["seq"]] = row
                if old:  # 재분석만 한 글은 새 글로 세지 않음
                    continue
                page_new += 1
                new_count += 1
                print(f"  + [{cat['name']}] {row['title'][:50]}")
            # 상단 고정글을 제외한 일반 글 중 새 글이 없으면 더 내려갈 필요 없음
            if page_new == 0:
                break

    # 카테고리별 최신 KEEP건만 보관
    notices = sorted(by_seq.values(), key=lambda n: n["seq"], reverse=True)
    kept, per_cat = [], {}
    for n in notices:
        per_cat[n["cat"]] = per_cat.get(n["cat"], 0) + 1
        if per_cat[n["cat"]] <= KEEP:
            kept.append(n)

    out = {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "source": BOARD,
        "categories": [{"key": c["key"], "name": c["name"], "id": c["id"]} for c in CATEGORIES],
        "notices": kept,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"새 글 {new_count}건, 총 {len(kept)}건 저장 → {OUT.relative_to(ROOT)}")

    crawl_news()
    crawl_weather()
    if failed_cats == len(CATEGORIES):
        print("학교 서버에 접속하지 못했습니다 (모든 탭 실패).", file=sys.stderr)
        return 2
    return 0


# ---------------------------------------------------------------- 제주 날씨
# MET Norway(노르웨이 기상청) Locationforecast — 무료, 키 불필요. 매시간 받아 JSON 으로 저장해
# 브라우저가 외부 API 에 직접 접속하지 않아도 되게 한다.
WEATHER_OUT = ROOT / "docs" / "data" / "weather.json"
CAMPUS = {"name": "제주 아라캠퍼스", "lat": 33.4558, "lon": 126.5614}
SYMBOLS = [  # (symbol_code 포함 문자열, 아이콘, 설명) — 위에서부터 먼저 매칭
    ("thunder", "⛈️", "뇌우"), ("heavysnow", "❄️", "강한 눈"), ("snowshowers", "🌨️", "눈 소나기"),
    ("lightsnow", "🌨️", "약한 눈"), ("snow", "🌨️", "눈"), ("sleet", "🌨️", "진눈깨비"),
    ("heavyrainshowers", "🌧️", "강한 소나기"), ("lightrainshowers", "🌦️", "약한 소나기"),
    ("rainshowers", "🌦️", "소나기"), ("heavyrain", "🌧️", "강한 비"), ("lightrain", "🌦️", "약한 비"),
    ("rain", "🌧️", "비"), ("fog", "🌫️", "안개"), ("cloudy", "☁️", "흐림"),
    ("partlycloudy", "⛅", "구름 조금"), ("fair", "🌤️", "대체로 맑음"), ("clearsky", "☀️", "맑음"),
]
SEVERITY = [s[0] for s in SYMBOLS]


def symbol(code: str | None) -> dict:
    code = code or ""
    for key, icon, desc in SYMBOLS:
        if key in code:
            # partlycloudy/cloudy 처럼 부분 문자열이 겹치는 경우 정확히 구분
            if key == "cloudy" and "partlycloudy" in code:
                continue
            if key == "rain" and "rainshowers" in code:
                continue
            if key == "snow" and "snowshowers" in code:
                continue
            return {"code": code, "icon": icon, "desc": desc}
    return {"code": code, "icon": "🌡️", "desc": "-"}


def crawl_weather() -> None:
    try:
        r = requests.get(
            "https://api.met.no/weatherapi/locationforecast/2.0/compact",
            params={"lat": CAMPUS["lat"], "lon": CAMPUS["lon"]},
            headers={"User-Agent": "JNU-Notice-Board/1.0 (student project, github pages)"},
            timeout=20,
        )
        r.raise_for_status()
        series = r.json()["properties"]["timeseries"]
    except Exception as e:  # noqa: BLE001
        print(f"날씨 실패: {e}", file=sys.stderr)
        return

    days: dict[str, dict] = {}
    for ts in series:
        t = datetime.fromisoformat(ts["time"].replace("Z", "+00:00")).astimezone(KST)
        key = t.date().isoformat()
        inst = ts["data"]["instant"]["details"]
        d = days.setdefault(key, {"date": key, "temps": [], "wind": 0.0, "rain": 0.0, "symbols": [], "noon": None})
        d["temps"].append(inst["air_temperature"])
        d["wind"] = max(d["wind"], inst.get("wind_speed", 0))
        n1, n6 = ts["data"].get("next_1_hours"), ts["data"].get("next_6_hours")
        if n1:
            d["rain"] += n1["details"].get("precipitation_amount", 0)
            if 7 <= t.hour <= 21:
                d["symbols"].append(n1["summary"]["symbol_code"])
        elif n6 and t.hour % 6 == 3:  # 6시간 단위 구간(KST 03/09/15/21시)
            d["rain"] += n6["details"].get("precipitation_amount", 0)
            if 9 <= t.hour <= 15:
                d["symbols"].append(n6["summary"]["symbol_code"])
        if 11 <= t.hour <= 13 and n6 and not d["noon"]:
            d["noon"] = n6["summary"]["symbol_code"]

    def day_summary(d: dict) -> dict:
        # 대표 날씨: 낮 시간대 중 가장 '궂은' 날씨 (우산 판단용)
        syms = d["symbols"] or ([d["noon"]] if d["noon"] else [])
        worst = min(syms, key=lambda s: next((i for i, k in enumerate(SEVERITY) if k in s), 99)) if syms else None
        return {
            "date": d["date"],
            "min": round(min(d["temps"])), "max": round(max(d["temps"])),
            "rain_mm": round(d["rain"], 1), "wind_max": round(d["wind"], 1),
            **symbol(worst),
        }

    ordered = [days[k] for k in sorted(days)]
    daily = [day_summary(d) for d in ordered[:4]]
    now = series[0]["data"]
    cur = {
        "temp": round(now["instant"]["details"]["air_temperature"], 1),
        "wind": now["instant"]["details"].get("wind_speed"),
        "humidity": round(now["instant"]["details"].get("relative_humidity", 0)),
        **symbol((now.get("next_1_hours") or now.get("next_6_hours") or {}).get("summary", {}).get("symbol_code")),
    }

    today = daily[0]
    alerts = []
    if today["rain_mm"] >= 1 or any(k in today["code"] for k in ("rain", "sleet", "snow", "thunder")):
        alerts.append(f"☔ 우산 챙기세요 (예상 강수 {today['rain_mm']}mm)")
    elif today["rain_mm"] > 0:
        alerts.append("🌂 약한 비 가능성, 접이식 우산 추천")
    if today["wind_max"] >= 9:
        alerts.append(f"💨 바람 강해요 (최대 {round(today['wind_max'])}m/s)")
    if today["max"] >= 31:
        alerts.append("🥵 폭염 주의, 물 챙기세요")
    if today["min"] <= 2:
        alerts.append("🧣 많이 추워요, 따뜻하게")
    if "snow" in today["code"]:
        alerts.append("⛄ 눈 소식, 길 미끄러움 주의")
    if today["max"] - today["min"] >= 10:
        alerts.append("🧥 일교차 커요, 겉옷 챙기기")

    WEATHER_OUT.write_text(json.dumps({
        "updated_at": datetime.now(KST).isoformat(timespec="minutes"),
        "place": CAMPUS["name"],
        "source": "MET Norway",
        "current": cur,
        "daily": daily,
        "alerts": alerts,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"날씨 저장: {cur['temp']}° {cur['desc']}, 알림 {len(alerts)}건")


# ---------------------------------------------------------------- 혜택 뉴스
# 포털(네이버·다음 등)에 실리는 언론사 기사를 Google 뉴스 RSS 로 모은다 (API 키 불필요).
NEWS_OUT = ROOT / "docs" / "data" / "news.json"
NEWS_QUERIES = [
    "대학생 혜택",
    "대학생 장학금 신청",
    "청년 지원금 신청",
    "제주 청년 지원",
    "청년 할인 혜택",
]
NEWS_DAYS = 21
NEWS_KEEP = 80
NEWS_INTERVAL_H = 6
NEWS_WHO = re.compile(r"대학생|대학원생|장학|학생|청년|20대|MZ")
NEWS_WHAT = re.compile(r"혜택|지원|장학|할인|무료|모집|신청|바우처|지급|공모|인턴|채용|체험|프로그램|수당")
# "영동군, …" 처럼 제주 외 시·군·구 소식으로 시작하는 기사는 제외
NEWS_OTHER_REGION = re.compile(r"^(?!제주|서귀포)[가-힣]{1,5}(군|구|시)(청)?(\s+[가-힣]{1,4}[면읍동])?\s*[,·\"“'‘]")
NEWS_TAGS = [
    ("제주", re.compile(r"제주|서귀포")),
    ("장학금", re.compile(r"장학")),
    ("지원금", re.compile(r"지원금|수당|바우처|지급|원 지원|만원")),
    ("할인", re.compile(r"할인|무료|반값|패스")),
    ("모집", re.compile(r"모집|공모|선발|인턴|채용|서포터즈")),
]


def crawl_news() -> None:
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime

    old = []
    if NEWS_OUT.exists():
        prev = json.loads(NEWS_OUT.read_text(encoding="utf-8"))
        old = prev.get("items", [])
        # 뉴스는 6시간에 한 번만 갱신 (매시간 커밋 방지)
        last = datetime.fromisoformat(prev.get("updated_at", "2000-01-01T00:00:00+09:00"))
        if datetime.now(KST) - last < timedelta(hours=NEWS_INTERVAL_H) and not os.getenv("FORCE_NEWS"):
            print("혜택 뉴스: 최근에 갱신됨, 건너뜀")
            return
    items = {n["link"]: n for n in old}
    cutoff = datetime.now(KST) - timedelta(days=NEWS_DAYS)

    for q in NEWS_QUERIES:
        try:
            r = requests.get(
                "https://news.google.com/rss/search",
                params={"q": f"{q} when:7d", "hl": "ko", "gl": "KR", "ceid": "KR:ko"},
                headers={"User-Agent": session.headers["User-Agent"]},
                timeout=20,
            )
            r.raise_for_status()
            root = ET.fromstring(r.content)
        except Exception as e:  # noqa: BLE001
            print(f"뉴스 '{q}' 실패: {e}", file=sys.stderr)
            continue
        for it in root.iter("item"):
            link = it.findtext("link") or ""
            title = clean(it.findtext("title") or "")
            source = clean(it.findtext("source") or "")
            if source and title.endswith(" - " + source):
                title = title[: -len(source) - 3]
            try:
                pub = parsedate_to_datetime(it.findtext("pubDate")).astimezone(KST)
            except Exception:  # noqa: BLE001
                continue
            if not (NEWS_WHO.search(title) and NEWS_WHAT.search(title)) or NEWS_OTHER_REGION.search(title):
                continue
            if link and link not in items:
                items[link] = {"title": title, "link": link, "source": source,
                               "published": pub.isoformat(timespec="minutes"),
                               "tags": [t for t, p in NEWS_TAGS if p.search(title)]}
        time.sleep(1)

    # 기간 필터 + 제목 중복 제거
    seen, result = set(), []
    for n in sorted(items.values(), key=lambda n: n["published"], reverse=True):
        if datetime.fromisoformat(n["published"]) < cutoff:
            continue
        key = re.sub(r"\W", "", n["title"])[:30]
        if key in seen:
            continue
        seen.add(key)
        result.append(n)
    result = result[:NEWS_KEEP]
    NEWS_OUT.write_text(json.dumps({
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "queries": NEWS_QUERIES,
        "items": result,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"혜택 뉴스 {len(result)}건 저장 → {NEWS_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
