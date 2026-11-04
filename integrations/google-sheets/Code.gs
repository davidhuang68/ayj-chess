/** @OnlyCurrentDoc */
// Bound to the Chess Ratings spreadsheet. The token belongs in Script Properties, never here.
var AYJ_SHEET_ID = 'YOUR_SPREADSHEET_ID';
var AYJ_FEED_URL = 'https://ayjchess.vercel.app/api/ratings-sync';
var AYJ_MARKER = 'AYJ_CHESS_RATINGS_V1';
var AYJ_HEADERS = ['Name', 'Rating'];
var AYJ_LAYOUT = 'name-rating-v1';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('AYJ Chess')
    .addItem('Sync now', 'syncAyjRatingsNow')
    .addItem('Enable automatic sync', 'setupAyjRatingsSync')
    .addItem('Disable automatic sync', 'disableAyjRatingsSync').addToUi();
}

function setupAyjRatingsSync() {
  syncAyjRatings_(true);
  if (!ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'syncAyjRatings'; })) {
    ScriptApp.newTrigger('syncAyjRatings').timeBased().everyMinutes(1).create();
  }
  console.log('Ratings synced. Automatic sync is enabled.');
}

function syncAyjRatingsNow() { syncAyjRatings_(true); }
function syncAyjRatings() { syncAyjRatings_(false); }

function disableAyjRatingsSync() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncAyjRatings') ScriptApp.deleteTrigger(t);
  });
  console.log('Automatic ratings sync is disabled.');
}

function ayjFetch_(token, receipt) {
  var options = {
    method: receipt ? 'post' : 'get',
    headers: {Authorization: 'Bearer ' + token},
    muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true
  };
  if (receipt) { options.contentType = 'application/json'; options.payload = JSON.stringify(receipt); }
  var response = UrlFetchApp.fetch(AYJ_FEED_URL, options);
  if (response.getResponseCode() !== 200) throw new Error('Ratings connection failed. Check the private connection key and website.');
  var data;
  try { data = JSON.parse(response.getContentText()); }
  catch (e) { throw new Error('Invalid ratings response.'); }
  return data;
}

