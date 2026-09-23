/*
 * Ώρες δουλειάς — η λογική του υπολογισμού.
 *
 * Οι αυτοματισμοί του iPhone γράφουν στο ores.txt μία γραμμή σε κάθε
 * σύνδεση / αποσύνδεση από το Wi‑Fi της δουλειάς, π.χ.
 *   2026-09-23 08:02:11 IN
 *   2026-09-23 16:10:45 OUT
 * Από αυτές βγαίνει, για κάθε μέρα, η πρώτη σύνδεση και η τελευταία αποσύνδεση.
 *
 * Το ίδιο αρχείο το φορτώνει η σελίδα (window.Ores) και τα tests (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ores = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;

  // Μετά από αποσύνδεση, τόσο κενό σημαίνει ότι η μέρα δουλειάς τελείωσε.
  // Έχει σημασία μόνο για βάρδιες που περνούν τα μεσάνυχτα· μέσα στην ίδια
  // ημερολογιακή μέρα όλες οι συνδέσεις ενώνονται έτσι κι αλλιώς.
  const GAP_AFTER_OUT = 5 * HOUR;
  // Αν λείπει η αποσύνδεση (π.χ. έκλεισε το κινητό), μετά από τόσο κενό αρχίζει νέα μέρα.
  const GAP_AFTER_IN = 16 * HOUR;
  // Μέρα χωρίς αποσύνδεση θεωρείται «σε εξέλιξη» μόνο για τόσο μετά την τελευταία σύνδεση.
  const OPEN_LIMIT = 16 * HOUR;
  // Το διάλειμμα αφαιρείται μόνο από μέρες μεγαλύτερες από αυτό (λεπτά).
  const BREAK_AFTER_MIN = 4 * 60;

  const WEEKDAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
  const WEEKDAYS_SHORT = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ'];
  const MONTHS_NOM = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
    'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
  const MONTHS_GEN = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου',
    'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];

  const pad2 = n => String(n).padStart(2, '0');
  // Πεζά, χωρίς τόνους, με «σ» αντί για «ς» — για συγκρίσεις λέξεων.
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');

  /* ---------- Ημερομηνίες (πάντα τοπική ώρα του κινητού) ---------- */

  function dateKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function keyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(key, n) {
    const d = keyToDate(key);
    d.setDate(d.getDate() + n);
    return dateKey(d.getTime());
  }
  function atTime(key, hhmm) {
    const d = keyToDate(key);
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  // Εβδομάδα Δευτέρα–Κυριακή που περιέχει τη μέρα.
  function weekRange(key) {
    const back = (keyToDate(key).getDay() + 6) % 7;
    const mon = addDays(key, -back);
    return [mon, addDays(mon, 6)];
  }

  /* ---------- Ανάγνωση του αρχείου ---------- */

  const MONTH_PREFIX = {
    'ιαν': 1, 'φεβ': 2, 'μαρ': 3, 'απρ': 4, 'μαι': 5, 'ιουν': 6, 'ιουλ': 7, 'αυγ': 8,
    'σεπ': 9, 'οκτ': 10, 'νοε': 11, 'δεκ': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
  };
  function monthFromName(word) {
    const w = norm(word);
    return MONTH_PREFIX[w.slice(0, 4)] || MONTH_PREFIX[w.slice(0, 3)] || 0;
  }

  // Η ώρα, και ό,τι μπορεί να μπει ανάμεσα σε ημερομηνία και ώρα.
  const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:[.,]\d{1,6})?`;
  const AMPM = String.raw`(?:\s*(π\.?\s?μ\.?|μ\.?\s?μ\.?|[ap]\.?\s?m\.?))?`;
  const GLUE = String.raw`[\sT,]*(?:στις\s+|at\s+|-\s+)?`;
  // Δέχεται τη μορφή που προτείνουν οι οδηγίες, αλλά και τις προεπιλογές
  // του iPhone, για την περίπτωση που δεν ρυθμίστηκε η μορφή ημερομηνίας.
  const PATTERNS = [
    { // 2026-09-23 08:02:11 · 2026-09-23T08:02:11+03:00
      re: new RegExp(String.raw`(\d{4})-(\d{1,2})-(\d{1,2})` + GLUE + TIME + String.raw`(?:Z|[+-]\d{2}:?\d{2})?` + AMPM, 'iu'),
      parts: m => [m[1], m[2], m[3], m[4], m[5], m[6], m[7]],
    },
    { // 23/9/26, 08:02 · 23.09.2026 8:02:11 μ.μ.
      re: new RegExp(String.raw`(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})` + GLUE + TIME + AMPM, 'iu'),
      parts: m => [m[3], m[2], m[1], m[4], m[5], m[6], m[7]],
    },
    { // 23 Σεπ 2026 στις 8:02 π.μ. · Wed, 23 Sep 2026 08:02:11 +0300
      re: new RegExp(String.raw`(\d{1,2})\s+([\p{L}\p{M}]+)\.?,?\s+(\d{4})` + GLUE + TIME + AMPM, 'iu'),
      parts: m => [m[3], monthFromName(m[2]), m[1], m[4], m[5], m[6], m[7]],
    },
    { // Sep 23, 2026 at 8:02 AM
      re: new RegExp(String.raw`([\p{L}\p{M}]+)\.?\s+(\d{1,2}),?\s+(\d{4})` + GLUE + TIME + AMPM, 'iu'),
      parts: m => [m[3], monthFromName(m[1]), m[2], m[4], m[5], m[6], m[7]],
    },
  ];

  function makeTime([y, mo, d, h, mi, s, ampm]) {
    y = +y; mo = +mo; d = +d; h = +h; mi = +mi; s = +(s || 0);
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]; // μήνας/μέρα ανάποδα (αμερικάνικη μορφή)
    if (ampm) {
      const pm = ['μμ', 'pm'].includes(norm(ampm).replace(/[.\s]/g, ''));
      if (h > 12) return null;
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && s <= 59)) return null;
    const date = new Date(y, mo - 1, d, h, mi, s);
    if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date.getTime();
  }

  // Όλες οι χρονοσφραγίδες μιας γραμμής (αν λείπουν αλλαγές γραμμής, μπορεί να είναι πολλές).
  function findStamps(line) {
    const found = [];
    let pos = 0;
    while (pos < line.length) {
      let best = null;
      const rest = line.slice(pos);
      for (const p of PATTERNS) {
        const m = p.re.exec(rest);
        if (!m) continue;
        const t = makeTime(p.parts(m));
        if (t == null) continue;
        const start = pos + m.index;
        if (!best || start < best.start) best = { t, start, end: start + m[0].length };
      }
      if (!best) break;
      found.push(best);
      pos = best.end;
    }
    return found;
  }

  const IN_WORDS = new Set(['in', 'join', 'joins', 'joined', 'arrive', 'arrived', 'arrival',
    'εισοδοσ', 'μπηκα', 'μπηκε', 'εφτασα', 'εφτασε', 'αφιξη', 'συνδεση', 'συνδεθηκα', 'συνδεθηκε', 'μεσα']);
  const OUT_WORDS = new Set(['out', 'leave', 'leaves', 'left', 'exit',
    'εξοδοσ', 'βγηκα', 'βγηκε', 'εφυγα', 'εφυγε', 'αναχωρηση', 'αποσυνδεση', 'αποσυνδεθηκα', 'αποσυνδεθηκε', 'εξω']);

  function typeIn(segment, fromEnd) {
    const words = norm(segment).match(/\p{L}+/gu) || [];
    if (fromEnd) words.reverse();
    for (const w of words) {
      if (IN_WORDS.has(w)) return 'in';
      if (OUT_WORDS.has(w)) return 'out';
    }
    return null;
  }

  function normalizeEvents(list) {
    const seen = new Set();
    const out = [];
    for (const e of list) {
      const id = e.t + e.type;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ t: e.t, type: e.type });
    }
    return out.sort((a, b) => a.t - b.t || (a.type === b.type ? 0 : a.type === 'in' ? -1 : 1));
  }

  function parseLog(text) {
    const events = [];
    const bad = [];
    for (const raw of String(text == null ? '' : text).split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const stamps = findStamps(line);
      if (!stamps.length) {
        if (line[0] !== '#') bad.push(line);
        continue;
      }
      stamps.forEach((s, i) => {
        const next = stamps[i + 1];
        let type = typeIn(line.slice(s.end, next ? next.start : line.length), false);
        if (!type && i === 0) type = typeIn(line.slice(0, s.start), true);
        if (type) events.push({ t: s.t, type });
        else if (!bad.includes(line)) bad.push(line);
      });
    }
    return { events: normalizeEvents(events), bad };
  }

  const mergeEvents = (a, b) => normalizeEvents(a.concat(b));

  function fmtStamp(ms) {
    const d = new Date(ms);
    return `${dateKey(ms)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  const serializeEvents = events => events.map(e => `${fmtStamp(e.t)} ${e.type === 'in' ? 'IN' : 'OUT'}`).join('\n');

  // Το URL που ανοίγει η συντόμευση: https://…/#log=<κείμενο κωδικοποιημένο ως URL>
  function decodeHash(hash) {
    let s = String(hash == null ? '' : hash).replace(/^#/, '').replace(/^(?:log|ores|data)=/i, '');
    // Κάποιες φορές το κείμενο κωδικοποιείται δύο φορές (π.χ. %2520) — ξεδιπλώνουμε.
    for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(s); i++) {
      let d;
      try { d = decodeURIComponent(s.replace(/\+/g, '%20')); } catch (e) { break; }
      if (d === s) break;
      s = d;
    }
    return s;
  }

  /* ---------- Αργίες ---------- */

  // Ορθόδοξο Πάσχα: αλγόριθμος Meeus (ιουλιανό) + 13 μέρες (ισχύει 1900–2099).
  function orthodoxEaster(year) {
    const a = year % 4;
    const b = year % 7;
    const c = year % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31);
    const day = ((d + e + 114) % 31) + 1;
    return dateKey(new Date(year, month - 1, day + 13).getTime());
  }
  const holidayCache = {};
  function holidaysOf(year) {
    if (holidayCache[year]) return holidayCache[year];
    const easter = orthodoxEaster(year);
    return (holidayCache[year] = {
      [`${year}-01-01`]: 'Πρωτοχρονιά',
      [`${year}-01-06`]: 'Θεοφάνεια',
      [addDays(easter, -48)]: 'Καθαρά Δευτέρα',
      [`${year}-03-25`]: '25η Μαρτίου',
      [addDays(easter, -2)]: 'Μεγάλη Παρασκευή',
      [easter]: 'Πάσχα',
      [addDays(easter, 1)]: 'Δευτέρα του Πάσχα',
      [`${year}-05-01`]: 'Πρωτομαγιά',
      [addDays(easter, 50)]: 'Αγίου Πνεύματος',
      [`${year}-08-15`]: 'Δεκαπενταύγουστος',
      [`${year}-10-28`]: '28η Οκτωβρίου',
      [`${year}-12-25`]: 'Χριστούγεννα',
      [`${year}-12-26`]: 'Σύναξη της Θεοτόκου',
    });
  }
  const holidayName = key => holidaysOf(+key.slice(0, 4))[key] || null;

  /* ---------- Υπολογισμός ωρών ---------- */

  // Χωρίζει τις καταγραφές σε «μέρες δουλειάς». Κάθε ομάδα ανήκει στη μέρα που
  // ξεκίνησε, ώστε μια βάρδια 22:00–06:00 να μετράει στην πρώτη μέρα.
  function groupWorkdays(events) {
    const byDay = new Map();
    let group = null;
    for (const e of events) {
      const prev = group && group[group.length - 1];
      if (!prev || e.t - prev.t > (prev.type === 'out' ? GAP_AFTER_OUT : GAP_AFTER_IN)) {
        group = [];
        const key = dateKey(e.t);
        byDay.set(key, byDay.get(key) || []);
        group.day = byDay.get(key);
      }
      group.push(e);
      group.day.push(e);
    }
    return byDay;
  }

  /**
   * Μία εγγραφή ανά μέρα: πρώτη σύνδεση → τελευταία αποσύνδεση.
   * status: ok | open (είναι ακόμα στη δουλειά) | no-end (λείπει η αποσύνδεση)
   *         | no-start (λείπει η σύνδεση) | off (ο χρήστης είπε να μη μετράει)
   * overrides: { 'YYYY-MM-DD': { start: 'HH:MM', end: 'HH:MM', off: true } }
   */
  function buildDays(events, opts) {
    opts = opts || {};
    const now = opts.now != null ? opts.now : Date.now();
    const overrides = opts.overrides || {};
    const breakMin = Math.max(0, +opts.breakMin || 0);
    const targetMin = Math.max(0, +opts.targetMin || 0);
    const byDay = groupWorkdays(events);
    const lastEvent = events[events.length - 1];
    for (const key of Object.keys(overrides)) if (!byDay.has(key)) byDay.set(key, []);

    const days = [];
    for (const [key, evs] of byDay) {
      const firstIn = evs.find(e => e.type === 'in');
      const last = evs[evs.length - 1];
      let start = firstIn ? firstIn.t : null;
      let end = null;
      let open = false;
      let partial = false;

      if (last && last.type === 'out') {
        end = last.t;
      } else if (last) {
        // Η τελευταία καταγραφή είναι σύνδεση: ή είναι ακόμα εκεί, ή χάθηκε η αποσύνδεση.
        if (last === lastEvent && now >= last.t && now - last.t < OPEN_LIMIT) {
          open = true;
          end = now;
        } else {
          const lastOut = evs.filter(e => e.type === 'out' && e.t > start).pop();
          if (lastOut) { end = lastOut.t; partial = true; }
        }
      }

      const ov = overrides[key];
      if (ov) {
        if (ov.start) start = atTime(key, ov.start);
        if (ov.end) {
          end = atTime(key, ov.end);
          if (start != null && end <= start) end += 24 * HOUR; // τελείωσε μετά τα μεσάνυχτα
          open = false;
          partial = false;
        }
      }

      let status;
      if (ov && ov.off) status = 'off';
      else if (start == null) status = 'no-start';
      else if (open) status = 'open';
      else if (end == null || end <= start || partial) status = 'no-end';
      else status = 'ok';

      let minutes = null;
      let breakApplied = 0;
      let overtime = 0;
      if (status !== 'off' && start != null && end != null && end > start) {
        minutes = Math.round((end - start) / MIN);
        if (breakMin && minutes > BREAK_AFTER_MIN) {
          minutes -= breakMin;
          breakApplied = breakMin;
        }
        if (targetMin) overtime = Math.max(0, minutes - targetMin);
      }

      days.push({
        key, events: evs, start, end, minutes, status, partial, edited: !!ov, breakApplied, overtime,
        sunday: keyToDate(key).getDay() === 0,
        holiday: holidayName(key),
      });
    }
    return days.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  // Σύνολα για τις μέρες από..έως (κλειδιά YYYY-MM-DD, συμπεριλαμβάνονται και τα δύο).
  function summarize(days, fromKey, toKey) {
    let minutes = 0;
    let count = 0;
    let overtime = 0;
    let special = 0;
    let specialDays = 0;
    let closed = 0;
    let closedCount = 0;
    for (const d of days) {
      if (d.key < fromKey || d.key > toKey || d.minutes == null) continue;
      minutes += d.minutes;
      overtime += d.overtime;
      count++;
      if (d.sunday || d.holiday) { special += d.minutes; specialDays++; }
      if (d.status !== 'open') { closed += d.minutes; closedCount++; }
    }
    // Ο μέσος όρος μόνο από τελειωμένες μέρες, για να μην τον ρίχνει η σημερινή.
    const average = closedCount ? Math.round(closed / closedCount) : count ? Math.round(minutes / count) : 0;
    return { minutes, days: count, overtime, special, specialDays, average };
  }

  /* ---------- Έξυπνες προτάσεις και έλεγχος ρύθμισης ---------- */

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // Οι συνηθισμένες ώρες του (διάμεσος των γύρω εβδομάδων), προτιμώντας
  // την ίδια μέρα της εβδομάδας — τα Σάββατα π.χ. μπορεί να σχολάει νωρίτερα.
  function typicalTimes(days, forKey) {
    const from = addDays(forKey, -56);
    const to = addDays(forKey, 56);
    let pool = days.filter(d => d.status === 'ok' && d.key !== forKey && d.key >= from && d.key <= to);
    const weekday = keyToDate(forKey).getDay();
    const sameWeekday = pool.filter(d => keyToDate(d.key).getDay() === weekday);
    if (sameWeekday.length >= 3) pool = sameWeekday;
    if (pool.length < 3) return null;
    const midnight = d => keyToDate(d.key).getTime();
    return {
      start: median(pool.map(d => (d.start - midnight(d)) / MIN)), // λεπτά από τα μεσάνυχτα
      end: median(pool.map(d => (d.end - midnight(d)) / MIN)),
      length: median(pool.map(d => (d.end - d.start) / MIN)),
      samples: pool.length,
      sameWeekday: pool === sameWeekday,
    };
  }

  // Για μέρα που της λείπει η άφιξη ή η αναχώρηση: ποια ώρα να προτείνουμε.
  function suggestFix(day, typical) {
    if (!typical || !day) return null;
    const midnight = keyToDate(day.key).getTime();
    const seen = day.events.map(e => e.t);
    if (day.status === 'no-end' && day.start != null) {
      let end = midnight + typical.end * MIN;
      if (end <= day.start) end = day.start + typical.length * MIN;
      end = Math.max(end, ...seen); // όχι πριν από την τελευταία καταγραφή
      return { field: 'end', time: fmtClock(end), nextDay: dateKey(end) !== day.key };
    }
    if (day.status === 'no-start' && day.end != null) {
      let start = midnight + typical.start * MIN;
      if (start >= day.end) start = day.end - typical.length * MIN;
      if (seen.length) start = Math.min(start, ...seen); // όχι μετά την πρώτη καταγραφή
      if (dateKey(start) !== day.key) return null;
      return { field: 'start', time: fmtClock(start) };
    }
    return null;
  }

  /**
   * Βρίσκει προβλήματα στη ρύθμιση του iPhone από το ίδιο το αρχείο,
   * ώστε να λέμε στον χρήστη τι ακριβώς να διορθώσει.
   */
  function diagnose({ events, days, bad = [], now = Date.now() }) {
    const issues = [];
    const example = bad.length ? `«${bad[0].slice(0, 60)}»` : '';
    if (bad.length && !events.length) {
      issues.push({ id: 'format', level: 'error', fix: 'format',
        title: 'Οι γραμμές του αρχείου δεν διαβάζονται',
        text: `Η εφαρμογή βλέπει γραμμές όπως ${example}. Στους δύο αυτοματισμούς, πάτα πάνω στην «Τρέχουσα ημερομηνία» → Μορφή ημερομηνίας → Προσαρμοσμένη → yyyy-MM-dd HH:mm:ss, και μετά από ένα κενό να γράφει IN ή OUT.` });
    } else if (bad.length) {
      issues.push({ id: 'format-some', level: 'info', fix: 'format',
        title: bad.length === 1 ? '1 γραμμή δεν διαβάστηκε' : `${bad.length} γραμμές δεν διαβάστηκαν`,
        text: `Οι υπόλοιπες μετράνε κανονικά. Π.χ. ${example}.` });
    }
    if (!events.length) return issues;

    const ins = events.filter(e => e.type === 'in').length;
    const outs = events.length - ins;
    const sinceFirst = now - events[0].t;
    if (!outs && sinceFirst > 20 * HOUR) {
      issues.push({ id: 'no-out', level: 'error', fix: 'out',
        title: 'Δεν έχει γραφτεί ποτέ ώρα αναχώρησης',
        text: 'Ο αυτοματισμός «Έφυγα» μάλλον δεν τρέχει. Έλεγξε ότι έχει επιλεγμένο το «Αποσυνδέεται», ότι είναι στο «Εκτέλεση αμέσως» και ότι γράφει OUT στο ίδιο αρχείο ores.txt.' });
    }
    if (!ins && sinceFirst > 20 * HOUR) {
      issues.push({ id: 'no-in', level: 'error', fix: 'in',
        title: 'Δεν έχει γραφτεί ποτέ ώρα άφιξης',
        text: 'Ο αυτοματισμός «Έφτασα» μάλλον δεν τρέχει. Έλεγξε ότι έχει επιλεγμένο το «Συνδέεται», ότι είναι στο «Εκτέλεση αμέσως» και ότι γράφει IN στο ίδιο αρχείο ores.txt.' });
    }

    // IN/OUT ανάποδα: τα πρωινά γράφεται αποσύνδεση και τα απογεύματα σύνδεση.
    const calendarDays = new Map();
    for (const e of events) {
      const k = dateKey(e.t);
      if (!calendarDays.has(k)) calendarDays.set(k, []);
      calendarDays.get(k).push(e);
    }
    const multi = [...calendarDays.values()].filter(list => list.length >= 2);
    const swapped = multi.filter(list => list[0].type === 'out' && list[list.length - 1].type === 'in');
    if (ins && outs && swapped.length >= 2 && swapped.length >= multi.length * 0.6) {
      issues.push({ id: 'swapped', level: 'error', fix: 'in',
        title: 'Μάλλον μπερδεύτηκαν τα IN και OUT',
        text: 'Τις περισσότερες μέρες η πρώτη καταγραφή είναι αναχώρηση και η τελευταία άφιξη. Ο αυτοματισμός «Συνδέεται» πρέπει να γράφει IN και ο «Αποσυνδέεται» OUT.' });
      return issues;
    }

    const today = dateKey(now);
    const recent = days.filter(d => d.key < today && d.status !== 'off' && !d.edited).slice(-5);
    if (outs && recent.length >= 3 && recent.filter(d => d.status === 'no-end').length >= 3) {
      issues.push({ id: 'often-no-end', level: 'warn', fix: 'out',
        title: 'Συχνά λείπει η ώρα αναχώρησης',
        text: 'Τις τελευταίες μέρες δεν γράφτηκε πότε έφυγες. Έλεγξε ότι ο αυτοματισμός «Έφυγα» είναι στο «Εκτέλεση αμέσως» (όχι «Ερώτηση πριν την εκτέλεση») και ότι το κινητό δεν κλείνει στη δουλειά.' });
    }
    if (ins && recent.length >= 3 && recent.filter(d => d.status === 'no-start').length >= 3) {
      issues.push({ id: 'often-no-start', level: 'warn', fix: 'in',
        title: 'Συχνά λείπει η ώρα άφιξης',
        text: 'Τις τελευταίες μέρες δεν γράφτηκε πότε ήρθες. Έλεγξε ότι ο αυτοματισμός «Έφτασα» είναι στο «Εκτέλεση αμέσως» και ότι το Wi‑Fi του κινητού μένει ανοιχτό.' });
    }
    return issues;
  }

  /* ---------- Μορφοποίηση ---------- */

  function fmtDur(min) {
    if (min == null) return '—';
    const sign = min < 0 ? '−' : '';
    const a = Math.abs(Math.round(min));
    const h = Math.floor(a / 60);
    return h ? `${sign}${h}ω ${pad2(a % 60)}λ` : `${sign}${a % 60}λ`;
  }
  // 8:05 — για λογιστικά φύλλα
  function fmtHM(min) {
    const a = Math.round(min || 0);
    return `${Math.floor(a / 60)}:${pad2(a % 60)}`;
  }
  const fmtDecimal = min => ((min || 0) / 60).toFixed(2).replace('.', ',');
  function fmtClock(ms) {
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  // Ώρα αναχώρησης, με «(+1)» αν ήταν την επόμενη μέρα.
  function fmtEnd(day) {
    if (day.end == null) return '';
    return fmtClock(day.end) + (dateKey(day.end) !== day.key ? ' (+1)' : '');
  }

  const STATUS_NOTE = {
    'open': 'σε εξέλιξη',
    'no-end': 'λείπει η τελευταία αποσύνδεση',
    'no-start': 'λείπει η πρώτη σύνδεση',
    'off': 'δεν μετράει',
  };
  function dayNote(day) {
    const notes = [];
    if (day.holiday) notes.push(`αργία (${day.holiday})`);
    else if (day.sunday) notes.push('Κυριακή');
    if (STATUS_NOTE[day.status]) notes.push(STATUS_NOTE[day.status]);
    if (day.edited) notes.push('διορθώθηκε με το χέρι');
    if (day.breakApplied) notes.push(`αφαιρέθηκαν ${day.breakApplied}′ διάλειμμα`);
    return notes.join(', ');
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  // Με «;» και δεκαδικό κόμμα, όπως τα θέλει το ελληνικό Excel.
  function toCSV(days) {
    const rows = [['Ημερομηνία', 'Ημέρα', 'Άφιξη', 'Αναχώρηση', 'Διάρκεια', 'Ώρες (δεκαδικές)', 'Υπερωρία', 'Σημείωση']];
    let total = 0;
    let overtime = 0;
    for (const d of days) {
      const [y, m, dd] = d.key.split('-');
      rows.push([
        `${dd}/${m}/${y}`,
        WEEKDAYS[keyToDate(d.key).getDay()],
        d.start != null ? fmtClock(d.start) : '',
        d.status === 'open' ? '' : fmtEnd(d),
        d.minutes != null ? fmtHM(d.minutes) : '',
        d.minutes != null ? fmtDecimal(d.minutes) : '',
        d.overtime ? fmtHM(d.overtime) : '',
        dayNote(d),
      ]);
      if (d.minutes != null) { total += d.minutes; overtime += d.overtime; }
    }
    rows.push([]);
    rows.push(['Σύνολο', '', '', '', fmtHM(total), fmtDecimal(total), fmtHM(overtime), '']);
    return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }

  return {
    MIN, HOUR, OPEN_LIMIT, BREAK_AFTER_MIN,
    WEEKDAYS, WEEKDAYS_SHORT, MONTHS_NOM, MONTHS_GEN,
    dateKey, keyToDate, addDays, atTime, weekRange, orthodoxEaster, holidayName,
    parseLog, normalizeEvents, mergeEvents, serializeEvents, decodeHash,
    buildDays, summarize, typicalTimes, suggestFix, diagnose,
    fmtDur, fmtHM, fmtDecimal, fmtClock, fmtEnd, fmtStamp, dayNote, toCSV,
  };
});
