(() => {
  "use strict";

  const PAGE_SIZE = 24;
  const NEW_DAYS = 2;       // 며칠 이내 게시글에 NEW 표시
  const URGENT_DAYS = 7;    // '이번 주 마감' 범위
  const RED_DAYS = 3;       // D-3 이하는 빨간 배지
  // GitHub Actions 자동 수집 시각 (.github/workflows/crawl.yml 의 cron "7,37 * * * *" 과 맞출 것)
  const UPDATE_MINUTES = [7, 37];
  const nextUpdate = () => {
    const now = new Date();
    for (let h = 0; h <= 1; h++) {
      for (const m of UPDATE_MINUTES) {
        const t = new Date(now);
        t.setHours(now.getHours() + h, m, 0, 0);
        if (t > now) return t;
      }
    }
    return now;
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const state = {
    data: null, news: null,
    view: "feed",
    // 공지 피드 필터 (기본값 = 전체 피드)
    q: "", sort: "deadline", cats: new Set(), due: "all", onlyNew: false, hasFiles: false,
    shown: PAGE_SIZE,
    // 기타 보기
    newsTag: "전체", newsQ: "",
    calMonth: null,
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  const parseDate = (s) => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const diffDays = (a, b) => Math.round((a - b) / 86400000);
  const daysLeft = (s) => { const d = parseDate(s); return d ? diffDays(d, today) : null; };
  const md = (s) => { const d = parseDate(s); return `${d.getMonth() + 1}.${d.getDate()}(${"일월화수목금토"[d.getDay()]})`; };

  const catOf = (key) => state.data.categories.find((c) => c.key === key) || { key, name: key };
  const catStyle = (key) => `--cat-c: var(--c-${key}); --cat-t: var(--t-${key});`;
  const bySeq = new Map();

  // 마감이 지난 공지(제목에 완료/마감 표기 포함)는 항상 숨긴다
  const isExpired = (n) => n.closed || (daysLeft(n.deadline) ?? 0) < 0;
  const isNew = (n) => { const p = parseDate(n.date); return p && diffDays(today, p) <= NEW_DAYS; };

  function ddayBadge(n) {
    const left = daysLeft(n.deadline);
    if (left === null || left < 0) return "";
    const label = left === 0 ? "D-DAY" : `D-${left}`;
    const cls = left <= RED_DAYS ? "urgent" : left <= URGENT_DAYS ? "soon" : "";
    return `<span class="badge dday ${cls}" title="마감(추정) ${esc(n.deadline)}">${label}</span>`;
  }

  // ================================================================ 공지 피드
  function matches(n, { ignoreCats = false } = {}) {
    if (isExpired(n)) return false;
    if (!ignoreCats && state.cats.size && !state.cats.has(n.cat)) return false;
    const left = daysLeft(n.deadline);
    if (state.due === "has" && left === null) return false;
    if (state.due === "week" && !(left !== null && left <= URGENT_DAYS)) return false;
    if (state.onlyNew && !isNew(n)) return false;
    if (state.hasFiles && !(n.attachments || []).length) return false;
    const q = state.q.trim().toLowerCase();
    if (q) {
      const hay = `${n.title} ${n.author} ${n.org || ""} ${n.excerpt || ""}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function sorted(list) {
    if (state.sort === "recent") return list.sort((a, b) => b.seq - a.seq);
    // 마감임박순: 마감일 있는 글을 가까운 순으로, 마감일 없는 글은 뒤에 최신순
    return list.sort((a, b) => {
      const da = daysLeft(a.deadline), db = daysLeft(b.deadline);
      return (da ?? Infinity) - (db ?? Infinity) || b.seq - a.seq;
    });
  }

  function card(n) {
    const files = (n.attachments || []).length;
    return `
    <button class="card" data-seq="${n.seq}" style="${catStyle(n.cat)}" aria-haspopup="dialog">
      <span class="card-top">
        <span class="chip">${esc(catOf(n.cat).name)}</span>
        ${ddayBadge(n)}
        ${isNew(n) ? '<span class="badge new">NEW</span>' : ""}
      </span>
      <span class="t">${esc(n.title)}</span>
      ${n.excerpt ? `<span class="excerpt">${esc(n.excerpt)}</span>` : ""}
      <span class="card-foot">
        <span>${esc(n.org || n.author)}</span>
        <span>${esc(n.date)}</span>
        ${n.deadline ? `<span class="due">~${md(n.deadline)}</span>` : ""}
        ${files ? `<span>📎 ${files}</span>` : ""}
      </span>
    </button>`;
  }

  function renderSidebar() {
    // 카테고리별 건수: 카테고리 외의 다른 필터를 적용한 상태 기준
    const base = state.data.notices.filter((n) => matches(n, { ignoreCats: true }));
    $("#catChecks").innerHTML = state.data.categories.map((c) => `
      <label class="check" style="${catStyle(c.key)}">
        <input type="checkbox" value="${c.key}" ${state.cats.has(c.key) ? "checked" : ""}>
        <span class="dot"></span><span>${esc(c.name)}</span>
        <span class="n">${base.filter((n) => n.cat === c.key).length}</span>
      </label>`).join("");
    $$("#sortSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
    $$("#dueRadios input").forEach((r) => { r.checked = r.value === state.due; });
    $("#onlyNew").checked = state.onlyNew;
    $("#hasFiles").checked = state.hasFiles;
    $("#resetFilters").hidden = !activeFilters().length;
  }

  function activeFilters() {
    const out = [];
    if (state.q.trim()) out.push({ key: "q", label: `"${state.q.trim()}"` });
    for (const c of state.cats) out.push({ key: `cat:${c}`, label: catOf(c).name });
    if (state.due === "week") out.push({ key: "due", label: "7일 이내 마감" });
    if (state.due === "has") out.push({ key: "due", label: "마감일 있음" });
    if (state.onlyNew) out.push({ key: "new", label: "새 글" });
    if (state.hasFiles) out.push({ key: "files", label: "첨부파일" });
    return out;
  }

  function removeFilter(key) {
    if (key === "q") { state.q = ""; $("#q").value = ""; }
    else if (key.startsWith("cat:")) state.cats.delete(key.slice(4));
    else if (key === "due") state.due = "all";
    else if (key === "new") state.onlyNew = false;
    else if (key === "files") state.hasFiles = false;
  }

  function renderUrgent() {
    const items = state.data.notices
      .filter((n) => !isExpired(n) && (!state.cats.size || state.cats.has(n.cat)))
      .filter((n) => { const l = daysLeft(n.deadline); return l !== null && l <= URGENT_DAYS; })
      .sort((a, b) => daysLeft(a.deadline) - daysLeft(b.deadline) || b.seq - a.seq);
    $("#urgent").hidden = items.length === 0;
    $("#urgentCount").textContent = `${items.length}건`;
    $("#urgentList").innerHTML = items.map((n) => `
      <button class="urgent-item" data-seq="${n.seq}" style="${catStyle(n.cat)}" aria-haspopup="dialog">
        <span class="row"><span class="chip">${esc(catOf(n.cat).name)}</span>${ddayBadge(n)}</span>
        <span class="t">${esc(n.title)}</span>
      </button>`).join("");
  }

  function renderGrid() {
    const list = sorted(state.data.notices.filter((n) => matches(n)));
    const shown = list.slice(0, state.shown);
    $("#resultInfo").innerHTML = `<b>${list.length}</b>건 · ${state.sort === "deadline" ? "마감임박순" : "최신 게시순"}`;
    $("#activeFilters").innerHTML = activeFilters().map((f) =>
      `<button class="af" data-remove="${esc(f.key)}">${esc(f.label)} <span aria-label="제거">×</span></button>`).join("");
    $("#grid").innerHTML = shown.length
      ? shown.map(card).join("")
      : `<div class="empty"><b>조건에 맞는 공지가 없어요.</b>필터를 바꿔보세요</div>`;
    const rest = list.length - shown.length;
    $("#more").hidden = rest <= 0;
    $("#more").textContent = `더 보기 (${rest}건 남음)`;
  }

  function renderFeed() {
    renderSidebar();
    renderUrgent();
    renderGrid();
  }

  // ================================================================ 상세 모달
  function openModal(seq) {
    const n = bySeq.get(Number(seq));
    if (!n) return;
    const left = daysLeft(n.deadline);
    const files = n.attachments || [];
    const periods = n.periods || [];
    $("#modalBody").setAttribute("style", catStyle(n.cat));
    $("#modalBody").innerHTML = `
      <div class="m-head">
        <div class="card-top">
          <span class="chip">${esc(catOf(n.cat).name)}</span>
          ${ddayBadge(n)}
          ${isNew(n) ? '<span class="badge new">NEW</span>' : ""}
        </div>
        <button class="m-close" id="mClose" aria-label="닫기">×</button>
      </div>
      <h2 id="mTitle">${esc(n.title)}</h2>
      <dl class="m-info">
        <dt>작성 부서</dt><dd>${esc(n.author)}</dd>
        ${n.org ? `<dt>주최 기관</dt><dd>${esc(n.org)}</dd>` : ""}
        <dt>게시일</dt><dd>${esc(n.posted || n.date)}</dd>
        ${n.deadline ? `<dt>마감(추정)</dt><dd class="${left !== null && left <= RED_DAYS ? "red" : ""}">${md(n.deadline)} · ${left === 0 ? "오늘 마감" : `${left}일 남음`}</dd>` : ""}
        ${periods.map((p) => `<dt>${esc(p.label || "기간")}</dt><dd>${md(p.start)}${p.start !== p.end ? ` ~ ${md(p.end)}` : ""}</dd>`).join("")}
        <dt>조회수</dt><dd>${Number(n.views || 0).toLocaleString()}</dd>
      </dl>
      ${n.excerpt ? `<p class="m-body">${esc(n.excerpt)}</p>` : `<p class="m-body" style="color:var(--muted)">본문이 이미지나 첨부파일로만 되어 있어요. 원문에서 확인하세요.</p>`}
      ${files.length ? `
      <div class="m-files">
        <h3>첨부파일 ${files.length}개</h3>
        <ul>${files.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a></li>`).join("")}</ul>
      </div>` : ""}
      <div class="m-actions">
        <a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener">원문 보기 ↗</a>
        <button class="btn" id="mClose2">닫기</button>
      </div>`;
    const dlg = $("#modal");
    if (!dlg.open) dlg.showModal();
    $("#mClose").focus();
  }

  const closeModal = () => { if ($("#modal").open) $("#modal").close(); };

  // ================================================================ 등록금 캘린더
  function shortTitle(t) {
    return t.replace(/^\s*[【\[(][^】\])]*[】\])]\s*/, "").replace(/\d{4}학년도\s*/, "").replace(/\s*안내\s*$/, "").trim();
  }

  function tuitionEvents() {
    const evs = [];
    for (const n of state.data.notices.filter((x) => x.cat === "tuition")) {
      const periods = (n.periods || []).length ? n.periods
        : n.deadline ? [{ label: "", start: n.deadline, end: n.deadline }] : [];
      if (periods.length) {
        for (const p of periods) evs.push({ type: "period", label: p.label || shortTitle(n.title), start: p.start, end: p.end, notice: n });
      } else {
        evs.push({ type: "posted", label: shortTitle(n.title), start: n.date, end: n.date, notice: n });
      }
    }
    // '연장/변경' 공지가 기존 일정과 겹치면 예전 일정은 숨긴다
    const overrides = evs.filter((e) => e.type === "period" && /연장|변경/.test(e.notice.title));
    return evs.filter((e) => !(e.type === "period" && overrides.some((o) =>
      o.notice.seq > e.notice.seq && o.start <= e.end && e.start <= o.end)))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  function evStatus(ev) {
    if (ev.type === "posted") return "posted";
    if (daysLeft(ev.end) < 0) return "past";
    if (daysLeft(ev.start) <= 0) return "ongoing";
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
            <button class="btn-sm" data-seq="${ev.notice.seq}">자세히</button>
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
          ${last ? `<div class="when">최근 공지: ${esc(last.title)} (${esc(last.date)})</div>` : ""}
        </div>
      </div>`;
    }
    $("#tuitionAlerts").innerHTML = html;
  }

  function renderCalendar() {
    const evs = tuitionEvents();
    renderAlerts(evs);

    if (!state.calMonth) state.calMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const y = state.calMonth.getFullYear(), m = state.calMonth.getMonth();
    $("#calTitle").textContent = `${y}년 ${m + 1}월`;

    const first = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const weeks = Math.ceil((first.getDay() + lastDay.getDate()) / 7);

    let html = "일월화수목금토".split("").map((d, i) => `<div class="cal-dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("");
    for (let i = 0; i < weeks * 7; i++) {
      const day = new Date(y, m, 1 - first.getDay() + i);
      const ds = iso(day);
      const cls = [day.getMonth() !== m ? "out" : "", day.getTime() === today.getTime() ? "today" : "", day.getDay() === 0 ? "sun" : ""].join(" ");
      const dayEvs = evs.filter((e) => e.start <= ds && ds <= e.end);
      html += `<div class="cal-cell ${cls}">
        <span class="cal-num">${day.getDate()}</span>
        ${dayEvs.map((e) => {
          const label = e.type === "posted" ? `공지 · ${e.label}` : (ds === e.end && e.start !== e.end ? `마감 · ${e.label}` : e.label);
          return `<button class="cal-ev ${evStatus(e)}" data-seq="${e.notice.seq}" title="${esc(e.label)} (${md(e.start)}${e.start !== e.end ? " ~ " + md(e.end) : ""})">${esc(label)}</button>`;
        }).join("")}
      </div>`;
    }
    $("#calGrid").innerHTML = html;

    const mStart = iso(first), mEnd = iso(lastDay);
    const monthEvs = evs.filter((e) => e.start <= mEnd && e.end >= mStart);
    $("#calList").innerHTML = monthEvs.length ? monthEvs.map((e) => `
      <button class="ev-row" data-seq="${e.notice.seq}">
        <span class="ev-date">${md(e.start)}${e.start !== e.end ? `<br>~ ${md(e.end)}` : ""}</span>
        <span><span class="t">${e.type === "posted" ? "📄 " : ""}${esc(e.label)}</span><br><span class="s">${esc(e.notice.title)}</span></span>
      </button>`).join("") : `<div class="empty">이 달에는 등록 일정이 없어요.</div>`;

    $("#tuitionGrid").innerHTML = state.data.notices.filter((n) => n.cat === "tuition")
      .sort((a, b) => b.seq - a.seq).slice(0, 6).map(card).join("");
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
    const q = state.newsQ.trim().toLowerCase();
    const items = state.news.items.filter((n) =>
      (state.newsTag === "전체" || (n.tags || []).includes(state.newsTag)) &&
      (!q || `${n.title} ${n.source}`.toLowerCase().includes(q)));
    $("#newsInfo").textContent = `${items.length}건 · 대학생·청년 혜택 관련 최근 기사`;
    $("#newsList").innerHTML = items.length ? items.map((n) => `
      <a class="news" href="${esc(n.link)}" target="_blank" rel="noopener">
        <span class="src"><b>${esc(n.source)}</b><span>${relTime(n.published)}</span></span>
        <span class="t">${esc(n.title)}</span>
        <span class="tags">${(n.tags || []).map((t) => `<span class="ntag ${t === "제주" ? "jeju" : ""}">${esc(t)}</span>`).join("")}</span>
      </a>`).join("") : `<div class="empty"><b>조건에 맞는 기사가 없어요.</b>필터를 바꿔보세요</div>`;
  }

  // ================================================================ 날씨 알리미
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

  // ================================================================ 보기 전환
  function render() {
    $$(".view-btn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    $("#feedView").hidden = state.view !== "feed";
    $("#tuitionView").hidden = state.view !== "tuition";
    $("#newsView").hidden = state.view !== "news";
    if (state.view === "feed") renderFeed();
    else if (state.view === "tuition") renderCalendar();
    else renderNews();
  }

  function setView(view, push = true) {
    state.view = ["feed", "tuition", "news"].includes(view) ? view : "feed";
    if (push) history.replaceState(null, "", state.view === "feed" ? location.pathname : `#${state.view}`);
    render();
  }

  // ================================================================ 이벤트
  const refreshFeed = () => { state.shown = PAGE_SIZE; renderFeed(); };

  $("#views").addEventListener("click", (e) => {
    const b = e.target.closest(".view-btn");
    if (b) setView(b.dataset.view);
  });

  // 카드·캘린더 일정 등 data-seq 가 있는 요소 → 상세 모달
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-seq]");
    if (el && !e.target.closest("#modal")) openModal(el.dataset.seq);
  });
  $("#modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget || e.target.closest("#mClose, #mClose2")) closeModal();
  });

  let t;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value; refreshFeed(); }, 150);
  });
  $("#sortSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { state.sort = b.dataset.sort; refreshFeed(); }
  });
  $("#catChecks").addEventListener("change", (e) => {
    if (e.target.checked) state.cats.add(e.target.value); else state.cats.delete(e.target.value);
    refreshFeed();
  });
  $("#dueRadios").addEventListener("change", (e) => { state.due = e.target.value; refreshFeed(); });
  $("#onlyNew").addEventListener("change", (e) => { state.onlyNew = e.target.checked; refreshFeed(); });
  $("#hasFiles").addEventListener("change", (e) => { state.hasFiles = e.target.checked; refreshFeed(); });
  $("#resetFilters").addEventListener("click", () => {
    Object.assign(state, { q: "", cats: new Set(), due: "all", onlyNew: false, hasFiles: false });
    $("#q").value = "";
    refreshFeed();
  });
  $("#activeFilters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (b) { removeFilter(b.dataset.remove); refreshFeed(); }
  });
  $("#more").addEventListener("click", () => { state.shown += PAGE_SIZE; renderGrid(); });

  $("#newsTags").addEventListener("click", (e) => {
    const b = e.target.closest(".fchip");
    if (b) { state.newsTag = b.dataset.tag; renderNews(); }
  });
  $("#newsQ").addEventListener("input", (e) => { state.newsQ = e.target.value; renderNews(); });

  const shiftMonth = (n) => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + n, 1); renderCalendar(); };
  $("#calPrev").addEventListener("click", () => shiftMonth(-1));
  $("#calNext").addEventListener("click", () => shiftMonth(1));
  $("#calToday").addEventListener("click", () => { state.calMonth = null; renderCalendar(); });
  window.addEventListener("hashchange", () => applyHash(false));

  function applyHash(push) {
    const h = location.hash.slice(1);
    // 예전 주소(#volunteer 등)는 해당 카테고리 필터가 걸린 피드로 연다
    if (state.data.categories.some((c) => c.key === h && c.key !== "tuition")) {
      state.cats = new Set([h]);
      setView("feed", push);
    } else {
      setView(h, push);
    }
  }

  // ================================================================ 시작
  const bust = `?v=${Date.now()}`;
  const getJSON = (p) => fetch(`data/${p}${bust}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  getJSON("weather.json").then(renderWeather)
    .catch(() => { $("#weather").innerHTML = `<div class="weather-loading">날씨 정보를 불러오지 못했어요.</div>`; });

  Promise.all([getJSON("notices.json"), getJSON("news.json").catch(() => null)])
    .then(([data, news]) => {
      state.data = data;
      state.news = news;
      data.notices.forEach((n) => bySeq.set(n.seq, n));
      const up = new Date(data.updated_at);
      const fmt = (d) => d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      $("#updated").textContent = `${up.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} 업데이트 · 공지 ${data.notices.length}건`;
      $("#schedule").textContent = `30분마다 자동 업데이트 (매시 ${UPDATE_MINUTES.map((m) => `${m}분`).join("·")}) · 다음 업데이트 ${fmt(nextUpdate())}쯤`;
      applyHash(false);
    })
    .catch(() => {
      $("#updated").textContent = "데이터를 불러오지 못했어요";
      $("#grid").innerHTML = `<div class="empty"><b>데이터를 불러오지 못했어요.</b>잠시 후 다시 시도해 주세요.</div>`;
    });
})();
