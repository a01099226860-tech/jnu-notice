(() => {
  "use strict";

  const PAGE_SIZE = 30;
  const NEW_DAYS = 2;       // 며칠 이내 게시글에 NEW 표시
  const URGENT_DAYS = 7;    // '이번 주 마감' 범위

  const $ = (s) => document.querySelector(s);
  const state = {
    data: null, news: null,
    tab: "all", q: "", hideClosed: true, sort: "recent", shown: PAGE_SIZE,
    newsTag: "전체",
    calMonth: null, // Date (1일)
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  const parseDate = (s) => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const diffDays = (a, b) => Math.round((a - b) / 86400000);
  const daysLeft = (s) => { const d = parseDate(s); return d ? diffDays(d, today) : null; };
  const md = (s) => { const d = parseDate(s); return `${d.getMonth() + 1}.${d.getDate()}(${"일월화수목금토"[d.getDay()]})`; };

  // 저장된 설정 복원 (실패해도 무시)
  try {
    const saved = JSON.parse(localStorage.getItem("jnu-prefs") || "{}");
    if (typeof saved.hideClosed === "boolean") state.hideClosed = saved.hideClosed;
    if (saved.sort) state.sort = saved.sort;
  } catch (_) { /* noop */ }
  const savePrefs = () => { try { localStorage.setItem("jnu-prefs", JSON.stringify({ hideClosed: state.hideClosed, sort: state.sort })); } catch (_) { /* noop */ } };

  const catOf = (key) => state.data.categories.find((c) => c.key === key) || { key, name: key };
  const catStyle = (key) => `--cat-c: var(--c-${key}); --cat-t: var(--t-${key});`;

  function isExpired(n) {
    const left = daysLeft(n.deadline);
    return n.closed || (left !== null && left < 0);
  }

  function ddayBadge(n) {
    const left = daysLeft(n.deadline);
    if (left === null) return "";
    const label = left < 0 ? "마감" : left === 0 ? "D-DAY" : `D-${left}`;
    const cls = left < 0 ? "past" : left === 0 ? "today" : left <= 3 ? "urgent" : left <= 7 ? "soon" : "";
    return `<span class="badge dday ${cls}" title="마감(추정) ${esc(n.deadline)}">${label}</span>`;
  }

  // ================================================================ 탭
  function renderTabs() {
    const ns = state.data.notices;
    const visible = (n) => !(state.hideClosed && isExpired(n));
    const tabs = [
      { key: "all", name: "전체", count: ns.filter(visible).length, color: "var(--navy)" },
      ...state.data.categories.map((c) => ({
        key: c.key,
        name: c.key === "tuition" ? "📅 등록" : c.name,
        color: `var(--c-${c.key})`,
        count: c.key === "tuition" ? null : ns.filter((n) => n.cat === c.key && visible(n)).length,
      })),
      { key: "news", name: "📰 혜택 뉴스", color: "var(--green)", count: state.news ? state.news.items.length : null },
    ];
    $("#tabs").innerHTML = tabs.map((t) => `
      <button class="tab" role="tab" data-key="${t.key}" aria-selected="${t.key === state.tab}" style="--tab-c:${t.color}">
        ${t.key === "all" || t.key === "tuition" || t.key === "news" ? "" : '<span class="dot"></span>'}${esc(t.name)}${t.count === null ? "" : ` <span class="count">${t.count}</span>`}
      </button>`).join("");
  }

  // ================================================================ 공지 목록
  function filtered() {
    const q = state.q.trim().toLowerCase();
    const list = state.data.notices.filter((n) => {
      if (state.tab !== "all" && n.cat !== state.tab) return false;
      if (state.hideClosed && isExpired(n)) return false;
      if (q) {
        const hay = `${n.title} ${n.author} ${n.org || ""} ${n.excerpt || ""}`.toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const bySeq = (a, b) => b.seq - a.seq;
    if (state.sort === "deadline") {
      list.sort((a, b) => {
        const da = daysLeft(a.deadline), db = daysLeft(b.deadline);
        const ka = da === null || da < 0 ? Infinity : da;
        const kb = db === null || db < 0 ? Infinity : db;
        return ka - kb || bySeq(a, b);
      });
    } else if (state.sort === "views") {
      list.sort((a, b) => b.views - a.views);
    } else {
      list.sort(bySeq);
    }
    return list;
  }

  function card(n) {
    const cat = catOf(n.cat);
    const posted = parseDate(n.date);
    const isNew = posted && diffDays(today, posted) <= NEW_DAYS;
    const files = n.attachments || [];
    return `
    <article class="card ${isExpired(n) ? "closed" : ""}" style="${catStyle(n.cat)}">
      <div class="card-top">
        <span class="chip">${esc(cat.name)}</span>
        ${ddayBadge(n)}
        ${isNew ? '<span class="badge new">NEW</span>' : ""}
        ${n.pinned ? '<span class="badge pin">상단공지</span>' : ""}
      </div>
      <h3><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></h3>
      <div class="meta">
        <span>${esc(n.author)}</span>
        ${n.org ? `<span>주최 <b>${esc(n.org)}</b></span>` : ""}
        <span>${esc(n.date)}</span>
        ${n.deadline ? `<span>마감(추정) <b>${esc(n.deadline)}</b></span>` : ""}
        <span>조회 ${Number(n.views || 0).toLocaleString()}</span>
      </div>
      ${n.excerpt ? `<p class="excerpt">${esc(n.excerpt)}</p>` : ""}
      ${files.length ? `
      <details class="files">
        <summary>첨부파일 ${files.length}개</summary>
        <ul>${files.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a></li>`).join("")}</ul>
      </details>` : ""}
    </article>`;
  }

  function renderUrgent() {
    const items = state.data.notices
      .filter((n) => (state.tab === "all" || n.cat === state.tab) && !n.closed)
      .map((n) => ({ n, left: daysLeft(n.deadline) }))
      .filter(({ left }) => left !== null && left >= 0 && left <= URGENT_DAYS)
      .sort((a, b) => a.left - b.left);
    $("#urgent").hidden = items.length === 0;
    $("#urgentList").innerHTML = items.map(({ n }) => `
      <a class="urgent-item" href="${esc(n.url)}" target="_blank" rel="noopener" style="${catStyle(n.cat)}">
        <span class="row"><span class="chip">${esc(catOf(n.cat).name)}</span>${ddayBadge(n)}</span>
        <span class="t">${esc(n.title)}</span>
      </a>`).join("");
  }

  function renderList() {
    const list = filtered();
    const shown = list.slice(0, state.shown);
    $("#resultInfo").textContent = `${list.length}건${state.q ? ` · "${state.q}" 검색 결과` : ""}`;
    $("#list").innerHTML = shown.length
      ? shown.map(card).join("") + (list.length > shown.length ? `<button class="more" id="more">더 보기 (${list.length - shown.length}건 남음)</button>` : "")
      : `<div class="empty">조건에 맞는 공지가 없어요.</div>`;
  }

  // ================================================================ 등록금 캘린더
  function tuitionEvents() {
    const evs = [];
    for (const n of state.data.notices.filter((x) => x.cat === "tuition")) {
      const periods = (n.periods || []).length ? n.periods
        : n.deadline ? [{ label: "", start: n.deadline, end: n.deadline }] : [];
      if (periods.length) {
        for (const p of periods) {
          evs.push({ type: "period", label: p.label || shortTitle(n.title), start: p.start, end: p.end, notice: n });
        }
      } else {
        evs.push({ type: "posted", label: shortTitle(n.title), start: n.date, end: n.date, notice: n });
      }
    }
    // '연장/변경' 공지가 기존 일정과 겹치면 예전 일정은 숨긴다
    const overrides = evs.filter((e) => e.type === "period" && /연장|변경/.test(e.notice.title));
    const result = evs.filter((e) => !(e.type === "period" && overrides.some((o) =>
      o.notice.seq > e.notice.seq && o.start <= e.end && e.start <= o.end)));
    return result.sort((a, b) => a.start.localeCompare(b.start));
  }

  function shortTitle(t) {
    return t.replace(/^\s*[【\[(][^】\])]*[】\])]\s*/, "").replace(/\d{4}학년도\s*/, "").replace(/\s*안내\s*$/, "").trim();
  }

  function evStatus(ev) {
    if (ev.type === "posted") return "posted";
    const s = daysLeft(ev.start), e = daysLeft(ev.end);
    if (e < 0) return "past";
    if (s <= 0) return "ongoing";
    return "upcoming";
  }

  function icsFor(ev) {
    const d = (s) => s.replace(/-/g, "");
    const endPlus = new Date(parseDate(ev.end).getTime() + 86400000);
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//JNU Notice//KO",
      "BEGIN:VEVENT",
      `UID:jnu-${ev.notice.seq}-${d(ev.start)}@jnu-notice`,
      `DTSTAMP:${d(iso(today))}T000000Z`,
      `DTSTART;VALUE=DATE:${d(ev.start)}`,
      `DTEND;VALUE=DATE:${d(iso(endPlus))}`,
      `SUMMARY:[등록금] ${ev.label}`,
      `URL:${ev.notice.url}`,
      `DESCRIPTION:${ev.notice.title} - ${ev.notice.url}`,
      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:내일부터 ${ev.label}`, "END:VALARM",
      "BEGIN:VALARM", "TRIGGER;RELATED=END:-PT15H", "ACTION:DISPLAY", `DESCRIPTION:오늘 ${ev.label} 마감`, "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ];
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
  }

  function renderAlerts(evs) {
    const periods = evs.filter((e) => e.type === "period");
    const ongoing = periods.filter((e) => evStatus(e) === "ongoing");
    const upcoming = periods.filter((e) => evStatus(e) === "upcoming" && daysLeft(e.start) <= 45);
    const alert = (ev, kind) => {
      const s = daysLeft(ev.start), e = daysLeft(ev.end);
      const head = kind === "ongoing"
        ? (e === 0 ? "🔴 오늘 마감!" : `🔴 지금 납부 기간 · 마감까지 D-${e}`)
        : `🔵 곧 시작 · D-${s}`;
      return `
      <div class="alert ${kind}">
        <span class="bell">🔔</span>
        <div class="body">
          <div class="head">${head}</div>
          <div class="t">${esc(ev.label)}</div>
          <div class="when">${md(ev.start)}${ev.start !== ev.end ? ` ~ ${md(ev.end)}` : ""}</div>
          <div class="actions">
            <a class="btn-sm" href="${esc(ev.notice.url)}" target="_blank" rel="noopener">원문 보기</a>
            <a class="btn-sm" href="${icsFor(ev)}" download="jnu-tuition-${esc(ev.start)}.ics">📆 내 캘린더에 알림 추가</a>
          </div>
        </div>
      </div>`;
    };
    let html = ongoing.map((e) => alert(e, "ongoing")).join("") + upcoming.map((e) => alert(e, "upcoming")).join("");
    if (!html) {
      const last = state.data.notices.filter((n) => n.cat === "tuition").sort((a, b) => b.seq - a.seq)[0];
      html = `
      <div class="alert idle">
        <span class="bell">🔕</span>
        <div class="body">
          <div class="head">지금은 진행 중인 납부 기간이 없어요</div>
          <div class="t">다음 학기 등록 공지가 올라오면 여기에 알려드릴게요</div>
          ${last ? `<div class="when">최근 공지: <a href="${esc(last.url)}" target="_blank" rel="noopener">${esc(last.title)}</a> (${esc(last.date)})</div>` : ""}
        </div>
      </div>`;
    }
    $("#tuitionAlerts").innerHTML = html;
  }

  function renderCalendar() {
    const evs = tuitionEvents();
    renderAlerts(evs);

    if (!state.calMonth) state.calMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const m0 = state.calMonth;
    const y = m0.getFullYear(), m = m0.getMonth();
    $("#calTitle").textContent = `${y}년 ${m + 1}월`;

    const first = new Date(y, m, 1);
    const gridStart = new Date(y, m, 1 - first.getDay());
    const lastDay = new Date(y, m + 1, 0);
    const weeks = Math.ceil((first.getDay() + lastDay.getDate()) / 7);

    let html = "일월화수목금토".split("").map((d, i) => `<div class="cal-dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("");
    for (let i = 0; i < weeks * 7; i++) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const ds = iso(day);
      const cls = [
        day.getMonth() !== m ? "out" : "",
        day.getTime() === today.getTime() ? "today" : "",
        day.getDay() === 0 ? "sun" : "",
      ].join(" ");
      const dayEvs = evs.filter((e) => e.start <= ds && ds <= e.end);
      html += `<div class="cal-cell ${cls}">
        <span class="cal-num">${day.getDate()}</span>
        ${dayEvs.map((e) => {
          const st = evStatus(e);
          const label = e.type === "posted" ? `공지 · ${e.label}` : (ds === e.end && e.start !== e.end ? `마감 · ${e.label}` : e.label);
          return `<a class="cal-ev ${st}" href="${esc(e.notice.url)}" target="_blank" rel="noopener" title="${esc(e.label)} (${md(e.start)}${e.start !== e.end ? " ~ " + md(e.end) : ""})">${esc(label)}</a>`;
        }).join("")}
      </div>`;
    }
    $("#calGrid").innerHTML = html;

    // 이 달 일정 목록
    const mStart = iso(first), mEnd = iso(lastDay);
    const monthEvs = evs.filter((e) => e.start <= mEnd && e.end >= mStart);
    $("#calList").innerHTML = monthEvs.length ? monthEvs.map((e) => `
      <a class="ev-row" href="${esc(e.notice.url)}" target="_blank" rel="noopener">
        <span class="ev-date">${md(e.start)}${e.start !== e.end ? `<br>~ ${md(e.end)}` : ""}</span>
        <span><span class="t">${e.type === "posted" ? "📄 " : ""}${esc(e.label)}</span><br><span class="s">${esc(e.notice.title)}</span></span>
      </a>`).join("") : `<div class="empty">이 달에는 등록 일정이 없어요.</div>`;

    $("#tuitionList").innerHTML = state.data.notices.filter((n) => n.cat === "tuition")
      .sort((a, b) => b.seq - a.seq).slice(0, 10).map(card).join("");
  }

  // ================================================================ 혜택 뉴스
  const NEWS_TAGS = ["전체", "제주", "장학금", "지원금", "할인", "모집"];

  function relTime(isoStr) {
    const mins = Math.round((Date.now() - new Date(isoStr)) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)}분 전`;
    if (mins < 1440) return `${Math.round(mins / 60)}시간 전`;
    return `${Math.round(mins / 1440)}일 전`;
  }

  function renderNews() {
    if (!state.news) {
      $("#newsList").innerHTML = `<div class="empty">뉴스를 불러오지 못했어요.</div>`;
      return;
    }
    $("#newsTags").innerHTML = NEWS_TAGS.map((t) => `<button class="fchip" data-tag="${t}" aria-pressed="${t === state.newsTag}">${t}</button>`).join("");
    const q = state.q.trim().toLowerCase();
    const items = state.news.items.filter((n) =>
      (state.newsTag === "전체" || (n.tags || []).includes(state.newsTag)) &&
      (!q || `${n.title} ${n.source}`.toLowerCase().includes(q)));
    $("#newsInfo").textContent = `${items.length}건 · 대학생·청년 혜택 관련 최근 기사 (6시간마다 갱신)`;
    $("#newsList").innerHTML = items.length ? items.map((n) => `
      <a class="news" href="${esc(n.link)}" target="_blank" rel="noopener">
        <span class="src"><b>${esc(n.source)}</b><span>${relTime(n.published)}</span></span>
        <span class="t">${esc(n.title)}</span>
        <span class="tags">${(n.tags || []).map((t) => `<span class="ntag ${t === "제주" ? "jeju" : ""}">${esc(t)}</span>`).join("")}</span>
      </a>`).join("") : `<div class="empty">조건에 맞는 기사가 없어요.</div>`;
  }

  // ================================================================ 날씨 알리미
  // GitHub Actions 가 매시간 MET Norway 예보를 받아 data/weather.json 으로 저장한다.
  function renderWeather(w) {
    const c = w.current, d = w.daily;
    const dayName = (s, i) => i === 1 ? "내일" : i === 2 ? "모레" : `${"일월화수목금토"[parseDate(s).getDay()]}요일`;
    const alerts = w.alerts || [];
    const up = new Date(w.updated_at);
    $("#weather").innerHTML = `
      <div class="w-top">
        <span class="w-icon">${c.icon}</span>
        <div>
          <div class="w-temp">${Math.round(c.temp)}°</div>
          <div class="w-desc">${esc(c.desc)} · 습도 ${c.humidity}% · 바람 ${Number(c.wind).toFixed(1)}m/s</div>
        </div>
        <div class="w-place">${esc(w.place)}<br>${d[0].min}° / ${d[0].max}°</div>
      </div>
      <div class="w-alerts">${(alerts.length ? alerts : ["👍 오늘 날씨 무난해요"]).map((a) => `<span class="w-alert ${alerts.length ? "" : "ok"}">${esc(a)}</span>`).join("")}</div>
      <div class="w-days">${d.slice(1, 4).map((x, i) => `
        <div class="w-day"><b>${dayName(x.date, i + 1)}</b><span class="ico" title="${esc(x.desc)}">${x.icon}</span>${x.min}° / ${x.max}°<br>☂ ${x.rain_mm}mm</div>`).join("")}
      </div>
      <div class="w-src">${up.getHours()}시 기준 · ${esc(w.source)}</div>`;
  }

  function loadWeather() {
    fetch(`data/weather.json?v=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(renderWeather)
      .catch(() => { $("#weather").innerHTML = `<div class="weather-loading">날씨 정보를 불러오지 못했어요.</div>`; });
  }

  // ================================================================ 렌더링
  function render() {
    renderTabs();
    const view = state.tab === "tuition" ? "calendar" : state.tab === "news" ? "news" : "notice";
    $("#noticeView").hidden = view !== "notice";
    $("#calendarView").hidden = view !== "calendar";
    $("#newsView").hidden = view !== "news";
    $("#toolbar").hidden = view === "calendar";
    $("#noticeOptions").hidden = view !== "notice";
    $("#q").placeholder = view === "news" ? "뉴스 제목, 언론사 검색" : "제목, 부서, 기관 검색";
    if (view === "notice") { renderUrgent(); renderList(); }
    else if (view === "calendar") renderCalendar();
    else renderNews();
  }

  const validTab = (k) => k === "all" || k === "news" || state.data.categories.some((c) => c.key === k);

  function setTab(key, push = true) {
    if (!validTab(key)) key = "all";
    state.tab = key;
    state.shown = PAGE_SIZE;
    if (push) history.replaceState(null, "", key === "all" ? location.pathname : `#${key}`);
    render();
  }

  // ================================================================ 이벤트
  $("#tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) setTab(btn.dataset.key);
  });
  $("#list").addEventListener("click", (e) => {
    if (e.target.id === "more") { state.shown += PAGE_SIZE; renderList(); }
  });
  $("#newsTags").addEventListener("click", (e) => {
    const b = e.target.closest(".fchip");
    if (b) { state.newsTag = b.dataset.tag; renderNews(); }
  });
  let t;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = e.target.value; state.shown = PAGE_SIZE;
      if (state.tab === "news") renderNews(); else renderList();
    }, 150);
  });
  $("#hideClosed").addEventListener("change", (e) => { state.hideClosed = e.target.checked; savePrefs(); render(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; savePrefs(); renderList(); });
  const shiftMonth = (n) => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + n, 1); renderCalendar(); };
  $("#calPrev").addEventListener("click", () => shiftMonth(-1));
  $("#calNext").addEventListener("click", () => shiftMonth(1));
  $("#calToday").addEventListener("click", () => { state.calMonth = null; renderCalendar(); });
  window.addEventListener("hashchange", () => setTab(location.hash.slice(1) || "all", false));

  // ================================================================ 시작
  $("#hideClosed").checked = state.hideClosed;
  $("#sort").value = state.sort;
  loadWeather();

  const bust = `?v=${Date.now()}`;
  Promise.all([
    fetch(`data/notices.json${bust}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch(`data/news.json${bust}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([data, news]) => {
    state.data = data;
    state.news = news;
    const hash = location.hash.slice(1);
    if (validTab(hash)) state.tab = hash;
    const up = new Date(data.updated_at);
    $("#updated").textContent = `${up.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} 업데이트 · 공지 ${data.notices.length}건`;
    render();
  }).catch(() => {
    $("#updated").textContent = "데이터를 불러오지 못했어요";
    $("#list").innerHTML = `<div class="empty">데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>`;
  });
})();
