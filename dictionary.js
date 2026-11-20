(() => {
  "use strict";
  const $ = (s, root) => (root || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  let CHARS = null; // dict by hanzi
  let allChars = [];
  let WORDS = null;
  let wordIndex = new Map();
  let maxLen = 8;
  let loadPromise = null;
  let wordsPromise = null;
  let detailGen = 0;

  const TONE_MARK = {
    ā: "a", á: "a", ǎ: "a", à: "a", ē: "e", é: "e", ě: "e", è: "e",
    ī: "i", í: "i", ǐ: "i", ì: "i", ō: "o", ó: "o", ǒ: "o", ò: "o",
    ū: "u", ú: "u", ǔ: "u", ù: "u", ǖ: "ü", ǘ: "ü", ǚ: "ü", ǜ: "ü",
  };
  function barePy(s) {
    let out = "";
    for (const c of String(s || "").normalize("NFC").toLowerCase()) {
      if (TONE_MARK[c]) out += TONE_MARK[c];
      else if (c === "v") out += "ü";
      else if (/[a-zü0-9]/.test(c)) out += c;
    }
    return out;
  }
  function isHan(ch) {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xF900 && cp <= 0xFAFF)
      || (cp >= 0x20000 && cp <= 0x2FA1F);
  }

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }
  async function fetchGz(url) {
    if (typeof DecompressionStream !== "function") throw new Error("no DecompressionStream");
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(url + " " + r.status);
    const stream = r.body.pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }

  async function ensureChars() {
    if (CHARS) return CHARS;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (window.__DICT__) CHARS = window.__DICT__;
      else CHARS = await fetchJson("data/dictionary.json");
      allChars = Object.values(CHARS);
      return CHARS;
    })().catch((err) => { loadPromise = null; throw err; });
    return loadPromise;
  }

  function buildWordIndex(data) {
    WORDS = data;
    maxLen = data.maxLen || 8;
    wordIndex = new Map();
    for (const row of data.e || []) {
      const rec = { s: row[0], t: row[1], p: row[2], d: row[3] || [] };
      const add = (key) => {
        if (!key) return;
        const arr = wordIndex.get(key);
        if (arr) arr.push(rec);
        else wordIndex.set(key, [rec]);
      };
      add(rec.s);
      if (rec.t && rec.t !== rec.s) add(rec.t);
    }
  }

  async function ensureWords() {
    if (WORDS) return WORDS;
    if (wordsPromise) return wordsPromise;
    const status = $("#dict-status");
    if (status) {
      status.hidden = false;
      status.textContent = "Loading the word list (CC-CEDICT)… This is downloaded once, then works offline.";
    }
    wordsPromise = (async () => {
      if (window.__WORDS__) return window.__WORDS__;
      try { return await fetchGz("data/words.json.gz"); }
      catch (err) { console.warn("words.json.gz", err); }
      return fetchJson("data/words.json");
    })().then((data) => {
      buildWordIndex(data);
      if (status) status.hidden = true;
      return WORDS;
    }).catch((err) => {
      wordsPromise = null;
      if (status) {
        status.hidden = false;
        status.textContent = "Could not load the word list. Check your network and try again.";
      }
      throw err;
    });
    return wordsPromise;
  }

  function charRecord(ch) {
    if (!CHARS) return null;
    if (CHARS[ch]) return CHARS[ch];
    return allChars.find((r) => r.c === ch || r.t === ch) || null;
  }

  function bestEntries(q) {
    const list = wordIndex.get(q) || [];
    if (!list.length) return [];
    const scored = list.map((rec) => {
      let n = 0;
      if (rec.s === q) n += 5;
      if (rec.t === q) n += 3;
      if (q === rec.t && rec.s !== rec.t) n += 20;
      n += Math.min((rec.d || []).join("").length, 80) / 80;
      return { rec, n };
    });
    scored.sort((a, b) => b.n - a.n);
    return scored.map((x) => x.rec);
  }

  function uniquePy(list) {
    const out = [];
    const seen = new Set();
    for (const p of list || []) {
      const s = String(p || "").trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  function englishFor(ch) {
    const entries = bestEntries(ch);
    const defs = [];
    for (const rec of entries) {
      for (const d of rec.d || []) {
        if (d && !defs.includes(d)) defs.push(d);
        if (defs.length >= 8) return defs;
      }
    }
    return defs;
  }

  function lookupChar(ch) {
    const r = charRecord(ch);
    const entries = bestEntries(ch);
    const top = entries[0] || null;
    const rawP = (r && r.p && r.p.length) ? r.p.slice() : (top && top.p ? [top.p] : []);
    return {
      c: (r && r.c) || (top && top.s) || ch,
      t: (r && r.t) || (top && top.t) || "",
      p: uniquePy(rawP),
      defs: englishFor(ch),
      entries,
      rec: r,
    };
  }

  function search(q) {
    const query = String(q || "").trim();
    if (!query) return [];
    const out = [];
    const seen = new Set();
    const push = (kind, title, rec) => {
      const id = kind + "|" + title + "|" + (rec && rec.p) + "|" + ((rec && rec.d && rec.d[0]) || "");
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ kind, title, rec });
    };

    if ([...query].every(isHan) && query.length <= 8) {
      if (query.length === 1) {
        const info = lookupChar(query);
        push("char", info.c, { s: info.c, t: info.t, p: (info.p || []).join(" · "), d: info.defs });
      }
      for (const rec of bestEntries(query)) push("word", rec.s, rec);
    }

    const bare = barePy(query);
    const isPy = /^[a-züv0-9\s']+$/i.test(query) && bare.length >= 1;
    const isEn = /[a-z]/i.test(query) && !isPy && ![...query].some(isHan);

    if (WORDS && (isPy || isEn)) {
      const qEn = query.toLowerCase();
      const limit = 80;
      for (const row of WORDS.e || []) {
        if (out.length >= limit) break;
        const rec = { s: row[0], t: row[1], p: row[2], d: row[3] || [] };
        if (isPy && rec.p) {
          const b = barePy(rec.p);
          if (b === bare || (bare.length >= 2 && b.startsWith(bare))) push("word", rec.s, rec);
        }
        if (isEn) {
          const hit = (rec.d || []).some((d) => String(d).toLowerCase().includes(qEn));
          if (hit) push("word", rec.s, rec);
        }
      }
    }

    if (CHARS && isPy && bare.length >= 2) {
      for (const r of allChars) {
        if (out.length >= 80) break;
        if ((r.p || []).some((p) => barePy(p) === bare || (bare.length >= 3 && barePy(p).startsWith(bare)))) {
          push("char", r.c, { s: r.c, t: r.t, p: (r.p || []).join(" · "), d: englishFor(r.c) });
        }
      }
    }
    return out.slice(0, 80);
  }

  function cardHtml(item) {
    const rec = item.rec || {};
    const han = rec.s || item.title;
    const trad = rec.t && rec.t !== han ? rec.t : "";
    const py = rec.p || "";
    const meaning = (rec.d || []).slice(0, 2).join(" · ");
    return `<article class="dict-result" data-detail="${esc(han)}">
      <div class="dict-glyph-row">
        <span class="dict-glyph" lang="zh-CN">${esc(han)}</span>
        ${trad ? `<span class="dict-trad"><span class="dict-trad-label">Trad.</span><b class="dict-trad-glyph">${esc(trad)}</b></span>` : ""}
      </div>
      <p class="dict-py">${esc(py)}</p>
      <p>${esc(meaning || "No English gloss in CC-CEDICT")}</p>
    </article>`;
  }

  function showDetail(ch) {
    const overlay = $("#dict-overlay");
    if (!overlay) return;
    const gen = ++detailGen;
    const run = async () => {
      try {
        await Promise.all([ensureChars(), ensureWords().catch(() => null)]);
      } catch (err) { console.warn(err); }
      if (gen !== detailGen) return;
      const info = lookupChar(ch);
      const tradChar = info.t || info.c;
      const tradHtml = `<span class="dict-trad"><span class="dict-trad-label">Trad.</span><b class="dict-trad-glyph" lang="zh-TW">${esc(tradChar)}</b></span>`;
      const meaning = (info.defs && info.defs.length)
        ? info.defs.map((d) => `<p>${esc(d)}</p>`).join("")
        : `<p class="dict-small">No English gloss in CC-CEDICT for this character.</p>`;
      const py = (info.p || []).join(" · ") || "No pinyin";
      const saved = window.nameAppBridge && window.nameAppBridge.isSaved && window.nameAppBridge.isSaved(info.c, (info.p || [])[0] || "");
      $("#detail-body").innerHTML = `
        <div class="dict-glyph-row">
          <span class="dict-glyph" lang="zh-CN">${esc(info.c)}</span>
          ${tradHtml}
        </div>
        <p class="dict-py">${esc(py)}</p>
        <section class="doc-panel-defs">
          <h3>English · CC-CEDICT</h3>
          ${meaning}
          <p class="dict-small">English meanings are from CC-CEDICT (CC BY-SA 4.0, MDBG). Readings and traditional forms come from Unicode Unihan.</p>
        </section>
        <div class="dict-tools">
          <button type="button" class="primary" data-savechar ${saved ? "" : ""}>${saved ? "Saved" : "Add to review"}</button>
          <button type="button" class="ghost" data-audio="${esc(info.c)}">Play audio</button>
        </div>
        <p id="detail-note">${saved ? "Already in your review list." : ""}</p>`;
      overlay.hidden = false;
      overlay.dataset.han = info.c;
      overlay.dataset.py = (info.p || [])[0] || "";
      overlay.dataset.meaning = (info.defs || []).join(" · ");
    };
    run();
  }

  function closeDetail() {
    detailGen += 1;
    const overlay = $("#dict-overlay");
    if (overlay) overlay.hidden = true;
  }

  async function runSearch() {
    const q = ($("#dict-input") && $("#dict-input").value) || "";
    const box = $("#dict-results");
    const status = $("#dict-status");
    if (!box) return;
    box.innerHTML = "";
    if (!q.trim()) return;
    try {
      await Promise.all([ensureChars(), ensureWords()]);
    } catch {
      return;
    }
    const items = search(q.trim());
    if (status) {
      status.hidden = false;
      status.textContent = items.length ? `${items.length} result${items.length === 1 ? "" : "s"}` : "No matches.";
    }
    box.innerHTML = items.map(cardHtml).join("");
  }

  $("#dict-search-btn")?.addEventListener("click", () => runSearch());
  $("#dict-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runSearch(); }
  });
  $("#dict-results")?.addEventListener("click", (e) => {
    const art = e.target.closest("[data-detail]");
    if (art) showDetail(art.dataset.detail);
  });
  $("#detail-close")?.addEventListener("click", closeDetail);
  $("#dict-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "dict-overlay") closeDetail();
    const save = e.target.closest("[data-savechar]");
    if (save) {
      const ov = $("#dict-overlay");
      const res = window.nameAppBridge && window.nameAppBridge.addReview && window.nameAppBridge.addReview({
        simp: ov.dataset.han,
        py: ov.dataset.py,
        meaningEn: ov.dataset.meaning,
        example: "",
      });
      if (res && res.ok) {
        save.textContent = "Saved";
        const note = $("#detail-note");
        if (note) note.textContent = res.added ? "Added to review." : "Already in your review list.";
      }
    }
    const audio = e.target.closest("[data-audio]");
    if (audio) window.nameAppBridge && window.nameAppBridge.speak && window.nameAppBridge.speak(audio.dataset.audio);
  });

  window.dictionaryApp = {
    ensureChars,
    ensureWords,
    lookupChar,
    englishFor,
    search,
    showDetail,
    closeDetail,
    runSearch,
    lookup: (ch) => {
      const r = charRecord(ch);
      return r || null;
    },
  };

  if (window.__DICT__) {
    CHARS = window.__DICT__;
    allChars = Object.values(CHARS);
  }
  if (window.__WORDS__) buildWordIndex(window.__WORDS__);
})();
