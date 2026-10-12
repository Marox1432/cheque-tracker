// Sends web-push alerts 5 days and 1 day before each cheque date (and on the day).
// Reads the published CSV of the Cheque Tracker sheet. Never prints payee names or amounts,
// because logs of a public repository are public.
import webpush from 'web-push';

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseCSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const dayNum = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 864e5);

export function parseCheques(csv) {
  const out = [];
  const rows = parseCSV(csv);
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i];
    if (!v || v.length < 5) continue;
    const m = String(v[2]).trim().match(/^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})$/);
    if (!m || !MON[m[2].toLowerCase()]) continue;
    const amount = parseFloat(String(v[4]).replace(/[^0-9.\-]/g, ''));
    if (isNaN(amount)) continue;
    out.push({
      no: String(v[1]).trim(),
      day: dayNum(+m[3], MON[m[2].toLowerCase()], +m[1]),
      payee: String(v[3]).replace(/\s+/g, ' ').trim(),
      amount,
      cancelled: /cancel/i.test(String(v[5] || ''))
    });
  }
  return out;
}

export function dubaiToday(now = new Date()) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = s.split('-').map(Number);
  return dayNum(y, m, d);
}

const fmtAED = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (n) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(n * 864e5));

export function buildAlerts(cheques, today) {
  const hits = cheques
    .filter((c) => !c.cancelled && [0, 1, 5].includes(c.day - today))
    .sort((a, b) => (a.day - b.day) || (+a.no - +b.no));
  if (!hits.length) return null;
  const lines = hits.map((c) => {
    const d = c.day - today;
    const when = d === 0 ? 'TODAY' : d === 1 ? 'TOMORROW' : 'in 5 days';
    const wd = new Date(c.day * 864e5).getUTCDay();
    const weekend = (wd === 0 || wd === 6) ? ' (weekend date, likely processed next working day)' : '';
    return `${when}: cheque ${c.no}, ${c.payee}, AED ${fmtAED(c.amount)}, ${fmtDay(c.day)}${weekend}`;
  });
  const total = hits.reduce((s, c) => s + c.amount, 0);
  const first = hits[0].day - today;
  const title = first === 0 ? 'Cheque debits today' : first === 1 ? 'Cheque debits tomorrow' : 'Cheque debit in 5 days';
  return { title, body: lines.join('\n') + `\nTotal AED ${fmtAED(total)}`, tag: 'cheque-' + today, count: hits.length };
}

// WHATSAPP_RECIPIENTS: one recipient per line, written phone:apikey, for example +971501234567:1234567
// (CallMeBot, https://www.callmebot.com/blog/free-api-whatsapp-messages/). The phone number and key are
// secrets, so this code never prints them or the request address.
export function parseRecipients(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.lastIndexOf(':');
    return i > 0 ? { phone: l.slice(0, i).replace(/\s+/g, ''), apikey: l.slice(i + 1).trim() } : null;
  }).filter((r) => r && r.phone && r.apikey);
}

export async function sendWhatsApp(recipients, text, doFetch = fetch) {
  let ok = 0;
  for (const [i, r] of recipients.entries()) {
    try {
      const q = new URLSearchParams({ phone: r.phone, text, apikey: r.apikey });
      const res = await doFetch('https://api.callmebot.com/whatsapp.php?' + q.toString());
      if (res.ok) ok++;
      else console.log(`WhatsApp recipient ${i + 1} failed (status ${res.status}).`);
    } catch {
      console.log(`WhatsApp recipient ${i + 1} failed (could not reach the WhatsApp service).`);
    }
  }
  return ok;
}

async function main() {
  const { SHEET_CSV_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTIONS, VAPID_SUBJECT, WHATSAPP_RECIPIENTS, TEST_ONLY, DRY_RUN } = process.env;
  if (!SHEET_CSV_URL) throw new Error('Missing secret SHEET_CSV_URL');

  let payload;
  if (TEST_ONLY === 'true') {
    payload = { title: 'Cheque Tracker test', body: 'Alerts are connected to this device.', tag: 'cheque-test', count: 0 };
  } else {
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error('Could not read the sheet, HTTP ' + res.status);
    const cheques = parseCheques(await res.text());
    if (!cheques.length) throw new Error('No cheques found in the sheet link. Check SHEET_CSV_URL.');
    console.log(`Read ${cheques.length} cheques.`);
    payload = buildAlerts(cheques, dubaiToday());
    if (!payload) { console.log('No cheque alerts today.'); return; }
  }

  if (DRY_RUN === 'true') { console.log(payload.title + '\n' + payload.body); return; }

  // --- WhatsApp (optional): used only when the WHATSAPP_RECIPIENTS secret exists ---
  const wa = parseRecipients(WHATSAPP_RECIPIENTS);
  let waSent = 0;
  if (wa.length) {
    waSent = await sendWhatsApp(wa, `*${payload.title}*\n${payload.body}`);
    console.log(`WhatsApp message sent to ${waSent} of ${wa.length} recipient(s).`);
  }

  // --- Phone and laptop notifications (optional when WhatsApp is set up) ---
  const subs = (PUSH_SUBSCRIPTIONS || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  let sent = 0;
  if (subs.length) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY');
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:alerts@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    for (const [i, sub] of subs.entries()) {
      try {
        await webpush.sendNotification(sub, JSON.stringify({ title: payload.title, body: payload.body, tag: payload.tag }), { TTL: 60 * 60 * 12, urgency: 'high' });
        sent++;
      } catch (err) {
        console.log(`Device ${i + 1} failed (status ${err.statusCode || 'unknown'}).` +
          (err.statusCode === 404 || err.statusCode === 410 ? ' This device subscription expired: turn notifications on again in the app and update PUSH_SUBSCRIPTIONS.' : ''));
      }
    }
    console.log(`Alert for ${payload.count} cheque(s) sent to ${sent} of ${subs.length} device(s).`);
  } else if (!wa.length) {
    throw new Error('Nothing to send to. Add PUSH_SUBSCRIPTIONS and/or WHATSAPP_RECIPIENTS.');
  }
  if (sent === 0 && waSent === 0) process.exit(1);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
