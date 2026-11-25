/* ============================================================
   ICS — export agenda (Apple Calendar, Outlook, Google Agenda)
   Aucune dépendance, aucun serveur : le fichier est généré
   dans le navigateur. Les rappels sont gérés par l'agenda de
   l'utilisateur, ce qui fonctionne sans backend (formule Spark).
============================================================ */

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function pad(n) { return String(n).padStart(2, '0'); }

/** 'AAAA-MM-JJ' → 'AAAAMMJJ' */
export function icsDate(key) { return key.replace(/-/g, ''); }

/** Date + 'HH:MM' → 'AAAAMMJJTHHMMSS' (heure locale « flottante »). */
export function icsLocal(key, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${icsDate(key)}T${pad(h)}${pad(m)}00`;
}

function utcStamp(d = new Date()) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Replie les lignes à 75 octets (RFC 5545) sans couper un caractère UTF-8. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // la ligne repliée commence par un espace
    if (bytes + b > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function byDay(writingDays) {
  return (writingDays || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => BYDAY[d]).join(',');
}

/** Lendemain d'un jour 'AAAA-MM-JJ', au format 'AAAAMMJJ' (fin exclusive d'un évènement « journée entière »). */
function dayAfter(key) {
  const [y, m, d] = key.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
}

/**
 * events : [{
 *   uid, title, description, url,
 *   date: 'AAAA-MM-JJ'            (évènement « journée entière » ; dateEnd = dernier jour inclus d'une période)
 *   | start: 'AAAA-MM-JJ', time: 'HH:MM', minutes: 90,
 *   rrule: 'FREQ=WEEKLY;…',
 *   alarms: [{ trigger: '-PT10M', text }]
 * }]
 */
export function buildICS(calName, events) {
  const stamp = utcStamp();
  const seq = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000);
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Le Journal de Bord//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(calName),
  ];
  for (const ev of events) {
    L.push('BEGIN:VEVENT');
    L.push('UID:' + ev.uid);
    L.push('DTSTAMP:' + stamp);
    L.push('SEQUENCE:' + seq);
    if (ev.date) {
      L.push('DTSTART;VALUE=DATE:' + icsDate(ev.date));
      L.push('DTEND;VALUE=DATE:' + dayAfter(ev.dateEnd || ev.date));
      L.push('TRANSP:TRANSPARENT');
    } else {
      // Séance d'écriture : la fin est plafonnée à 23h59 le même jour
      const [h, mi] = ev.time.split(':').map(Number);
      const endMin = Math.min(1439, h * 60 + mi + (ev.minutes || 60));
      L.push('DTSTART:' + icsLocal(ev.start, ev.time));
      L.push('DTEND:' + icsLocal(ev.start, `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`));
    }
    if (ev.rrule) L.push('RRULE:' + ev.rrule);
    L.push('SUMMARY:' + escapeText(ev.title));
    if (ev.description) L.push('DESCRIPTION:' + escapeText(ev.description));
    if (ev.url) L.push('URL:' + ev.url);
    for (const a of ev.alarms || []) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escapeText(a.text || ev.title), 'TRIGGER:' + a.trigger, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/** Lien « Ajouter à Google Agenda » (un évènement, récurrent ou non). */
export function googleCalendarUrl({ title, details, start, time, minutes, date, dateEnd, rrule }) {
  const p = new URLSearchParams();
  p.set('action', 'TEMPLATE');
  p.set('text', title);
  if (date) {
    p.set('dates', `${icsDate(date)}/${dayAfter(dateEnd || date)}`);
  } else {
    const [h, mi] = time.split(':').map(Number);
    const endMin = Math.min(1439, h * 60 + mi + (minutes || 60));
    p.set('dates', `${icsLocal(start, time)}/${icsLocal(start, `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`)}`);
    try { p.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'); } catch { p.set('ctz', 'Europe/Paris'); }
  }
  if (rrule) p.set('recur', 'RRULE:' + rrule);
  if (details) p.set('details', details);
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
