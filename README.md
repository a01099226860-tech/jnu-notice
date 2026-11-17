# JNU 공지 한눈에

제주대학교 공지사항을 모아 마감일·등록금 일정·혜택 뉴스·제주 날씨와 함께 보여주는 학생용 **비공식** 웹사이트입니다.

사이트: https://a01099226860-tech.github.io/jnu-notice/

## 화면

| 보기 | 내용 |
|---|---|
| 공지 피드 | 왼쪽 **필터 사이드바**(검색·정렬·카테고리·마감·기타), 오른쪽 위 **이번 주 마감**, 그 아래 **3열 카드**. 카드를 누르면 **상세 모달** |
| 📅 등록금 캘린더 | 납부기간 월별 캘린더, 진행 중·곧 시작 일정 알림, `.ics` 로 내 캘린더에 알림 추가 |
| 📰 혜택 뉴스 | 대학생·청년 혜택(장학금·지원금·할인·모집) 기사, 제주 태그 |
| 헤더 날씨 알리미 | 제주 아라캠퍼스 현재 날씨·3일 예보, 우산/강풍/일교차 알림 |

공지 피드 규칙
- 들어오면 전체 피드가 보이고, 필터는 고를 때만 적용됩니다.
- 정렬: **마감임박순(기본)** / 최신 게시순.
- 마감이 지난 공지는 숨기고, **D-3 이하는 빨간 배지**.
- 결과 0건이면 "조건에 맞는 공지가 없어요. 필터를 바꿔보세요".
- 모바일(860px 이하)은 사이드바가 위로 올라가고 카드가 1열.

## 구조

```
scraper/crawl.py              수집기 (공지 + 혜택 뉴스 + 날씨)
server/setup.sh               클라우드 서버 1회 설치 스크립트
server/run.sh                 매시간 cron 실행: 수집 → 변경 시 커밋·push
docs/                         GitHub Pages 로 배포되는 정적 사이트
  index.html, style.css, app.js
  data/notices.json · news.json · weather.json
.github/workflows/crawl.yml   수동 실행 전용 (정기 수집은 클라우드 서버)
```

## 수집 서버 (한국 리전 클라우드)

제주대 서버가 GitHub Actions(해외 IP)의 접속을 거부하기 때문에, 수집은 **한국 리전 클라우드 서버**에서 cron 으로 돌립니다. 서버는 수집 결과를 이 저장소에 push 하고, GitHub Pages 가 자동으로 다시 배포합니다.

1. 한국(서울/춘천) 리전에 **Ubuntu 22.04 또는 24.04** 서버를 만듭니다. 가장 작은 사양(1 vCPU / 1GB)이면 충분합니다.
   - 예: Oracle Cloud Always Free(서울·춘천), AWS Lightsail 서울, 네이버 클라우드 등
2. 서버에 SSH 로 접속해서 실행합니다.
   ```bash
   curl -fsSL https://raw.githubusercontent.com/a01099226860-tech/jnu-notice/main/server/setup.sh | bash
   ```
3. 화면에 출력되는 공개키를 저장소 **Settings → Deploy keys → Add deploy key** 에 붙여넣고 **Allow write access** 를 체크합니다. (이 저장소에만 쓰기 권한이 있는 키라 계정 전체 권한이 서버에 남지 않습니다.)
4. Enter 를 누르면 clone, 패키지 설치, 학교 서버 접속 테스트, cron 등록(매시간 17분), 첫 실행까지 자동으로 진행됩니다.
5. 로그: `tail -f ~/jnu-notice.log`

## 로컬 실행

```bash
pip install -r requirements.txt
python scraper/crawl.py
python -m http.server 8000 -d docs   # http://localhost:8000
```

환경변수: `MAX_PAGES`(기본 3), `KEEP`(카테고리당 보관 건수, 기본 120), `DELAY`(요청 간격 초, 기본 0.7), `REPARSE=1`(기존 글도 다시 분석), `FORCE_NEWS=1`(뉴스 6시간 제한 무시).

## 참고

- 학교 서버가 SSL 중간 인증서를 보내지 않아, 수집기가 Sectigo 공식 주소에서 중간 인증서를 받아 검증 체인에 추가합니다 (검증을 끄지 않음).
- 마감일·납부기간은 본문 텍스트에서 뽑은 **추정치**입니다. 이미지나 첨부파일로만 된 공지는 추출되지 않습니다.
- 혜택 뉴스는 Google 뉴스 RSS, 날씨는 MET Norway(CC BY 4.0) 데이터입니다.
