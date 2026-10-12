/**
 * Cheque Tracker: add-a-cheque endpoint.
 *
 * Paste this into the Google Sheet that holds your cheques:
 *   Extensions > Apps Script > replace everything in Code.gs > Save.
 * Then set SECRET below, and deploy it as a web app (see README.md, "Add cheques from the app").
 *
 * The app sends one request per change: add, edit, cancel, restore or delete a cheque. This script
 * checks the secret word, validates the values, refuses duplicates, and writes the row with the
 * same formulas as your other rows.
 */

// 1. Change this to a long secret word of your own (letters and numbers, no spaces).
//    Type the same word into the app under Setup, "Add cheques from the app".
var SECRET = 'CHANGE-ME';

var SHEET_NAME = 'Cheque Tracker';
var DATE_FORMAT = 'dd-mmm-yyyy';
var AMOUNT_FORMAT = '#,##0.00';

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (SECRET === 'CHANGE-ME' || SECRET.length < 8) {
      return reply_({ ok: false, error: 'script_not_ready', message: 'Set a secret word in the script first.' });
    }
    if (String(body.secret || '') !== SECRET) {
      return reply_({ ok: false, error: 'bad_secret', message: 'The secret word does not match.' });
    }
    lock.waitLock(20000);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return reply_({ ok: false, error: 'no_sheet', message: 'No tab named "' + SHEET_NAME + '".' });
    var action = String(body.action || 'add');
    var result = action === 'add' ? addCheque_(sheet, body)
      : action === 'update' ? updateCheque_(sheet, body)
      : action === 'cancel' ? setCancelled_(sheet, body, true)
      : action === 'restore' ? setCancelled_(sheet, body, false)
      : action === 'delete' ? deleteCheque_(sheet, body)
      : { ok: false, error: 'bad_action', message: 'Unknown action.' };
    return reply_(result);
  } catch (err) {
    return reply_({ ok: false, error: 'failed', message: 'Something went wrong while saving.' });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// Lets you open the web app address in a browser to check that it is deployed.
function doGet() {
  return reply_({ ok: true, message: 'Cheque Tracker add-cheque link is working.' });
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function toSerial_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3];
  var c = new Date(Date.UTC(y, mo - 1, d));
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d || y < 2000 || y > 2100) return null;
  return Math.round(c.getTime() / 86400000) + 25569;
}

/** Finds the sheet row of a cheque by cheque number and date. Returns 0 if absent. */
function findRow_(values, no, serial, skipRow) {
  for (var i = 1; i < values.length; i++) {
    if (i + 1 === skipRow) continue;
    if (String(values[i][1]).trim() === String(no) && Number(values[i][2]) === serial) return i + 1;
  }
  return 0;
}

function readValues_(sheet) {
  return sheet.getRange('A1:F' + sheet.getMaxRows()).getValues();
}

/** Changes the details of one cheque. body.orig = { chequeNo, date } says which cheque. */
function updateCheque_(sheet, body) {
  var o = body.orig || {};
  var oserial = toSerial_(o.date), onum = String(o.chequeNo == null ? '' : o.chequeNo).trim();
  if (oserial === null || !onum) return { ok: false, error: 'bad_orig', message: 'Could not tell which cheque to change.' };
  var no = String(body.chequeNo == null ? '' : body.chequeNo).trim();
  var payee = String(body.payee == null ? '' : body.payee).replace(/\s+/g, ' ').trim();
  var remarks = String(body.remarks == null ? '' : body.remarks).replace(/\s+/g, ' ').trim();
  var amount = Number(body.amount), serial = toSerial_(body.date);
  if (!/^[0-9A-Za-z\-]{1,20}$/.test(no)) return { ok: false, error: 'bad_cheque_no', message: 'Enter a cheque number.' };
  if (!payee || payee.length > 120) return { ok: false, error: 'bad_payee', message: 'Enter who the cheque is for.' };
  if (!isFinite(amount) || amount <= 0 || amount > 1e9) return { ok: false, error: 'bad_amount', message: 'Enter an amount above zero.' };
  if (remarks.length > 200) return { ok: false, error: 'bad_remarks', message: 'Remarks are too long.' };
  if (serial === null) return { ok: false, error: 'bad_date', message: 'Choose the cheque date.' };
  var values = readValues_(sheet);
  var r = findRow_(values, onum, oserial, 0);
  if (!r) return { ok: false, error: 'not_found', message: 'That cheque is no longer in the sheet. Tap Refresh.' };
  if (findRow_(values, no, serial, r)) return { ok: false, error: 'duplicate', message: 'Cheque ' + no + ' on that date is already in the sheet.' };
  sheet.getRange(r, 2, 1, 5).setValues([[no, serial, payee, amount, remarks]]);
  return { ok: true, row: r };
}

