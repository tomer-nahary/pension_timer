/* ══════════════════════════════════════════════════════════════════
   הפנסיה מתקרבת — retirement countdown
   ──────────────────────────────────────────────────────────────────
   Change the date below and reload. Nothing else needs touching.
   Dates must be "YYYY-MM-DD" and are read as LOCAL midnight,
   so the countdown always ends on the day you intended.
   ══════════════════════════════════════════════════════════════════ */

const CONFIG = {
  PENSION_DATE: "2045-06-01", // ← the day retirement starts
  START_DATE:   "2010-01-01", // ← career start, drives the progress bar
  HEADLINE:     "הפנסיה מתקרבת",
  EYEBROW:      "המסע אל החופש",
  NOTE:         "הספינה כבר יצאה. נשאר רק לחכות לחוף.",
  WORK_DAYS_PER_WEEK: 5,
};

/* ─── pure date helpers (unit-testable) ─────────────────────── */

const MS_SECOND = 1000;
const MS_MINUTE = 60 * MS_SECOND;
const MS_HOUR   = 60 * MS_MINUTE;
const MS_DAY    = 24 * MS_HOUR;

/** "YYYY-MM-DD" → Date at local midnight. Returns null if malformed. */
function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  // Date happily rolls 2025-02-31 over into March; reject it instead.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null;

  return date;
}

/**
 * Split a remaining-time span into display units.
 * Derived from absolute milliseconds, so DST shifts are absorbed
 * automatically instead of drifting the countdown by an hour twice a year.
 */
function breakdown(spanMs) {
  const totalSeconds = Math.max(0, Math.floor(spanMs / MS_SECOND));
  const days = Math.floor(totalSeconds / 86400);
  return {
    totalSeconds,
    days,
    hours: Math.floor(totalSeconds / 3600) % 24,
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
  };
}

/** Fraction of the career that has elapsed, clamped to 0…1. */
function progressRatio(start, target, now) {
  const span = target - start;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (now - start) / span));
}

/** Working days left, assuming a WORK_DAYS_PER_WEEK work week. */
function workingDays(totalSeconds, perWeek) {
  const days = totalSeconds / 86400;
  const wholeWeeks = Math.floor(days / 7);
  return wholeWeeks * perWeek + Math.min(perWeek, Math.floor(days % 7));
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pad2 = (n) => String(n).padStart(2, "0");
const group = (n) => n.toLocaleString("he-IL");

/** Hebrew noun agreement: singular / dual / plural, incl. 11, 12, 21… */
function hePlural(n, one, two, many) {
  if (n === 1) return one;
  if (n === 0) return many;
  const last = n % 10;
  if (last === 2) return two;
  if (last === 0 || (last >= 3 && last <= 9)) return many;
  return one;
}

/** "6,818 ימים" — numeral plus an agreeing Hebrew noun. */
function hePhrase(n, one, two, many) {
  return `${group(n)} ${hePlural(n, one, two, many)}`;
}

/**
 * Spoken summary. The final unit is joined with the maqaf prefix
 * (ו־) so "ו־2 שתי דקות" stays grammatical — a bare " ו " would
 * collide with the dual form's own "שתי".
 */
function describe(phrases) {
  const head = phrases.slice(0, -1);
  const tail = phrases[phrases.length - 1];
  const spoken = [...head, `ו־${tail}`];
  return `נשארו עוד ${spoken.join(", ")}`;
}

/* ─── rendering ─────────────────────────────────────────────── */

function paintDigits(element, text) {
  if (!element || element.dataset.text === text) return;

  const previous = element.dataset.text ?? "";
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const span = document.createElement("span");
    span.className = "digit";
    span.textContent = char;
    if (previous !== "" && /\d/.test(char) && previous[i] !== char) {
      span.classList.add("is-tick");
    }
    fragment.appendChild(span);
  }

  element.replaceChildren(fragment);
  element.dataset.text = text;
}

/* ─── page ──────────────────────────────────────────────────── */

