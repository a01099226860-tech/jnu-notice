# JNU 공지 한눈에

제주대학교 공지사항을 탭별로 모아 새 글·마감일을 한눈에 보여주는 학생용 **비공식** 웹사이트입니다.

| 탭 | 내용 |
|---|---|
| 전체 · 봉사 · 수업 · 일반 · 장학 · 행사 | 공지 카드 목록, 마감일(추정) D-day, 이번 주 마감 모음, 검색·정렬 |
| 📅 등록 | 등록금 납부기간을 **월별 캘린더**로 표시, 진행 중/곧 시작 일정은 상단 **알림**, `.ics` 로 내 캘린더에 알림 추가 |
| 📰 혜택 뉴스 | 대학생·청년 대상 혜택(장학금·지원금·할인·모집) 기사 모음, 제주 기사 태그 |
| (헤더) 날씨 알리미 | 제주 아라캠퍼스 현재 날씨·3일 예보, 우산/강풍/일교차 알림 |

## 구조

```
scraper/crawl.py              수집기 (공지 + 혜택 뉴스 + 날씨)
docs/                         GitHub Pages 로 배포되는 정적 사이트
  index.html, style.css, app.js
  data/notices.json           공지 (매시간)
  data/news.json              혜택 뉴스 (6시간마다)
  data/weather.json           제주 날씨 (매시간)
.github/workflows/crawl.yml   매시간 실행 → 바뀐 데이터가 있으면 커밋 → Pages 자동 재배포
```

- **공지**: 6개 탭의 목록을 1페이지부터 확인하고, 처음 보는 `seq` 글만 상세 페이지를 열어 본문 요약·첨부·마감일·주최기관을 추출합니다. 등록 탭은 "A ~ B" 납부기간을 추가로 뽑아 캘린더에 씁니다 ("(기존)" 일정은 제외, "연장/변경" 공지가 겹치면 최신 것만 표시).
- **혜택 뉴스**: Google 뉴스 RSS(키 불필요)에서 여러 키워드로 모은 뒤, 대학생·청년 대상이면서 혜택 성격인 기사만 남기고 다른 시·군 소식은 제외합니다. 네이버 뉴스로 바꾸려면 네이버 검색 API 키를 발급받아 `crawl_news()` 를 교체하면 됩니다.
- **날씨**: MET Norway(노르웨이 기상청) 예보를 Actions 에서 받아 저장합니다. 브라우저가 외부 날씨 API 에 직접 접속하지 않아 어느 네트워크에서도 표시됩니다.

## 로컬 실행

```bash
pip install -r requirements.txt
python scraper/crawl.py
python -m http.server 8000 -d docs   # http://localhost:8000
```

환경변수: `MAX_PAGES`(기본 3), `KEEP`(카테고리당 보관 건수, 기본 120), `DELAY`(요청 간격 초, 기본 0.7), `REPARSE=1`(기존 글도 다시 분석), `FORCE_NEWS=1`(뉴스 6시간 제한 무시).

## GitHub 배포

1. 이 폴더를 GitHub 저장소로 push
2. Settings → Pages → Source: **Deploy from a branch**, Branch: `main` / `/docs`
3. Settings → Actions → General → Workflow permissions: **Read and write**
4. Actions 탭 → "공지 수집" → Run workflow 로 첫 실행 확인

## 참고

- 학교 서버가 SSL 중간 인증서를 보내지 않아, 수집기가 Sectigo 공식 주소에서 중간 인증서를 받아 검증 체인에 추가합니다 (검증을 끄지 않음).
- 마감일·납부기간은 본문 텍스트에서 뽑은 **추정치**입니다. 이미지나 첨부파일로만 된 공지는 추출되지 않습니다.
