(() => {
  "use strict";
  const $ = (s, root) => (root || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const HAN_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/u;
  const input = $("#ask-input");

  const TONE_MARK = {
    ā: "a", á: "a", ǎ: "a", à: "a", ē: "e", é: "e", ě: "e", è: "e",
    ī: "i", í: "i", ǐ: "i", ì: "i", ō: "o", ó: "o", ǒ: "o", ò: "o",
    ū: "u", ú: "u", ǔ: "u", ù: "u", ǖ: "ü", ǘ: "ü", ǚ: "ü", ǜ: "ü",
  };

  function showToast(msg) {
    let t = document.getElementById("toast") || document.getElementById("doc-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "doc-toast";
      document.body.append(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._tid);
    showToast._tid = setTimeout(() => { t.hidden = true; }, 2400);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { console.warn("clipboard", err); }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (err) {
      console.warn("copy", err);
      return false;
    }
  }

  let aiGeneration = 0;
  function beginAiGeneration() {
    aiGeneration += 1;
    return aiGeneration;
  }

  function buildAiPrompt() {
    const src = (input.value || "").trim();
    if (koreanInAiActive()) {
      return [
        "Explain the following Chinese text.",
        "",
        "Source:",
        src || "(empty)",
        "",
        "1. Full translation: Translate the whole text into natural English.",
        "2. Context: In a short note, say how or where this wording is typically used, when that is relevant.",
        "3. Word by word: List each word on its own line in this format: hanzi, pinyin with tone marks, Korean 훈음 (hun + eum), then the English meaning. Add a short note for idioms or measure words.",
        "   Example: 水 shuǐ 물 수: water",
        "   Example: 快速 kuàisù 빠를 쾌 + 빠를 속: fast, quick",
        "   If you are not sure of the 훈음, omit it rather than guessing.",
        "",
        "Write the prose in English. Include Korean 훈음 only in the word-by-word lines, after the pinyin.",
      ].join("\n");
    }
    return [
      "Explain the following Chinese text.",
      "",
      "Source:",
      src || "(empty)",
      "",
      "1. Full translation: Translate the whole text into natural English.",
      "2. Context: In a short note, say how or where this wording is typically used, when that is relevant.",
      "3. Word by word: List each word on its own line in this format: hanzi, pinyin with tone marks, then the English meaning. Add a short note for idioms or measure words.",
      "   Example: 快速 kuàisù: fast, quick",
      "",
      "Write the answer only in English. Do not use Korean.",
    ].join("\n");
  }

  const AI_STORAGE_KEY = "chinese-ai-en.ai.v1";
  const PREFS_KEY = "chinese-ai-en.prefs.v1";
  const AI_SYSTEM = "You are a precise assistant that explains Chinese text in English. Follow the requested format exactly. Write only in English. Do not use Korean.";
  const AI_SYSTEM_KO = "You are a precise assistant that explains Chinese text in English. Follow the requested format exactly. Write the prose in English. In the word-by-word list only, you may add Korean 훈음 (hun + eum) after the pinyin. Do not write other Korean prose.";

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        koreanReading: !!parsed.koreanReading,
        koreanInAi: !!parsed.koreanInAi,
      };
    } catch (err) {
      return { koreanReading: false, koreanInAi: false };
    }
  }

  function savePrefs(next) {
    const cur = Object.assign(loadPrefs(), next || {});
    const rec = { koreanReading: !!cur.koreanReading, koreanInAi: !!cur.koreanInAi };
    localStorage.setItem(PREFS_KEY, JSON.stringify(rec));
    return rec;
  }

  function koreanInAiActive() {
    const p = loadPrefs();
    return !!(p.koreanReading && p.koreanInAi);
  }

  function getAiSystem() {
    return koreanInAiActive() ? AI_SYSTEM_KO : AI_SYSTEM;
  }
  let AI_TIMEOUT_MS = 180000;
  let AI_NONSTREAM_TIMEOUT_MS = 180000;
  const AI_ASK_MAX_TOKENS = 1600;
  const AI_MODEL_CHOICES = {
    xai: [
      { id: "grok-4.7", label: "grok-4.7 (default)" },
      { id: "grok-4.3", label: "grok-4.3 (fast model)" },
    ],
    openai: [
      { id: "gpt-4o-mini", label: "gpt-4o-mini (default)" },
    ],
    gemini: [
      { id: "gemini-3.8-flash", label: "gemini-3.8-flash (default)" },
    ],
  };
  const AI_FAST_MODEL = { xai: "grok-4.3" };
  const AI_PROVIDERS = {
    xai: {
      id: "xai",
      label: "xAI Grok",
      defaultModel: "grok-4.7",
      keyUrl: "https://console.x.ai/",
      endpoint: "https://api.x.ai/v1/chat/completions",
      kind: "openai",
    },
    openai: {
      id: "openai",
      label: "OpenAI",
      defaultModel: "gpt-4o-mini",
      keyUrl: "https://platform.openai.com/api-keys",
      endpoint: "https://api.openai.com/v1/chat/completions",
      kind: "openai",
    },
    gemini: {
      id: "gemini",
      label: "Google Gemini",
      defaultModel: "gemini-3.8-flash",
      keyUrl: "https://aistudio.google.com/apikey",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
      kind: "gemini",
    },
  };

  let lastAiText = "";
  let aiAbort = null;
  let aiCancelRequested = false;
  let waitClockId = null;
  let waitClockStarted = 0;
  let waitClockPrefix = "";

  function fillModelOptions(providerId, selected) {
    const sel = $("#ai-model");
    if (!sel) return;
    const pid = AI_PROVIDERS[providerId] ? providerId : "xai";
    const choices = (AI_MODEL_CHOICES[pid] || []).map((c) => ({ id: c.id, label: c.label }));
    const want = String(selected || "").trim();
    if (want && !choices.some((c) => c.id === want)) {
      choices.push({ id: want, label: want });
    }
    sel.innerHTML = choices.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("");
    const pick = want && choices.some((c) => c.id === want) ? want : ((choices[0] && choices[0].id) || "");
    sel.value = pick;
    const hint = $("#ai-model-hint");
    if (hint) {
      hint.hidden = pid !== "xai";
    }
  }

  function fastModelFor(providerId, current) {
    const fast = AI_FAST_MODEL[providerId];
    if (!fast) return "";
    return String(current || "").trim() === fast ? "" : fast;
  }

  function reasoningEffortFor(provider, model) {
    if (!provider || provider.id !== "xai") return "";
    const m = String(model || "").trim().toLowerCase();
    if (/^grok-4\.3(\b|$|-)/.test(m)) return "none";
    if (/^grok-4\.(5|6|7)(\b|$|-)/.test(m)) return "low";
    return "";
  }

  function timeoutDetail(provider, model, stream, elapsedMs) {
    const label = (provider && provider.label) || (provider && provider.id) || "AI";
    const mode = stream ? "streaming" : "non-streaming";
    const sec = Math.max(1, Math.round(Number(elapsedMs || 0) / 1000));
    return [label, model, mode, sec + "s"].filter(Boolean).join(" · ");
  }

  function stopWaitClock() {
    if (waitClockId) {
      clearInterval(waitClockId);
      waitClockId = null;
    }
  }

  function startWaitClock(prefix) {
    waitClockPrefix = prefix || "Waiting for an answer…";
    if (!waitClockStarted) waitClockStarted = Date.now();
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - waitClockStarted) / 1000));
      setAiStatus(waitClockPrefix + " " + sec + "s", true);
    };
    stopWaitClock();
    tick();
    waitClockId = setInterval(tick, 250);
  }

  function resetWaitClock(prefix) {
    waitClockStarted = Date.now();
    startWaitClock(prefix);
  }

  function setCancelVisible(on) {
    const b = $("#ask-cancel");
    if (b) b.hidden = !on;
  }

  function setFastRetryVisible(on) {
    const b = $("#ask-fast-retry");
    if (b) b.hidden = !on;
  }

  class AiError extends Error {
    constructor(message, status, detail) {
      super(message);
      this.name = "AiError";
      this.status = status || 0;
      this.detail = detail ? String(detail).slice(0, 200) : "";
    }
  }

  function scrubSecretDetail(text) {
    return String(text || "")
      .replace(/Bearer\s+\S+/gi, "Bearer ***")
      .replace(/xai-[A-Za-z0-9._-]{8,}/g, "xai-***")
      .replace(/sk-[A-Za-z0-9._-]{8,}/g, "sk-***")
      .replace(/AIza[A-Za-z0-9._-]{8,}/g, "AIza***")
      .slice(0, 200);
  }

  function truncateDetail(text) {
    return scrubSecretDetail(String(text || "").replace(/\s+/g, " ").trim()).slice(0, 200);
  }

  function loadAiSettings() {
    try {
      const raw = localStorage.getItem(AI_STORAGE_KEY);
      if (!raw) return { provider: "xai", model: AI_PROVIDERS.xai.defaultModel, key: "", noStream: false };
      const parsed = JSON.parse(raw);
      const provider = AI_PROVIDERS[parsed.provider] ? parsed.provider : "xai";
      return {
        provider,
        model: (parsed.model && String(parsed.model).trim()) || AI_PROVIDERS[provider].defaultModel,
        key: typeof parsed.key === "string" ? parsed.key : "",
        noStream: !!parsed.noStream,
      };
    } catch {
      return { provider: "xai", model: AI_PROVIDERS.xai.defaultModel, key: "", noStream: false };
    }
  }

  function persistAiSettings(data) {
    const provider = AI_PROVIDERS[data && data.provider] ? data.provider : "xai";
    const rec = {
      provider,
      model: String((data && data.model) || AI_PROVIDERS[provider].defaultModel).trim() || AI_PROVIDERS[provider].defaultModel,
      key: String((data && data.key) || ""),
      noStream: !!(data && data.noStream),
    };
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(rec));
    return rec;
  }

  function readAiForm() {
    const provider = ($("#ai-provider") && $("#ai-provider").value) || "xai";
    const p = AI_PROVIDERS[provider] || AI_PROVIDERS.xai;
    const streamBox = $("#ai-use-stream");
    return {
      provider: p.id,
      model: (($("#ai-model") && $("#ai-model").value) || "").trim() || p.defaultModel,
      key: (($("#ai-key") && $("#ai-key").value) || "").trim(),
      noStream: streamBox ? !streamBox.checked : false,
    };
  }

  function clearAiKey() {
    const cur = loadAiSettings();
    persistAiSettings({ provider: cur.provider, model: cur.model, key: "", noStream: cur.noStream });
    if ($("#ai-key")) $("#ai-key").value = "";
  }

  function rememberNoStream(settings) {
    const next = persistAiSettings({
      provider: settings.provider,
      model: settings.model,
      key: settings.key,
      noStream: true,
    });
    const box = $("#ai-use-stream");
    if (box) box.checked = false;
    return next;
  }


  function syncReadingToggles() {
    const p = loadPrefs();
    const ko = $("#pref-korean-reading");
    const ai = $("#pref-korean-in-ai");
    if (ko) ko.checked = !!p.koreanReading;
    if (ai) {
      ai.checked = !!(p.koreanReading && p.koreanInAi);
      ai.disabled = !p.koreanReading;
    }
  }

  function onReadingToggleChange() {
    const ko = $("#pref-korean-reading");
    const ai = $("#pref-korean-in-ai");
    const rec = savePrefs({
      koreanReading: !!(ko && ko.checked),
      koreanInAi: !!(ko && ko.checked && ai && ai.checked),
    });
    syncReadingToggles();
    renderSourceText();
    return rec;
  }

  function fillSettingsForm(reason) {
    const s = loadAiSettings();
    syncReadingToggles();
    if ($("#ai-provider")) $("#ai-provider").value = s.provider;
    fillModelOptions(s.provider, s.model);
    if ($("#ai-key")) {
      $("#ai-key").value = s.key;
      $("#ai-key").type = "password";
    }
    if ($("#ai-key-toggle")) $("#ai-key-toggle").textContent = "Show";
    if ($("#ai-use-stream")) $("#ai-use-stream").checked = !s.noStream;
    const reasonEl = $("#ai-settings-reason");
    if (reasonEl) {
      if (reason) {
        reasonEl.textContent = reason;
        reasonEl.hidden = false;
      } else {
        reasonEl.hidden = true;
      }
    }
    if ($("#ai-settings-status") && reason) $("#ai-settings-status").textContent = "";
  }

  function openAiSettings(reason) {
    fillSettingsForm(reason);
    if (window.nameAppBridge && window.nameAppBridge.showTab) window.nameAppBridge.showTab("settings");
    const key = $("#ai-key");
    if (key) setTimeout(() => key.focus(), 50);
  }

  function closeAiSettings() {
    /* Settings live on their own tab. */
  }

  function hideAiResult() {
    beginAiGeneration();
    stopWaitClock();
    waitClockStarted = 0;
    setCancelVisible(false);
    setFastRetryVisible(false);
    if (aiAbort) {
      aiAbort.abort();
      aiAbort = null;
    }
    const box = $("#ask-result");
    if (box) {
      box.hidden = true;
      box.classList.remove("is-loading");
    }
    const status = $("#ask-status");
    if (status) { status.hidden = true; status.textContent = ""; }
    const err = $("#ask-error");
    if (err) {
      err.hidden = true;
      err.textContent = "";
      err.innerHTML = "";
    }
    const ans = $("#ask-answer");
    if (ans) ans.innerHTML = "";
    lastAiText = "";
  }

  function applyInlineMd(escaped) {
    return escaped
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, label, url) => {
        const raw = String(url).replace(/&amp;/g, "&");
        if (!/^https?:\/\//i.test(raw)) return m;
        return `<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });
  }

  function renderSafeMarkdown(src) {
    const text = String(src ?? "").replace(/\r\n/g, "\n");
    const chunks = text.split(/(```[\s\S]*?```)/);
    const html = [];
    function flushPara(buf) {
      const t = buf.join("\n").trim();
      if (t) html.push(`<p>${applyInlineMd(esc(t).replace(/\n/g, "<br>"))}</p>`);
      buf.length = 0;
    }
    function flushList(items, ordered) {
      if (!items.length) return;
      const tag = ordered ? "ol" : "ul";
      const re = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      html.push("<" + tag + ">" + items.map((l) => `<li>${applyInlineMd(esc(l.replace(re, "")))}</li>`).join("") + "</" + tag + ">");
      items.length = 0;
    }
    for (const chunk of chunks) {
      if (chunk.startsWith("```")) {
        const inner = chunk.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
        html.push(`<pre><code>${esc(inner)}</code></pre>`);
        continue;
      }
      const lines = chunk.split("\n");
      const para = [];
      const ul = [];
      const ol = [];
      const flushAll = () => { flushList(ul, false); flushList(ol, true); flushPara(para); };
      for (const line of lines) {
        if (!line.trim()) { flushAll(); continue; }
        if (/^#{1,3}\s+/.test(line)) {
          flushAll();
          const level = (line.match(/^(#{1,3})/) || ["#"])[0].length;
          const tag = "h" + (level + 1);
          html.push(`<${tag}>${applyInlineMd(esc(line.replace(/^#{1,3}\s+/, "")))}</${tag}>`);
          continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
          flushList(ol, true);
          flushPara(para);
          ul.push(line);
          continue;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
          flushList(ul, false);
          flushPara(para);
          ol.push(line);
          continue;
        }
        flushList(ul, false);
        flushList(ol, true);
        para.push(line);
      }
      flushAll();
    }
    return html.join("") || "<p></p>";
  }

  function showAiLoading(msg) {
    const box = $("#ask-result");
    if (!box) return;
    box.hidden = false;
    box.classList.add("is-loading");
    const status = $("#ask-status");
    if (status) {
      status.hidden = false;
      status.textContent = msg || "Getting an answer…";
    }
    const err = $("#ask-error");
    if (err) { err.hidden = true; err.textContent = ""; err.innerHTML = ""; }
    const ans = $("#ask-answer");
    if (ans) ans.innerHTML = "";
    lastAiText = "";
    setFastRetryVisible(false);
    setCancelVisible(true);
  }

  function setAiStatus(msg, loading) {
    const box = $("#ask-result");
    if (!box) return;
    box.hidden = false;
    if (loading != null) box.classList.toggle("is-loading", !!loading);
    const status = $("#ask-status");
    if (status) {
      status.hidden = !msg;
      status.textContent = msg || "";
    }
  }

  function renderAiAnswer(text, loading) {
    const box = $("#ask-result");
    if (!box) return;
    if (!loading) {
      stopWaitClock();
      waitClockStarted = 0;
      setCancelVisible(false);
    }
    box.hidden = false;
    box.classList.toggle("is-loading", !!loading);
    const status = $("#ask-status");
    if (status) {
      status.hidden = !loading;
      if (loading) {
        if (!(status.textContent && /trying again|different method/i.test(status.textContent))) {
          status.textContent = "Getting an answer…";
        }
      } else {
        status.textContent = "";
      }
    }
    const err = $("#ask-error");
    if (err) { err.hidden = true; err.textContent = ""; err.innerHTML = ""; }
    lastAiText = text;
    const ans = $("#ask-answer");
    if (ans) ans.innerHTML = renderSafeMarkdown(text);
  }

  function showAiError(msg, detail) {
    const box = $("#ask-result");
    if (!box) return;
    stopWaitClock();
    waitClockStarted = 0;
    setCancelVisible(false);
    box.hidden = false;
    box.classList.remove("is-loading");
    const status = $("#ask-status");
    if (status) status.hidden = true;
    const err = $("#ask-error");
    if (!err) return;
    err.hidden = false;
    err.textContent = "";
    err.innerHTML = "";
    const main = document.createElement("span");
    main.className = "doc-ai-error-msg";
    main.textContent = msg || "Could not get an answer. Please try again in a moment.";
    err.appendChild(main);
    if (detail) {
      const d = document.createElement("span");
      d.className = "doc-ai-error-detail";
      d.textContent = truncateDetail(detail);
      err.appendChild(d);
    }
  }

  function isTimeoutError(err) {
    if (!err) return false;
    if (err.name === "TimeoutError") return true;
    if (err instanceof AiError && err.message === "timeout") return true;
    const msg = String(err.message || "");
    return /timeout/i.test(msg) && !(err.status > 0);
  }

  function isNetworkAiError(err) {
    if (!err) return false;
    if (isTimeoutError(err)) return false;
    if (err.name === "AbortError") return false;
    if (err instanceof AiError) {
      if (err.status > 0) return false;
      if (err.message === "empty" || err.message === "http" || err.message === "timeout") return false;
      return true;
    }
    if (err.name === "TypeError") return true;
    const msg = String(err.message || "");
    return /failed to fetch|networkerror|load failed|network/i.test(msg);
  }

  function formatAiError(err) {
    let message = "Could not get an answer. Please try again in a moment.";
    const status = err && err.status;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      message = "No network connection. Check your internet and try again.";
    } else if (isTimeoutError(err)) {
      message = "The response is taking too long. Try again in a moment, or use a faster model (for example grok-4.3).";
    } else if (status === 401 || status === 403) {
      message = "The API key is invalid or does not have access. Check the key in Settings.";
    } else if (status === 429) {
      message = "Too many requests. Please try again in a moment.";
    } else if (status === 404) {
      message = "That model name was not found. Check the model in Settings.";
    } else if (status === 400) {
      const detailBlob = String((err && err.detail) || "") + " " + String((err && err.message) || "");
      if (/api key|incorrect.*key|invalid.*key|unauthorized/i.test(detailBlob)) {
        message = "The API key is invalid or does not have access. Check the key in Settings.";
      } else {
        message = "The request format was rejected.";
      }
    } else if (status >= 500) {
      message = "The AI server had a problem. Please try again in a moment.";
    } else if (isNetworkAiError(err)) {
      message = "No network connection. Check your internet and try again.";
    }

    const parts = [];
    if (status) parts.push("HTTP " + status);
    if (err && err.message && !/^(http|network|empty|timeout)$/i.test(err.message)) {
      parts.push(String(err.message));
    } else if (err && err.message === "timeout") {
      if (!err.detail) parts.push("timeout");
    } else if (err && err.message === "network") {
      parts.push("network");
    } else if (err && err.name === "TypeError") {
      parts.push(err.message || "TypeError");
    }
    if (err && err.detail) parts.push(String(err.detail));
    const detail = truncateDetail(parts.join(" · "));
    return { message, detail };
  }

  function showFormattedAiError(err, ctx) {
    const formatted = formatAiError(err);
    showAiError(formatted.message, formatted.detail);
    const providerId = (ctx && ctx.providerId) || (loadAiSettings().provider);
    const model = (ctx && ctx.model) || loadAiSettings().model;
    setFastRetryVisible(!!(isTimeoutError(err) && fastModelFor(providerId, model)));
  }

  async function readHttpErrorDetail(res) {
    try {
      const json = await res.json();
      if (!json || typeof json !== "object") return "";
      if (typeof json.error === "string") return json.error;
      if (json.error && typeof json.error.message === "string") return json.error.message;
      if (typeof json.message === "string") return json.message;
      try { return JSON.stringify(json).slice(0, 200); } catch { return ""; }
    } catch {
      try {
        const t = await res.text();
        return String(t || "").slice(0, 200);
      } catch {
        return "";
      }
    }
  }

  async function readSseStream(res, pickChunk, onDelta) {
    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const piece = pickChunk(json);
            if (piece) {
              full += piece;
              if (onDelta) onDelta(full);
            }
          } catch { /* ignore malformed sse lines */ }
        }
      }
      return full;
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      if (isTimeoutError(err)) throw new AiError("timeout", 0, truncateDetail(err && err.message));
      throw new AiError((err && err.message) || "network", 0, truncateDetail(err && err.message));
    }
  }

  function openaiChunk(json) {
    return (json && json.choices && json.choices[0] && (
      (json.choices[0].delta && json.choices[0].delta.content) ||
      (json.choices[0].message && json.choices[0].message.content) ||
      ""
    )) || "";
  }

  function geminiChunk(json) {
    const parts = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
    if (!parts || !parts.length) return "";
    return parts.map((part) => part && part.text ? part.text : "").join("");
  }

  function openaiMessage(json) {
    return openaiChunk(json) || (json && json.choices && json.choices[0] && json.choices[0].text) || "";
  }

  function geminiMessage(json) {
    return geminiChunk(json);
  }

  async function parseProviderResponse(provider, res, onDelta) {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/event-stream") && res.body) {
      return readSseStream(res, provider.kind === "gemini" ? geminiChunk : openaiChunk, onDelta);
    }
    const json = await res.json();
    const text = provider.kind === "gemini" ? geminiMessage(json) : openaiMessage(json);
    if (onDelta) onDelta(text);
    return text;
  }

  function combineAbortSignals(a, b) {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
      const list = [a, b].filter(Boolean);
      if (list.length === 1) return list[0];
      if (list.length > 1) return AbortSignal.any(list);
    }
    const ctrl = new AbortController();
    const abortFrom = (sig) => {
      if (!sig) return;
      if (sig.aborted) {
        try { ctrl.abort(sig.reason); } catch { ctrl.abort(); }
        return;
      }
      sig.addEventListener("abort", () => {
        try { ctrl.abort(sig.reason); } catch { ctrl.abort(); }
      }, { once: true });
    };
    abortFrom(a);
    abortFrom(b);
    return ctrl.signal;
  }

  async function requestProvider(provider, settings, prompt, opts) {
    const stream = !!(opts && opts.stream);
    const parentSignal = opts && opts.signal;
    const onDelta = opts && opts.onDelta;
    const maxTokens = (opts && opts.maxTokens != null) ? opts.maxTokens : AI_ASK_MAX_TOKENS;
    const requireText = !(opts && opts.requireText === false);
    const defaultTimeout = stream ? AI_TIMEOUT_MS : AI_NONSTREAM_TIMEOUT_MS;
    const timeoutMs = (opts && opts.timeoutMs != null) ? Number(opts.timeoutMs) : defaultTimeout;
    const model = (settings.model || provider.defaultModel).trim();
    const effort = (opts && opts.skipReasoningEffort) ? "" : reasoningEffortFor(provider, model);
    const startedAt = Date.now();
    const makeTimeout = () => new AiError("timeout", 0, timeoutDetail(provider, model, stream, Date.now() - startedAt));

    let url;
    let headers;
    let payloadObj = null;
    if (provider.kind === "gemini") {
      const action = stream ? "streamGenerateContent" : "generateContent";
      url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":" + action;
      if (stream) url += "?alt=sse";
      headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.key,
      };
      const generationConfig = { temperature: 0.3 };
      if (maxTokens) generationConfig.maxOutputTokens = maxTokens;
      payloadObj = {
        systemInstruction: { parts: [{ text: getAiSystem() }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      };
    } else {
      url = provider.endpoint;
      headers = {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.key,
      };
      payloadObj = {
        model,
        messages: [
          { role: "system", content: getAiSystem() },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        stream,
      };
      if (maxTokens) payloadObj.max_tokens = maxTokens;
      // Only for models documented to support it: grok-4.7/4.6/4.5 default to
      // high reasoning; sending "low" cuts latency. grok-4.3 accepts "none".
      // Do not send presence_penalty / frequency_penalty / stop.
      if (effort) payloadObj.reasoning_effort = effort;
    }
    const body = JSON.stringify(payloadObj);

    const timeoutCtrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { timeoutCtrl.abort(new DOMException("timeout", "TimeoutError")); } catch { timeoutCtrl.abort(); }
    }, Math.max(1000, timeoutMs || defaultTimeout));
    const signal = combineAbortSignals(parentSignal, timeoutCtrl.signal);

    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body, signal });
    } catch (err) {
      clearTimeout(timer);
      if (parentSignal && parentSignal.aborted && !timedOut) throw (err && err.name === "AbortError" ? err : new DOMException("Aborted", "AbortError"));
      if (timedOut || isTimeoutError(err) || (err && err.name === "AbortError" && timedOut)) {
        throw makeTimeout();
      }
      if (err && err.name === "AbortError") throw err;
      throw new AiError((err && err.message) || "network", 0, truncateDetail(err && err.message));
    }

    if (!res.ok) {
      clearTimeout(timer);
      const detail = await readHttpErrorDetail(res);
      if (
        res.status === 400 &&
        effort &&
        !(opts && opts.skipReasoningEffort) &&
        /reasoning/i.test(detail || "")
      ) {
        return requestProvider(provider, settings, prompt, Object.assign({}, opts, { skipReasoningEffort: true }));
      }
      throw new AiError("http", res.status, detail);
    }

    try {
      const text = await parseProviderResponse(provider, res, onDelta);
      clearTimeout(timer);
      if (requireText && !String(text || "").trim()) throw new AiError("empty", res.status || 200);
      return String(text || "");
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof AiError) throw err;
      if (parentSignal && parentSignal.aborted && !timedOut) throw err;
      if (timedOut || isTimeoutError(err)) throw makeTimeout();
      if (err && err.name === "AbortError") throw err;
      throw new AiError((err && err.message) || "network", 0, truncateDetail(err && err.message));
    }
  }

  async function askAi() {
    const text = (input.value || "").trim();
    if (!text) {
      showToast("Paste some Chinese text first.");
      return;
    }
    renderSourceText();
    let settings = loadAiSettings();
    if (!settings.key) {
      openAiSettings("Save an API key to see answers in the app. The key stays on this device.");
      return;
    }
    const askBtn = $("#ask-btn");
    const askLabel = askBtn ? askBtn.textContent : "Ask AI";
    if (askBtn) {
      askBtn.disabled = true;
      askBtn.textContent = "Getting an answer…";
    }
    const gen = beginAiGeneration();
    const stillThisAsk = () => gen === aiGeneration;
    aiCancelRequested = false;
    waitClockStarted = 0;
    showAiLoading("Waiting for an answer…");
    startWaitClock("Waiting for an answer…");
    const resultBox = $("#ask-result");
    if (resultBox) resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const provider = AI_PROVIDERS[settings.provider] || AI_PROVIDERS.xai;
      const prompt = buildAiPrompt();
      if (aiAbort) aiAbort.abort();
      aiAbort = new AbortController();
      const signal = aiAbort.signal;
      const useStream = !settings.noStream;
      const onDelta = (full) => { if (stillThisAsk()) renderAiAnswer(full, true); };
      const ctx = { providerId: provider.id, model: settings.model || provider.defaultModel };
      async function once(stream) {
        return requestProvider(provider, settings, prompt, {
          stream,
          signal,
          onDelta,
        });
      }
      async function withTimeoutRetry(stream) {
        try {
          return await once(stream);
        } catch (err) {
          if (err && err.name === "AbortError") throw err;
          if (!stillThisAsk()) throw (err && err.name === "AbortError" ? err : new DOMException("Aborted", "AbortError"));
          if (!isTimeoutError(err)) throw err;
          startWaitClock("Timed out, trying again…");
          return await once(false);
        }
      }
      let answer;
      if (useStream) {
        try {
          answer = await withTimeoutRetry(true);
        } catch (err) {
          if (err && err.name === "AbortError") throw err;
          if (!stillThisAsk()) throw (err && err.name === "AbortError" ? err : new DOMException("Aborted", "AbortError"));
          // Empty SSE after HTTP 200 also happens when a proxy drops the stream.
          if (isNetworkAiError(err) || (err instanceof AiError && err.message === "empty")) {
            const hadPartial = !!(lastAiText && String(lastAiText).trim());
            settings = rememberNoStream(settings);
            startWaitClock("Trying a different method…");
            if (hadPartial) {
              const ans = $("#ask-answer");
              if (ans) ans.innerHTML = "";
              lastAiText = "";
            }
            answer = await withTimeoutRetry(false);
          } else {
            throw err;
          }
        }
      } else {
        answer = await withTimeoutRetry(false);
      }
      if (!stillThisAsk()) return;
      renderAiAnswer(answer, false);
    } catch (err) {
      if (aiCancelRequested || (err && err.name === "AbortError")) {
        if (aiCancelRequested && stillThisAsk()) {
          stopWaitClock();
          waitClockStarted = 0;
          setCancelVisible(false);
          setAiStatus("Cancelled.", false);
        }
        return;
      }
      if (!stillThisAsk()) return;
      showFormattedAiError(err, { providerId: settings.provider, model: settings.model });
    } finally {
      setCancelVisible(false);
      if (askBtn) {
        askBtn.disabled = false;
        askBtn.textContent = askLabel || "Ask AI";
      }
    }
  }

  async function testAiConnection() {
    const settings = readAiForm();
    const provider = AI_PROVIDERS[settings.provider] || AI_PROVIDERS.xai;
    const status = $("#ai-settings-status");
    if (!settings.key) {
      if (status) status.textContent = "Please enter a key.";
      return;
    }
    if (status) status.textContent = "Testing the connection…";
    const model = (settings.model || provider.defaultModel).trim();
    try {
      await requestProvider(provider, settings, "ping", {
        stream: false,
        maxTokens: 8,
        requireText: false,
        timeoutMs: Math.min(AI_TIMEOUT_MS, 60000),
      });
    } catch (err) {
      if (status) {
        const formatted = formatAiError(err);
        status.textContent = formatted.detail
          ? formatted.message + " (" + formatted.detail + ")"
          : formatted.message;
      }
      return;
    }

    try {
      await requestProvider(provider, settings, "ping", {
        stream: true,
        maxTokens: 8,
        requireText: false,
        timeoutMs: Math.min(AI_TIMEOUT_MS, 45000),
      });
      if (status) status.textContent = "Connected (model: " + model + ")";
    } catch (err) {
      if (isNetworkAiError(err) || isTimeoutError(err)) {
        rememberNoStream(settings);
        persistAiSettings({
          provider: settings.provider,
          model: settings.model,
          key: settings.key,
          noStream: true,
        });
        if ($("#ai-use-stream")) $("#ai-use-stream").checked = false;
        if (status) {
          status.textContent = "Connected (model: " + model + "). Streaming is blocked, so answers will use the non-streaming method.";
        }
      } else {
        // Non-stream already worked; treat as connected.
        if (status) status.textContent = "Connected (model: " + model + ")";
      }
    }
  }

  function isHan(ch) {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xF900 && cp <= 0xFAFF)
      || (cp >= 0x20000 && cp <= 0x2FA1F);
  }

  function pinyinFor(ch) {
    const D = window.dictionaryApp;
    if (!D || !D.lookupKorean && !D.ensureChars) return "";
    const rec = (typeof D.charRecord === "function") ? D.charRecord(ch) : null;
    // fallback via lookupChar if exported — otherwise dictionary records
    if (rec && rec.p && rec.p.length) return rec.p[0];
    return "";
  }

  function wrapHanziHtml(text, annotated) {
    let out = "", buf = "";
    const flush = () => { if (buf) { out += esc(buf); buf = ""; } };
    const D = window.dictionaryApp;
    for (const ch of String(text || "")) {
      if (isHan(ch)) {
        flush();
        if (annotated) {
          const py = pinyinFor(ch);
          const ko = (D && D.lookupKorean) ? (D.lookupKorean(ch).label || "") : "";
          out += `<button type="button" class="han-tap han-annotated" data-han="${esc(ch)}" lang="zh-CN">`
            + `<span class="han-glyph">${esc(ch)}</span>`
            + (py ? `<span class="han-py">${esc(py)}</span>` : `<span class="han-py han-py-empty"></span>`)
            + (ko ? `<span class="han-ko" lang="ko">${esc(ko)}</span>` : `<span class="han-ko han-ko-empty"></span>`)
            + `</button>`;
        } else {
          out += `<button type="button" class="han-tap" data-han="${esc(ch)}" lang="zh-CN">${esc(ch)}</button>`;
        }
      } else buf += ch;
    }
    flush();
    return out;
  }

  function wrapHanziInElement(root) {
    if (!root) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !HAN_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && node.parentElement.closest("button, a, code")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const node of nodes) {
      const span = document.createElement("span");
      span.innerHTML = wrapHanziHtml(node.nodeValue);
      node.parentNode.replaceChild(span, node);
    }
  }

  async function renderSourceText() {
    const box = $("#ask-source");
    const body = $("#ask-source-body");
    const text = (input.value || "").trim();
    if (!box || !body) return;
    if (!text) { box.hidden = true; body.innerHTML = ""; return; }
    box.hidden = false;
    const wantKo = !!(loadPrefs().koreanReading);
    if (wantKo && window.dictionaryApp) {
      try {
        await Promise.all([
          window.dictionaryApp.ensureChars ? window.dictionaryApp.ensureChars() : Promise.resolve(),
          window.dictionaryApp.ensureKoReadings ? window.dictionaryApp.ensureKoReadings() : Promise.resolve(),
        ]);
      } catch (err) { console.warn("readings", err); }
    }
    body.innerHTML = wrapHanziHtml(text, wantKo);
    body.classList.toggle("is-annotated", wantKo);
  }

  const WORD_LINE = /^([\u3400-\u9FFF\uF900-\uFAFF]{1,20})\s+([A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜvV0-9:'\-\s]+?)\s*[:：]\s*(.+)$/;

  function parseWordLine(text) {
    const t = String(text || "").trim().replace(/^[-*]\s+/, "");
    const m = t.match(WORD_LINE);
    if (!m) return null;
    return { simp: m[1], py: m[2].trim(), meaning: m[3].trim() };
  }

  function exampleExcerpt() {
    const S = window.NameSrs;
    const src = (input.value || "").trim();
    if (S && S.excerpt) return S.excerpt(src, "", 80);
    return src.slice(0, 80);
  }

  function enhanceAnswer() {
    const ans = $("#ask-answer");
    if (!ans) return;
    wrapHanziInElement(ans);
    const nodes = [...ans.querySelectorAll("li, p")];
    for (const el of nodes) {
      if (el.querySelector("[data-add-review]")) continue;
      const parsed = parseWordLine(el.innerText);
      if (!parsed) continue;
      el.classList.add("ask-word-line");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost doc-sum-save";
      btn.dataset.addReview = "1";
      btn.dataset.simp = parsed.simp;
      btn.dataset.py = parsed.py;
      btn.dataset.meaning = parsed.meaning;
      const already = window.nameAppBridge && window.nameAppBridge.isSaved && window.nameAppBridge.isSaved(parsed.simp, parsed.py);
      btn.textContent = already ? "Saved" : "Add to review";
      if (already) btn.classList.add("is-saved");
      el.appendChild(btn);
    }
  }

  const _renderAiAnswer = renderAiAnswer;
  renderAiAnswer = function (text, loading) {
    _renderAiAnswer(text, loading);
    if (!loading) enhanceAnswer();
  };

  function currentPromptText() {
    return (input.value || "").trim();
  }

  function onTextChanged() {
    hideAiResult();
    renderSourceText();
  }

  if (input) {
    input.addEventListener("input", onTextChanged);
  }

  $("#ask-btn")?.addEventListener("click", () => { askAi(); });
  $("#ask-copy")?.addEventListener("click", async () => {
    if (!currentPromptText()) {
      showToast("Paste some Chinese text first.");
      return;
    }
    const ok = await copyText(buildAiPrompt());
    showToast(ok ? "Prompt copied." : "Could not copy.");
  });
  $("#ask-clear")?.addEventListener("click", () => {
    if (input) input.value = "";
    onTextChanged();
    if (input) input.focus();
  });
  $("#ask-copy-answer")?.addEventListener("click", async () => {
    if (!lastAiText) {
      showToast("There is no answer to copy.");
      return;
    }
    const ok = await copyText(lastAiText);
    showToast(ok ? "Answer copied." : "Could not copy.");
  });
  $("#ask-retry")?.addEventListener("click", () => { askAi(); });
  $("#ask-cancel")?.addEventListener("click", () => {
    aiCancelRequested = true;
    beginAiGeneration();
    if (aiAbort) {
      aiAbort.abort();
      aiAbort = null;
    }
    stopWaitClock();
    waitClockStarted = 0;
    setCancelVisible(false);
    const box = $("#ask-result");
    if (box) box.classList.remove("is-loading");
    setAiStatus("Cancelled.", false);
    const askBtn = $("#ask-btn");
    if (askBtn) {
      askBtn.disabled = false;
      askBtn.textContent = "Ask AI";
    }
  });
  $("#ask-fast-retry")?.addEventListener("click", () => {
    const cur = loadAiSettings();
    const fast = fastModelFor(cur.provider, cur.model);
    if (!fast) {
      askAi();
      return;
    }
    persistAiSettings({
      provider: cur.provider,
      model: fast,
      key: cur.key,
      noStream: cur.noStream,
    });
    fillModelOptions(cur.provider, fast);
    setFastRetryVisible(false);
    askAi();
  });

  $("#ai-provider")?.addEventListener("change", () => {
    const p = AI_PROVIDERS[$("#ai-provider").value];
    if (p) fillModelOptions(p.id, p.defaultModel);
  });
  $("#ai-key-toggle")?.addEventListener("click", () => {
    const inp = $("#ai-key");
    const btn = $("#ai-key-toggle");
    if (!inp || !btn) return;
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
  });
  $("#ai-settings-save")?.addEventListener("click", () => {
    persistAiSettings(readAiForm());
    const status = $("#ai-settings-status");
    if (status) status.textContent = "Saved. The key stays on this device.";
  });
  $("#ai-use-stream")?.addEventListener("change", () => {
    persistAiSettings(readAiForm());
  });
  $("#ai-settings-clear")?.addEventListener("click", () => {
    clearAiKey();
    const status = $("#ai-settings-status");
    if (status) status.textContent = "The key was deleted.";
  });
  $("#ai-settings-test")?.addEventListener("click", () => { testAiConnection(); });

  document.addEventListener("click", (e) => {
    const hanBtn = e.target.closest("[data-han]");
    if (hanBtn) {
      e.preventDefault();
      const ch = hanBtn.dataset.han;
      if (ch && window.dictionaryApp && window.dictionaryApp.showDetail) window.dictionaryApp.showDetail(ch);
      return;
    }
    const add = e.target.closest("[data-add-review]");
    if (!add) return;
    e.preventDefault();
    const item = {
      simp: add.dataset.simp,
      py: add.dataset.py,
      meaningEn: add.dataset.meaning,
      example: exampleExcerpt(),
    };
    const res = window.nameAppBridge && window.nameAppBridge.addReview && window.nameAppBridge.addReview(item);
    if (res && res.ok) {
      add.textContent = "Saved";
      add.classList.add("is-saved");
      showToast(res.added ? "Added to review." : "Already in your review list. Example updated if new.");
    } else {
      showToast("Could not save this item.");
    }
  });

  $("#pref-korean-reading")?.addEventListener("change", onReadingToggleChange);
  $("#pref-korean-in-ai")?.addEventListener("change", onReadingToggleChange);
  fillSettingsForm();
  syncReadingToggles();


  window.askApp = {
    buildAiPrompt,
    loadAiSettings,
    persistAiSettings,
    loadPrefs,
    savePrefs,
    PREFS_KEY,
    getAiSystem,
    askAi,
    renderSourceText,
    hideAiResult,
    renderAiAnswer,
    enhanceAnswer,
    parseWordLine,
    AI_STORAGE_KEY,
    AI_SYSTEM,
    AI_PROVIDERS,
    AI_MODEL_CHOICES,
    AI_TIMEOUT_MS,
    AI_NONSTREAM_TIMEOUT_MS,
  };
})();