function init() {
  const root = document.documentElement;

  const target = parseLocalDate(CONFIG.PENSION_DATE);
  const start = parseLocalDate(CONFIG.START_DATE);

  const el = {
    eyebrow: document.getElementById("eyebrow"),
    title: document.getElementById("title"),
    note: document.getElementById("note"),
    days: document.getElementById("cdDays"),
    hours: document.getElementById("cdHours"),
    minutes: document.getElementById("cdMinutes"),
    seconds: document.getElementById("cdSeconds"),
    countdown: document.getElementById("countdown"),
    journeyStart: document.getElementById("journeyStart"),
    journeyEnd: document.getElementById("journeyEnd"),
    pct: document.getElementById("journeyPct"),
    statWeeks: document.getElementById("statWeeks"),
    statMonths: document.getElementById("statMonths"),
    statWork: document.getElementById("statWorkDays"),
    arrival: document.getElementById("arrival"),
    live: document.getElementById("live"),
    heroImg: document.getElementById("heroImg"),
  };

  if (el.heroImg) {
    const reveal = () => el.heroImg.classList.add("is-loaded");
    if (el.heroImg.complete && el.heroImg.naturalWidth > 0) reveal();
    else el.heroImg.addEventListener("load", reveal, { once: true });
  }

  if (!target) {
    showConfigError(
      `PENSION_DATE חייב להיות בפורמט YYYY-MM-DD — נמצא: "${CONFIG.PENSION_DATE}"`
    );
    return;
  }

  const origin = start && start <= target ? start : null;

  el.eyebrow.textContent = CONFIG.EYEBROW;
  el.title.textContent = CONFIG.HEADLINE;
  el.note.textContent = CONFIG.NOTE;
  el.journeyStart.textContent = origin ? String(origin.getFullYear()) : "—";
  el.journeyEnd.textContent = String(target.getFullYear());

  let reached = false;
  let lastSpokenMinute = -1;

  function render(now) {
    const remaining = target.getTime() - now;

    root.style.setProperty(
      "--progress",
      String(origin ? progressRatio(origin.getTime(), target.getTime(), now) : 1)
    );

    if (remaining <= 0) {
      if (!reached) showArrival();
      return;
    }

    const time = breakdown(remaining);

    paintDigits(el.days, group(time.days));
    paintDigits(el.hours, pad2(time.hours));
    paintDigits(el.minutes, pad2(time.minutes));
    paintDigits(el.seconds, pad2(time.seconds));

    el.pct.textContent = group(
      Math.round(
        (origin ? progressRatio(origin.getTime(), target.getTime(), now) : 1) * 100
      )
    );

    if (!reached) {
      el.statWeeks.textContent = group(Math.floor(time.totalSeconds / 604800));
      el.statMonths.textContent = group(Math.round(time.totalSeconds / 2629746));
      el.statWork.textContent = group(
        workingDays(time.totalSeconds, CONFIG.WORK_DAYS_PER_WEEK)
      );
    }

    // Announce once a minute — a per-second live region would flood a screen reader.
    if (time.minutes !== lastSpokenMinute) {
      lastSpokenMinute = time.minutes;
      el.live.textContent = describe([
        hePhrase(time.days, "יום אחד", "יומיים", "ימים"),
        hePhrase(time.hours, "שעה אחת", "שעתיים", "שעות"),
        hePhrase(time.minutes, "דקה אחת", "שתי דקות", "דקות"),
      ]);
    }
  }

  function showArrival() {
    reached = true;
    root.style.setProperty("--progress", "1");
    el.live.textContent = "הפנסיה הגיעה. החופש מתחיל עכשיו.";
    el.arrival.hidden = false;
  }

  function showConfigError(message) {
    const note = document.createElement("p");
    note.className = "config-error";
    note.append("ערך ");
    const code = document.createElement("code");
    code.textContent = "CONFIG.PENSION_DATE";
    note.append(code, ` — ${message}`);

    el.note.replaceWith(note);
    el.countdown.hidden = true;
    el.live.textContent = message;
  }

  /* Re-align to the second boundary each tick so the digits never
     stutter or jump early between intervals. */
  let timer = null;
  function tick() {
    render(Date.now());
    if (reached) return;
    const delay = MS_SECOND - (Date.now() % MS_SECOND);
    timer = setTimeout(tick, delay + 4);
  }

  tick();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(timer);
    } else {
      clearTimeout(timer);
      render(Date.now());
      tick();
    }
  });
}

/* Expose the pure helpers for the Node test suite. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONFIG,
    parseLocalDate,
    breakdown,
    progressRatio,
    workingDays,
    hePlural,
  };
} else if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}