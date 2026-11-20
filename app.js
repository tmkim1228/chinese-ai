(() => {
  "use strict";
  const $ = (s, root) => (root || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const STORAGE_KEY = (window.NameSrs && window.NameSrs.HISTORY_KEY) || "chinese-ai-en.history.v1";
  const DISMISS_KEY = "chinese-ai-en.backupDismiss.v1";
  const EXPORT_KEY = "chinese-ai-en.lastExport.v1";

  let history = [];
  let flash = { i: 0, deck: [], revealed: false, mode: "py2han", todayOnly: false };
  let quiz = { mode: "mcq", i: 0, deck: [], results: [], current: null };
  let chartRange = 14;

  const els = {
    viewAsk: $("#view-ask"),
    viewDict: $("#view-dict"),
    viewReview: $("#view-review"),
    viewSettings: $("#view-settings"),
    histCount: $("#hist-count"),
    reviewList: $("#review-list"),
    reviewEmpty: $("#review-empty"),
    reviewSearch: $("#review-search"),
    flashModal: $("#flash-modal"),
    flashFront: $("#flash-front"),
    flashBack: $("#flash-back"),
    flashCard: $("#flash-card"),
    flashProgress: $("#flash-progress"),
    credits: $("#credits"),
  };

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      history = Array.isArray(list) ? list : [];
    } catch {
      history = [];
    }
    if (window.NameSrs) {
      const m = window.NameSrs.migrateHistory(history);
      history = m.items;
      if (m.changed) saveHistory();
    }
    return history;
  }
  function saveHistory() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch (_) {}
    updateCount();
  }
  function setHistory(items) {
    history = Array.isArray(items) ? items : [];
    return history;
  }

  function itemId(simp, py) {
    return "word|" + String(simp || "") + "|" + String(py || "").trim();
  }
  function findSaved(simp, py) {
    const id = itemId(simp, py);
    return history.find((x) => x.id === id) || history.find((x) => x.simp === simp && String(x.py || "") === String(py || "").trim()) || null;
  }
  function isSaved(simp, py) { return !!findSaved(simp, py); }

  function addReview(opts) {
    const simp = String((opts && opts.simp) || "").trim();
    if (!simp) return { ok: false };
    const py = String((opts && opts.py) || "").trim();
    const meaningEn = String((opts && opts.meaningEn) || (opts && opts.meaning) || "").trim();
    const example = (window.NameSrs && window.NameSrs.excerpt)
      ? window.NameSrs.excerpt(opts.example || "", simp, 80)
      : String(opts.example || "").slice(0, 80);
    let item = findSaved(simp, py);
    let added = false;
    if (!item) {
      item = {
        id: itemId(simp, py),
        date: new Date().toISOString(),
        simp,
        trad: (opts && opts.trad) || "",
        py,
        ko: "",
        hun: "",
        chars: [],
        known: false,
        kind: "word",
        defs: meaningEn ? [meaningEn] : [],
        meaningEn,
        meaningKo: "",
        examples: [],
      };
      if (window.NameSrs) window.NameSrs.migrateItem(item);
      history.unshift(item);
      added = true;
    } else if (meaningEn && !item.meaningEn) {
      item.meaningEn = meaningEn;
      item.defs = item.defs && item.defs.length ? item.defs : [meaningEn];
    }
    if (example && window.NameSrs) window.NameSrs.mergeExample(item, example);
    else if (example) {
      item.examples = item.examples || [];
      if (!item.examples.includes(example)) item.examples.push(example);
    }
    saveHistory();
    if (!els.viewReview.hidden) {
      renderReviewList();
      renderSrsPanel();
    } else {
      updateCount();
    }
    return { ok: true, added, item };
  }

  function updateCount() {
    if (els.histCount) els.histCount.textContent = String(history.length);
    const due = window.NameSrs ? window.NameSrs.dueItems(history).length : history.length;
    const dueEl = $("#review-due-count");
    if (dueEl) dueEl.textContent = String(due);
  }

  function speak(s) {
    try {
      if (!s || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(s);
      u.lang = "zh-CN";
      window.speechSynthesis.speak(u);
    } catch (err) { console.warn(err); }
  }

  function showTab(name) {
    const tabs = { ask: els.viewAsk, dict: els.viewDict, review: els.viewReview, settings: els.viewSettings };
    for (const [k, el] of Object.entries(tabs)) {
      if (el) el.hidden = k !== name;
    }
    document.querySelectorAll(".tab").forEach((btn) => {
      const on = btn.dataset.tab === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (name === "review") { renderReviewList(); renderSrsPanel(); updateBackupBanner(); }
    if (name === "dict") {
      if (window.dictionaryApp && window.dictionaryApp.ensureWords) {
        window.dictionaryApp.ensureWords().catch(() => {});
      }
    }
    if (name === "settings" && window.askApp) {
      /* form already filled on load */
    }
  }

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  function boxLabel(h) {
    const S = window.NameSrs;
    const box = Number(h && h.box) || 1;
    const days = S ? S.intervalFor(box) : [0, 1, 3, 7, 14, 30, 60][box];
    return `Box ${box} (${days} day${days === 1 ? "" : "s"})`;
  }

  function meaningOf(h) {
    return h.meaningEn || ((h.defs && h.defs[0]) || "") || h.hun || "";
  }

  function renderReviewList() {
    const q = ((els.reviewSearch && els.reviewSearch.value) || "").trim().toLowerCase();
    const list = history.filter((h) => {
      if (!q) return true;
      const blob = [h.simp, h.trad, h.py, h.meaningEn, (h.defs || []).join(" "), (h.examples || []).join(" ")].join(" ").toLowerCase();
      return blob.includes(q);
    });
    if (els.reviewEmpty) els.reviewEmpty.hidden = history.length > 0;
    if (!els.reviewList) return;
    els.reviewList.innerHTML = list.map((h) => {
      const due = h.due || "";
      const dueCls = window.NameSrs && window.NameSrs.isDue(h) ? "due-now" : (due ? "due-soon" : "");
      return `<article class="hist-card" data-id="${esc(h.id)}">
        <div>
          <div class="hist-simp" lang="zh-CN">${esc(h.simp)}${h.trad && h.trad !== h.simp ? " / " + esc(h.trad) : ""}</div>
          <div class="hist-meta">${esc(h.py || "")} · ${esc((h.date || "").slice(0, 10))}</div>
          <div class="hist-ko">${esc(meaningOf(h))}</div>
          <div class="hist-srs"><span class="${dueCls}">${due ? "Due " + esc(due) : ""}</span> · ${esc(boxLabel(h))}</div>
          ${h.examples && h.examples[0] ? `<div class="flash-example">${esc(h.examples[0])}</div>` : ""}
        </div>
        <div class="hist-actions">
          <button type="button" class="ghost" data-speak="${esc(h.simp)}">Play</button>
          <button type="button" class="danger" data-del="${esc(h.id)}">Delete</button>
        </div>
      </article>`;
    }).join("");
    updateCount();
  }

  els.reviewSearch?.addEventListener("input", renderReviewList);
  els.reviewList?.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      history = history.filter((h) => h.id !== del.dataset.del);
      saveHistory();
      renderReviewList();
      renderSrsPanel();
      return;
    }
    const sp = e.target.closest("[data-speak]");
    if (sp) speak(sp.dataset.speak);
  });

  function barChart(series, goal) {
    const w = 640, h = 160, padL = 8, padR = 40, padT = 16, padB = 28;
    const max = Math.max(goal || 0, ...series.map((s) => s.count), 1);
    const plotH = h - padT - padB;
    const plotW = w - padL - padR;
    const bw = plotW / Math.max(series.length, 1);
    const bars = series.map((s, i) => {
      const bh = s.count ? Math.max(2, Math.round((s.count / max) * plotH)) : 0;
      const x = padL + i * bw + 2;
      const y = padT + plotH - bh;
      const track = `<rect x="${x}" y="${padT}" width="${Math.max(1, bw - 4)}" height="${plotH}" fill="#eef2f7" rx="3"></rect>`;
      const color = s.count >= goal ? "#1b7a4a" : "#3d6ea8";
      const bar = bh ? `<rect x="${x}" y="${y}" width="${Math.max(1, bw - 4)}" height="${bh}" fill="${color}" rx="3"></rect>` : "";
      return track + bar;
    }).join("");
    const goalY = padT + plotH - Math.round((goal / max) * plotH);
    const dash = `<line x1="${padL}" y1="${goalY}" x2="${w - padR}" y2="${goalY}" stroke="#c0392b" stroke-dasharray="4 4" stroke-width="1.5"></line>`;
    const goalLbl = `<text x="${w - 4}" y="${goalY + 4}" font-size="11" fill="#c0392b" text-anchor="end">goal</text>`;
    const axis = `<line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="#d5deea" stroke-width="1"></line>`;
    const first = series[0] && series[0].date ? String(series[0].date).slice(5) : "";
    const last = series.length && series[series.length - 1].date ? String(series[series.length - 1].date).slice(5) : "";
    const labels = `<text x="${padL}" y="${h - 8}" font-size="11" fill="#5b6b80">${first}</text><text x="${w - padR}" y="${h - 8}" font-size="11" fill="#5b6b80" text-anchor="end">${last}</text>`;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Reviews completed per day. Dashed line is the daily goal.">${axis}${bars}${dash}${goalLbl}${labels}</svg>`;
  }

  function renderSrsPanel() {
    const S = window.NameSrs;
    if (!S) return;
    const stats = S.loadStats();
    const st = S.streak(stats);
    const tot = S.totals(history);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    set("srs-streak", st);
    set("srs-saved", tot.saved);
    set("srs-learned", tot.learned);
    set("srs-mastered", tot.mastered);
    const goalInp = $("#srs-goal");
    if (goalInp && document.activeElement !== goalInp) goalInp.value = String(stats.goal || 20);
    const series = S.chartSeries(stats, chartRange);
    const chart = $("#srs-chart");
    if (chart) chart.innerHTML = barChart(series, stats.goal || 20);
    const grid = $("#srs-grid");
    if (grid) {
      grid.innerHTML = history.slice(0, 200).map((h) => {
        const lv = S.levelOf(h);
        const mark = S.LEVEL_MARK[lv] || "";
        return `<button type="button" class="srs-cell lv-${lv}" data-srs-id="${esc(h.id)}" title="${esc(h.simp)} ${esc(h.py || "")}">
          <span class="srs-cell-han" lang="zh-CN">${esc(h.simp[0] || h.simp)}</span>
          <span class="srs-cell-mark">${esc(mark)}</span>
        </button>`;
      }).join("");
    }
    updateCount();
  }

  $("#srs-goal")?.addEventListener("change", () => {
    const S = window.NameSrs;
    if (!S) return;
    const stats = S.loadStats();
    stats.goal = Math.max(1, Number($("#srs-goal").value) || 20);
    S.saveStats(stats);
    renderSrsPanel();
  });
  document.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chartRange = Number(btn.dataset.range) || 14;
      document.querySelectorAll("[data-range]").forEach((b) => b.classList.toggle("active", b === btn));
      renderSrsPanel();
    });
  });
  $("#srs-grid")?.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-srs-id]");
    if (!cell) return;
    const h = history.find((x) => x.id === cell.dataset.srsId);
    if (!h) return;
    const body = $("#srs-detail-body");
    const modal = $("#srs-detail-modal");
    if (body) body.innerHTML = `<div class="big" lang="zh-CN">${esc(h.simp)}</div><p>${esc(h.py || "")}</p><p>${esc(meaningOf(h))}</p><p class="dict-small">${esc(boxLabel(h))}${h.due ? " · due " + esc(h.due) : ""}</p>${(h.examples || []).map((x) => `<p class="flash-example">${esc(x)}</p>`).join("")}`;
    if (modal) modal.hidden = false;
  });
  $("#srs-detail-close")?.addEventListener("click", () => { const m = $("#srs-detail-modal"); if (m) m.hidden = true; });
  $("#srs-detail-modal")?.addEventListener("click", (e) => { if (e.target.id === "srs-detail-modal") e.target.hidden = true; });

  function shouldShowBackupBanner() {
    if (!history.length) return false;
    const dismissed = Date.parse(localStorage.getItem(DISMISS_KEY) || "") || 0;
    const exported = Date.parse(localStorage.getItem(EXPORT_KEY) || "") || 0;
    const latest = history.reduce((n, h) => Math.max(n, Date.parse(h.date || 0) || 0), 0);
    const last = Math.max(dismissed, exported);
    return !last || (latest && latest > last + 86400000);
  }
  function updateBackupBanner() {
    const b = $("#backup-banner");
    if (b) b.hidden = !shouldShowBackupBanner();
  }
  function recordExport() {
    try { localStorage.setItem(EXPORT_KEY, new Date().toISOString()); } catch {}
    updateBackupBanner();
  }

  async function exportHistory() {
    const S = window.NameSrs;
    const data = S ? S.buildExport(history, S.loadStats()) : { version: 2, items: history };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chinese-ai-en-review.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    recordExport();
  }

  function importHistory(obj) {
    const S = window.NameSrs;
    const parsed = S ? S.parseImport(obj) : (Array.isArray(obj) ? { items: obj } : obj);
    const incoming = parsed.items || [];
    const have = new Set(history.map((h) => h.id));
    let added = 0;
    for (const it of incoming) {
      if (!it || !it.id) continue;
      if (S) S.migrateItem(it);
      if (have.has(it.id)) {
        const cur = history.find((h) => h.id === it.id);
        if (cur && S && it.examples) it.examples.forEach((ex) => S.mergeExample(cur, ex));
        continue;
      }
      history.push(it);
      have.add(it.id);
      added += 1;
    }
    if (S && parsed.stats) S.saveStats(S.mergeStats(S.loadStats(), parsed.stats));
    saveHistory();
    renderReviewList();
    renderSrsPanel();
    return { added };
  }

  $("#btn-export")?.addEventListener("click", () => exportHistory());
  $("#backup-export")?.addEventListener("click", () => exportHistory());
  $("#backup-dismiss")?.addEventListener("click", () => {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch {}
    updateBackupBanner();
  });
  $("#btn-import")?.addEventListener("click", () => $("#import-file") && $("#import-file").click());
  $("#import-file")?.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const res = importHistory(JSON.parse(text));
      alert(`Imported ${res.added} new item(s).`);
    } catch {
      alert("Could not import that file.");
    }
  });

  function exampleLine(h) {
    if (h && h.examples && h.examples[0]) return `<div class="flash-example">Example · ${esc(h.examples[0])}</div>`;
    return "";
  }
  function renderFlash() {
    const actions = document.querySelector("#flash-modal .flash-actions");
    const speakBtn = document.getElementById("flash-speak");
    const tap = document.querySelector("#flash-modal .flash-tap");
    if (!flash.deck.length) {
      els.flashFront.innerHTML = "Done. You have reviewed every card.";
      els.flashBack.hidden = true;
      els.flashProgress.textContent = "";
      if (tap) tap.hidden = true;
      if (actions) actions.hidden = true;
      if (speakBtn) speakBtn.hidden = true;
      return;
    }
    if (actions) actions.hidden = false;
    if (speakBtn) speakBtn.hidden = false;
    if (flash.i >= flash.deck.length) flash.i = flash.deck.length - 1;
    const h = flash.deck[flash.i];
    els.flashProgress.textContent = `${flash.i + 1} / ${flash.deck.length}` + (h.box ? " · " + boxLabel(h) : "");
    els.flashBack.hidden = !flash.revealed;
    if (tap) tap.hidden = flash.revealed;
    const meaning = `<div>${esc(meaningOf(h))}</div>`;
    const ex = exampleLine(h);
    if (flash.mode === "han2py") {
      els.flashFront.innerHTML = `<span class="big" lang="zh-CN">${esc(h.simp)}</span>`;
      els.flashBack.innerHTML = `<div>${esc(h.py)}</div>${meaning}${ex}`;
    } else if (flash.mode === "han2en") {
      els.flashFront.innerHTML = `<span class="big" lang="zh-CN">${esc(h.simp)}</span>`;
      els.flashBack.innerHTML = `${meaning}<div>${esc(h.py)}</div>${ex}`;
    } else {
      els.flashFront.innerHTML = `<div>${esc(h.py)}</div>`;
      els.flashBack.innerHTML = `<span class="big" lang="zh-CN">${esc(h.simp)}</span>${meaning}${ex}`;
    }
  }
  function openFlash(todayOnly) {
    const S = window.NameSrs;
    flash.todayOnly = !!todayOnly;
    flash.deck = todayOnly && S ? S.dueItems(history).slice() : history.slice();
    flash.i = 0;
    flash.revealed = false;
    const title = document.querySelector("#flash-modal h2");
    if (title) title.textContent = todayOnly ? "Review today" : "All cards";
    els.flashModal.hidden = false;
    renderFlash();
  }
  $("#btn-flash")?.addEventListener("click", () => openFlash(false));
  $("#btn-review-today")?.addEventListener("click", () => openFlash(true));
  $("#flash-close")?.addEventListener("click", () => { els.flashModal.hidden = true; renderReviewList(); renderSrsPanel(); });
  els.flashCard?.addEventListener("click", () => {
    if (!flash.deck.length) return;
    flash.revealed = !flash.revealed;
    renderFlash();
  });
  document.querySelectorAll("#flash-modal .flash-mode .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#flash-modal .flash-mode .chip").forEach((b) => b.classList.toggle("active", b === btn));
      flash.mode = btn.dataset.mode;
      flash.revealed = false;
      renderFlash();
    });
  });
  $("#flash-speak")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const h = flash.deck[flash.i];
    if (h) speak(h.simp);
  });
  function gradeFlash(result) {
    const S = window.NameSrs;
    const h = flash.deck[flash.i];
    if (!h) return;
    const item = history.find((x) => x.id === h.id) || h;
    if (S) {
      if (result === "known") S.applyKnown(item);
      else if (result === "unsure") S.applyUnsure(item);
      else S.applyUnknown(item);
      S.recordReview(S.loadStats());
    } else item.known = result === "known";
    saveHistory();
    flash.deck.splice(flash.i, 1);
    flash.revealed = false;
    renderFlash();
    renderSrsPanel();
  }
  $("#flash-known")?.addEventListener("click", (e) => { e.stopPropagation(); gradeFlash("known"); });
  $("#flash-unsure")?.addEventListener("click", (e) => { e.stopPropagation(); gradeFlash("unsure"); });
  $("#flash-unknown")?.addEventListener("click", (e) => { e.stopPropagation(); gradeFlash("unknown"); });

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function quizDistractors(item, n) {
    const ans = meaningOf(item);
    const pool = history.filter((h) => h.id !== item.id && meaningOf(h) && meaningOf(h) !== ans);
    return shuffle(pool).slice(0, n).map(meaningOf);
  }
  function quizSource(todayOnly) {
    const S = window.NameSrs;
    const src = todayOnly && S ? S.dueItems(history) : history;
    return src.filter((h) => h.simp);
  }
  function openQuiz(opts) {
    const todayOnly = !!(opts && opts.todayOnly);
    const retryItems = opts && opts.retryItems;
    const source = retryItems || quizSource(todayOnly);
    quiz.mode = (opts && opts.mode) || quiz.mode || "mcq";
    quiz.deck = shuffle(source);
    quiz.i = 0;
    quiz.results = [];
    quiz.current = null;
    document.querySelectorAll("#quiz-modal .quiz-mode .chip").forEach((b) => b.classList.toggle("active", b.dataset.qmode === quiz.mode));
    $("#quiz-modal").hidden = false;
    $("#quiz-body").hidden = false;
    $("#quiz-summary").hidden = true;
    renderQuiz();
  }
  function buildQuizQuestion(h) {
    if (quiz.mode === "pinyin") return { item: h, kind: "pinyin", answer: h.py || "" };
    const answer = meaningOf(h) || h.py || h.simp;
    const choices = shuffle([answer, ...quizDistractors(h, 3).filter(Boolean)]).slice(0, 4);
    if (!choices.includes(answer)) choices[0] = answer;
    return { item: h, kind: "mcq", answer, choices: shuffle(choices) };
  }
  function renderQuiz() {
    const body = $("#quiz-body");
    const summary = $("#quiz-summary");
    if (quiz.i >= quiz.deck.length) {
      body.hidden = true;
      summary.hidden = false;
      const ok = quiz.results.filter((r) => r.ok).length;
      const partial = quiz.results.filter((r) => !r.ok && r.partial).length;
      const bad = quiz.results.length - ok - partial;
      $("#quiz-score").textContent = `Correct ${ok} · tone only ${partial} · wrong ${bad} (of ${quiz.results.length})`;
      const retry = $("#quiz-retry-wrong");
      const wrong = quiz.results.filter((r) => !r.ok).map((r) => r.item);
      if (retry) retry.hidden = wrong.length === 0;
      retry && (retry.onclick = () => openQuiz({ retryItems: wrong, mode: quiz.mode }));
      return;
    }
    const h = quiz.deck[quiz.i];
    quiz.current = buildQuizQuestion(h);
    $("#quiz-progress").textContent = `${quiz.i + 1} / ${quiz.deck.length}`;
    $("#quiz-prompt").innerHTML = `<span class="big" lang="zh-CN">${esc(h.simp)}</span>`;
    const feedback = $("#quiz-feedback");
    feedback.hidden = true;
    feedback.textContent = "";
    const ex = $("#quiz-example");
    if (ex) { ex.hidden = true; ex.textContent = ""; }
    $("#quiz-next").hidden = true;
    const form = $("#quiz-pinyin-form");
    const choicesEl = $("#quiz-choices");
    if (quiz.mode === "pinyin") {
      form.hidden = false;
      choicesEl.hidden = true;
      const inp = $("#quiz-pinyin-input");
      inp.value = "";
      inp.disabled = false;
      $("#quiz-pinyin-submit").disabled = false;
      setTimeout(() => inp.focus(), 50);
    } else {
      form.hidden = true;
      choicesEl.hidden = false;
      choicesEl.innerHTML = (quiz.current.choices || []).map((c, idx) =>
        `<button type="button" class="quiz-choice" data-idx="${idx}">${esc(c)}</button>`
      ).join("");
    }
  }
  function applyQuizResult(ok, partial) {
    const S = window.NameSrs;
    const h = quiz.current.item;
    const item = history.find((x) => x.id === h.id) || h;
    if (S) {
      if (ok) S.applyKnown(item);
      else if (partial) S.applyUnsure(item);
      else S.applyUnknown(item);
      S.recordReview(S.loadStats());
    }
    saveHistory();
    quiz.results.push({ item, ok, partial: !!partial });
    const ex = $("#quiz-example");
    if (item.examples && item.examples.length) {
      ex.hidden = false;
      ex.textContent = "Example · " + item.examples[0];
    }
    $("#quiz-next").hidden = false;
    renderSrsPanel();
  }
  function gradeQuizChoice(idx) {
    if (!quiz.current || quiz.current.locked) return;
    quiz.current.locked = true;
    const answer = quiz.current.answer;
    document.querySelectorAll("#quiz-choices .quiz-choice").forEach((b) => {
      const val = quiz.current.choices[Number(b.dataset.idx)];
      if (val === answer) b.classList.add("is-correct");
      if (Number(b.dataset.idx) === idx && val !== answer) b.classList.add("is-wrong");
      b.disabled = true;
    });
    const ok = quiz.current.choices[idx] === answer;
    const fb = $("#quiz-feedback");
    fb.hidden = false;
    fb.className = "quiz-feedback " + (ok ? "is-ok" : "is-bad");
    fb.textContent = ok ? "Correct." : "The answer is: " + answer;
    applyQuizResult(ok, false);
  }
  $("#quiz-choices")?.addEventListener("click", (e) => {
    const b = e.target.closest(".quiz-choice");
    if (b) gradeQuizChoice(Number(b.dataset.idx));
  });
  $("#quiz-pinyin-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!quiz.current || quiz.current.locked) return;
    const S = window.NameSrs;
    const got = $("#quiz-pinyin-input").value;
    const expected = quiz.current.answer;
    const grade = S ? S.gradePinyin(got, expected) : { ok: got.trim() === expected, partial: false, message: "" };
    quiz.current.locked = true;
    $("#quiz-pinyin-input").disabled = true;
    $("#quiz-pinyin-submit").disabled = true;
    const fb = $("#quiz-feedback");
    fb.hidden = false;
    fb.className = "quiz-feedback " + (grade.ok ? "is-ok" : grade.partial ? "is-partial" : "is-bad");
    fb.textContent = grade.message + (!grade.ok ? " Answer: " + expected : "");
    applyQuizResult(grade.ok, grade.partial);
  });
  $("#quiz-next")?.addEventListener("click", () => { quiz.i += 1; renderQuiz(); });
  $("#btn-quiz")?.addEventListener("click", () => openQuiz({ todayOnly: true }));
  document.querySelectorAll("#quiz-modal .quiz-mode .chip").forEach((btn) => {
    btn.addEventListener("click", () => openQuiz({ mode: btn.dataset.qmode, todayOnly: true }));
  });
  $("#quiz-close")?.addEventListener("click", () => { $("#quiz-modal").hidden = true; renderReviewList(); renderSrsPanel(); });
  $("#quiz-close-done")?.addEventListener("click", () => { $("#quiz-modal").hidden = true; renderReviewList(); renderSrsPanel(); });

  // PWA install
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = $("#btn-install");
    if (btn) btn.hidden = false;
  });
  $("#btn-install")?.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
    } else {
      alert("In the browser menu, choose Install app or Add to Home screen.");
    }
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch((err) => console.warn(err));
  }

  function renderCredits() {
    const el = els.credits;
    if (!el) return;
    const fill = (meta) => {
      const sources = (meta && meta.sources) || [];
      el.innerHTML = `<ul>${sources.map((s) => `<li><strong>${esc(s.name)}</strong> — ${esc(s.license)}${s.url ? `<br/><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ""}${s.note ? "<br/>" + esc(s.note) : ""}</li>`).join("")}</ul>
        <p>This English edition does not include HANZI DAILY card stories. Character readings and traditional forms are from Unicode Unihan. English glosses are from CC-CEDICT (CC BY-SA 4.0, MDBG). An optional Korean reading (off by default) uses Unihan kHangul for 음 (Unicode Terms of Use) and the Korean edition's 훈음 data (libhangul hanja.txt, BSD-3-Clause) for 훈.</p>`;
    };
    if (window.__META__) fill(window.__META__);
    else fetch("data/meta.json").then((r) => r.json()).then(fill).catch(() => fill(null));
  }

  loadHistory();
  updateCount();
  renderCredits();

  window.nameAppBridge = {
    STORAGE_KEY,
    addReview,
    isSaved,
    setHistory,
    saveHistory,
    getHistory: () => history,
    showTab,
    speak,
    renderReviewList,
    renderSrsPanel,
    openFlash,
    openQuiz,
    exportHistory,
    importHistory,
  };
})();