function ayjSnapshot_(data) {
  if (!data || data.schema !== 1 || data.spreadsheetId !== AYJ_SHEET_ID ||
      !Number.isSafeInteger(data.version) || data.version < 1 || !Array.isArray(data.players) ||
      data.players.length > 10000 || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('Invalid ratings snapshot.');
  var ids = {};
  data.players.forEach(function(p) {
    if (!p || typeof p.id !== 'string' || !p.id || ids[p.id] || typeof p.name !== 'string' || p.name.length > 200 ||
        !['rating', 'games', 'wins', 'draws', 'losses'].every(function(k) { return Number.isSafeInteger(p[k]); }) ||
        p.games < 0 || p.wins < 0 || p.draws < 0 || p.losses < 0 || p.games !== p.wins + p.draws + p.losses) {
      throw new Error('Invalid player data.');
    }
    ids[p.id] = true;
  });
  return data;
}

// Google Sheets treats strings beginning with '=' as formulas. Prefix all text with a
// literal apostrophe (not displayed by Sheets), including names starting with an apostrophe.
function ayjText_(value) { return "'" + value; }

function ayjManagedSheet_(spreadsheet, properties) {
  var stored = properties.getProperty('AYJ_MANAGED_SHEET_ID');
  var sheet = stored ? spreadsheet.getSheets().filter(function(s) { return String(s.getSheetId()) === stored; })[0] : null;
  if (!sheet) {
    sheet = spreadsheet.getSheetByName('Ratings');
    if (sheet && !sheet.getDeveloperMetadata().some(function(m) { return m.getKey() === AYJ_MARKER; }) && sheet.getLastRow() > 0) {
      throw new Error('The Ratings tab already contains other data. Rename it before enabling sync.');
    }
    if (!sheet) sheet = spreadsheet.insertSheet('Ratings');
    if (!sheet.getDeveloperMetadata().some(function(m) { return m.getKey() === AYJ_MARKER; })) sheet.addDeveloperMetadata(AYJ_MARKER, '1');
    properties.setProperty('AYJ_MANAGED_SHEET_ID', String(sheet.getSheetId()));
  }
  if (!sheet.getDeveloperMetadata().some(function(m) { return m.getKey() === AYJ_MARKER; })) throw new Error('Ratings tab ownership could not be verified.');
  return sheet;
}

function syncAyjRatings_(force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  var token, version = 0, stage = 'connection_failed';
  try {
    var properties = PropertiesService.getScriptProperties();
    token = properties.getProperty('AYJ_RATINGS_TOKEN');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Set AYJ_RATINGS_TOKEN in Script Properties first.');
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet || spreadsheet.getId() !== AYJ_SHEET_ID) throw new Error('This script must be bound to the Chess Ratings spreadsheet.');
    var snapshot = ayjSnapshot_(ayjFetch_(token));
    version = snapshot.version;
    var prior = Number(properties.getProperty('AYJ_LAST_VERSION') || 0);
    if (version < prior) throw new Error('Older ratings snapshot rejected.');
    stage = 'sheet_update_failed';
    var sheet = ayjManagedSheet_(spreadsheet, properties);
    var layoutChanged = properties.getProperty('AYJ_LAYOUT') !== AYJ_LAYOUT;
    if (force || layoutChanged || prior !== version || sheet.getLastRow() === 0) {
      var rows = [AYJ_HEADERS].concat(snapshot.players.map(function(p) {
        return [ayjText_(p.name), p.rating];
      }));
      if (sheet.getMaxRows() < rows.length) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length - sheet.getMaxRows());
      if (sheet.getMaxColumns() < AYJ_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), AYJ_HEADERS.length - sheet.getMaxColumns());
      var previousRows = sheet.getLastRow();
      var filter = sheet.getFilter();
      if (filter) filter.remove();
      // Remove only the former integration columns, once, when upgrading its managed tab.
      if (layoutChanged && sheet.getMaxColumns() >= 8) {
        sheet.getRange(1, 3, sheet.getMaxRows(), 6).clear();
        sheet.showColumns(8);
      }
      sheet.getRange(1, 1, rows.length, AYJ_HEADERS.length).setValues(rows);
      if (previousRows > rows.length) sheet.getRange(rows.length + 1, 1, previousRows - rows.length, AYJ_HEADERS.length).clearContent();
      sheet.getRange(1, 1, 1, AYJ_HEADERS.length).setFontWeight('bold').setBackground('#eeeeee');
      sheet.setFrozenRows(1);
      if (rows.length > 1) {
        sheet.getRange(2, 2, rows.length - 1, 1).setNumberFormat('0');
      }
      sheet.getRange(1, 1, rows.length, AYJ_HEADERS.length).createFilter();
      sheet.autoResizeColumns(1, 2);
      SpreadsheetApp.flush();
      properties.setProperty('AYJ_LAST_VERSION', String(version));
      properties.setProperty('AYJ_LAYOUT', AYJ_LAYOUT);
    }
    stage = 'connection_failed';
    ayjFetch_(token, {version: version, status: 'synced'});
    properties.setProperty('AYJ_LAST_CHECKED_AT', new Date().toISOString());
    console.log('Ratings sync complete: ' + snapshot.players.length + ' players.');
  } catch (e) {
    if (token) {
      try { ayjFetch_(token, {version: version, status: 'error', code: stage}); } catch (ignored) {}
    }
    // Never log HTTP requests, response bodies, tokens or player data on failure.
    throw new Error(stage === 'sheet_update_failed' ? 'Could not update Ratings. Check the managed tab and permissions.' : 'Could not connect to ratings. Check the website and private connection key.');
  } finally { lock.releaseLock(); }
}