/** Marks a cheque Cancelled (alerts stop), or clears that mark. */
function setCancelled_(sheet, body, cancel) {
  var serial = toSerial_(body.date), no = String(body.chequeNo == null ? '' : body.chequeNo).trim();
  if (serial === null || !no) return { ok: false, error: 'bad_orig', message: 'Could not tell which cheque to change.' };
  var r = findRow_(readValues_(sheet), no, serial, 0);
  if (!r) return { ok: false, error: 'not_found', message: 'That cheque is no longer in the sheet. Tap Refresh.' };
  sheet.getRange(r, 6).setValue(cancel ? 'Cancelled' : '');
  return { ok: true, row: r };
}

/** Removes the row of a cheque that was entered by mistake. */
function deleteCheque_(sheet, body) {
  var serial = toSerial_(body.date), no = String(body.chequeNo == null ? '' : body.chequeNo).trim();
  if (serial === null || !no) return { ok: false, error: 'bad_orig', message: 'Could not tell which cheque to remove.' };
  var r = findRow_(readValues_(sheet), no, serial, 0);
  if (!r) return { ok: false, error: 'not_found', message: 'That cheque is no longer in the sheet. Tap Refresh.' };
  sheet.deleteRow(r);
  return { ok: true, row: r };
}

/** Validates the request and writes the row. `sheet` only needs the few Sheet methods used below. */
function addCheque_(sheet, body) {
  var no = String(body.chequeNo == null ? '' : body.chequeNo).trim();
  var payee = String(body.payee == null ? '' : body.payee).replace(/\s+/g, ' ').trim();
  var remarks = String(body.remarks == null ? '' : body.remarks).replace(/\s+/g, ' ').trim();
  var amount = Number(body.amount);
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.date || ''));

  if (!/^[0-9A-Za-z\-]{1,20}$/.test(no)) return { ok: false, error: 'bad_cheque_no', message: 'Enter a cheque number.' };
  if (!payee || payee.length > 120) return { ok: false, error: 'bad_payee', message: 'Enter who the cheque is for.' };
  if (!isFinite(amount) || amount <= 0 || amount > 1e9) return { ok: false, error: 'bad_amount', message: 'Enter an amount above zero.' };
  if (remarks.length > 200) return { ok: false, error: 'bad_remarks', message: 'Remarks are too long.' };
  if (!m) return { ok: false, error: 'bad_date', message: 'Choose the cheque date.' };
  var y = +m[1], mo = +m[2], d = +m[3];
  var check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || y < 2000 || y > 2100) {
    return { ok: false, error: 'bad_date', message: 'That date does not exist.' };
  }
  // Sheets stores dates as a day count since 30 Dec 1899.
  var serial = Math.round(Date.UTC(y, mo - 1, d) / 86400000) + 25569;

  var values = sheet.getRange('A1:F' + sheet.getMaxRows()).getValues();
  var last = 1, maxSn = 0;
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var hasData = row[1] !== '' || row[2] !== '' || row[3] !== '' || row[4] !== '';
    if (hasData) {
      last = i + 1;
      if (typeof row[0] === 'number' && row[0] > maxSn) maxSn = row[0];
      if (String(row[1]).trim() === no && Number(row[2]) === serial) {
        return { ok: false, error: 'duplicate', message: 'Cheque ' + no + ' on that date is already in the sheet.' };
      }
    }
  }
  var r = last + 1;

  // Copy the look of a row with the same banding (two rows up), then write the values.
  var src = r - 2 >= 2 ? r - 2 : last;
  if (src >= 2) {
    sheet.getRange(src, 1, 1, 8).copyTo(sheet.getRange(r, 1, 1, 8), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  sheet.getRange(r, 1, 1, 6).setValues([[maxSn + 1, no, serial, payee, amount, remarks]]);
  sheet.getRange(r, 3).setNumberFormat(DATE_FORMAT);
  sheet.getRange(r, 5).setNumberFormat(AMOUNT_FORMAT);
  sheet.getRange(r, 7, 1, 2).setFormulas([[
    '=IF(OR(C' + r + '="",F' + r + '="Cancelled"),"",C' + r + '-INT(NOW()+4/24))',
    '=IF(C' + r + '="","",IF(F' + r + '="Cancelled","Cancelled",IF(G' + r + '<0,"Debited",IF(G' + r + '=0,"Due today",IF(G' + r + '<=1,"Due in 1 day",IF(G' + r + '<=5,"Due within 5 days","Upcoming"))))))'
  ]]);
  sheet.getRange(r, 7).setNumberFormat('0');
  return { ok: true, row: r, sn: maxSn + 1 };
}
