/* Разбор файлов шрифтов прямо в браузере: name, OS/2, cmap, maxp.
   Читаем файл кусками через Blob.slice — системные .ttc бывают на десятки мегабайт,
   целиком их тянуть незачем. */
(function (global) {
  'use strict';

  var SFNT = [0x00010000, 0x74727565, 0x4f54544f]; // 1.0, 'true', 'OTTO'

  function tag(v) {
    return String.fromCharCode((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
  }

  async function bytes(blob, start, length) {
    if (start < 0 || length <= 0 || start >= blob.size) return null;
    var buf = await blob.slice(start, Math.min(start + length, blob.size)).arrayBuffer();
    return new DataView(buf);
  }

  /* Каталог таблиц одного шрифта внутри файла. */
  async function directory(blob, offset) {
    var head = await bytes(blob, offset, 12);
    if (!head || head.byteLength < 12) return null;
    var version = head.getUint32(0);
    if (SFNT.indexOf(version) === -1) return null;
    var count = head.getUint16(4);
    if (!count || count > 512) return null;
    var dir = await bytes(blob, offset + 12, count * 16);
    if (!dir || dir.byteLength < count * 16) return null;
    var tables = {};
    for (var i = 0; i < count; i++) {
      var p = i * 16;
      tables[tag(dir.getUint32(p))] = { offset: dir.getUint32(p + 8), length: dir.getUint32(p + 12) };
    }
    return tables;
  }

  /* Коллекции (.ttc/.otc) — несколько шрифтов в одном файле. */
  async function offsets(blob) {
    var head = await bytes(blob, 0, 16);
    if (!head || head.byteLength < 12) return [];
    if (tag(head.getUint32(0)) === 'ttcf') {
      var num = head.getUint32(8);
      if (!num || num > 512) return [];
      var list = await bytes(blob, 12, num * 4);
      if (!list) return [];
      var out = [];
      for (var i = 0; i < num; i++) out.push(list.getUint32(i * 4));
      return out;
    }
    return [0];
  }

  var MACROMAN = 'ÄÅÇÉÑÖÜáàâäãåçéè' +
    'êëíìîïñóòôöõúùûü' +
    '†°¢£§•¶ß®©™´¨≠ÆØ' +
    '∞±≤≥¥µ∂∑∏π∫ªºΩæø' +
    '¿¡¬√ƒ≈∆«»… ÀÃÕŒœ' +
    '–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ' +
    '‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ' +
    'ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

  function decodeString(view, start, length, platformID, encodingID) {
    if (start + length > view.byteLength) return '';
    var s = '', i;
    var utf16 = platformID === 0 || platformID === 3 || (platformID === 2 && encodingID === 1);
    if (utf16) {
      for (i = 0; i + 1 < length; i += 2) s += String.fromCharCode(view.getUint16(start + i));
    } else {
      for (i = 0; i < length; i++) {
        var c = view.getUint8(start + i);
        s += c < 128 ? String.fromCharCode(c) : MACROMAN.charAt(c - 128) || '';
      }
    }
    return s.replace(/\u0000/g, '').trim();
  }

  /* Таблица name. Для каждого nameID держим лучший вариант:
     английскую Windows-запись предпочитаем всему остальному. */
  async function names(blob, table) {
    if (!table || !table.length) return {};
    var view = await bytes(blob, table.offset, Math.min(table.length, 1 << 21));
    if (!view || view.byteLength < 6) return {};
    var count = view.getUint16(2);
    var storage = view.getUint16(4);
    var out = {};
    for (var i = 0; i < count; i++) {
      var p = 6 + i * 12;
      if (p + 12 > view.byteLength) break;
      var platformID = view.getUint16(p);
      var encodingID = view.getUint16(p + 2);
      var languageID = view.getUint16(p + 4);
      var nameID = view.getUint16(p + 6);
      var len = view.getUint16(p + 8);
      var off = view.getUint16(p + 10);
      if (!len) continue;
      var text = decodeString(view, storage + off, len, platformID, encodingID);
      if (!text) continue;
      var rank = platformID === 3 && languageID === 0x409 ? 3 : platformID === 3 ? 2 : platformID === 1 && languageID === 0 ? 1 : 0;
      if (!out[nameID] || out[nameID].rank < rank) out[nameID] = { text: text, rank: rank };
    }
    var plain = {};
    for (var k in out) plain[k] = out[k].text;
    return plain;
  }

  /* Разрешения на встраивание из OS/2 — единственное машиночитаемое
     поле прав внутри самого файла. */
  async function embedding(blob, table) {
    if (!table || table.length < 10) return null;
    var view = await bytes(blob, table.offset, 12);
    if (!view || view.byteLength < 10) return null;
    var fsType = view.getUint16(8);
    var level = fsType & 0x000f;
    return {
      fsType: fsType,
      installable: level === 0,
      restricted: (level & 0x0002) !== 0,
      previewPrint: (level & 0x0004) !== 0,
      editable: (level & 0x0008) !== 0,
      noSubsetting: (fsType & 0x0100) !== 0,
      bitmapOnly: (fsType & 0x0200) !== 0
    };
  }

  async function glyphCount(blob, table) {
    if (!table || table.length < 6) return 0;
    var view = await bytes(blob, table.offset, 6);
    return view && view.byteLength >= 6 ? view.getUint16(4) : 0;
  }

  /* cmap: вместо полного набора кодпоинтов держим функцию поиска —
     проверить надо сотню символов, а не распаковывать десятки тысяч. */
  async function cmapLookup(blob, table) {
    if (!table || !table.length) return null;
    var head = await bytes(blob, table.offset, 4);
    if (!head || head.byteLength < 4) return null;
    var num = head.getUint16(2);
    if (!num || num > 64) return null;
    var list = await bytes(blob, table.offset + 4, num * 8);
    if (!list) return null;

    var best = null, bestRank = -1;
    for (var i = 0; i < num; i++) {
      var platformID = list.getUint16(i * 8);
      var encodingID = list.getUint16(i * 8 + 2);
      var sub = list.getUint32(i * 8 + 4);
      var rank = -1;
      if (platformID === 3 && encodingID === 10) rank = 4;
      else if (platformID === 0 && encodingID >= 4) rank = 3;
      else if (platformID === 3 && encodingID === 1) rank = 2;
      else if (platformID === 0) rank = 1;
      if (rank > bestRank) { bestRank = rank; best = sub; }
    }
    if (best == null) return null;

    var subStart = table.offset + best;
    var fmtView = await bytes(blob, subStart, 4);
    if (!fmtView) return null;
    var format = fmtView.getUint16(0);

    if (format === 4) {
      var lenView = await bytes(blob, subStart, 14);
      var length = lenView.getUint16(2);
      var view = await bytes(blob, subStart, Math.min(length, 1 << 20));
      if (!view || view.byteLength < 14) return null;
      var segX2 = view.getUint16(6);
      var seg = segX2 / 2;
      var endBase = 14, startBase = endBase + segX2 + 2, deltaBase = startBase + segX2, rangeBase = deltaBase + segX2;
      if (rangeBase + segX2 > view.byteLength) return null;
      return function (cp) {
        if (cp > 0xffff) return false;
        for (var s = 0; s < seg; s++) {
          var end = view.getUint16(endBase + s * 2);
          if (cp > end) continue;
          var start = view.getUint16(startBase + s * 2);
          if (cp < start) return false;
          var idRangeOffset = view.getUint16(rangeBase + s * 2);
          if (idRangeOffset === 0) {
            return ((cp + view.getInt16(deltaBase + s * 2)) & 0xffff) !== 0;
          }
          var gi = rangeBase + s * 2 + idRangeOffset + (cp - start) * 2;
          if (gi + 1 >= view.byteLength) return false;
          return view.getUint16(gi) !== 0;
        }
        return false;
      };
    }

    if (format === 12 || format === 13) {
      var h = await bytes(blob, subStart, 16);
      var groups = h.getUint32(12);
      if (!groups || groups > 200000) return null;
      var g = await bytes(blob, subStart + 16, groups * 12);
      if (!g) return null;
      return function (cp) {
        var lo = 0, hi = groups - 1;
        while (lo <= hi) {
          var mid = (lo + hi) >> 1, p = mid * 12;
          if (cp < g.getUint32(p)) hi = mid - 1;
          else if (cp > g.getUint32(p + 4)) lo = mid + 1;
          else return g.getUint32(p + 8) !== 0 || format === 13;
        }
        return false;
      };
    }

    if (format === 6) {
      var v6 = await bytes(blob, subStart, 10);
      var first = v6.getUint16(6), cnt = v6.getUint16(8);
      var arr = await bytes(blob, subStart + 10, cnt * 2);
      return function (cp) {
        if (cp < first || cp >= first + cnt || !arr) return false;
        return arr.getUint16((cp - first) * 2) !== 0;
      };
    }

    if (format === 0) {
      var v0 = await bytes(blob, subStart + 6, 256);
      return function (cp) { return cp < 256 && v0 && v0.getUint8(cp) !== 0; };
    }

    return null;
  }

  /* Разбор одного шрифта из файла. index — номер внутри коллекции. */
  async function parse(blob, index) {
    var starts = await offsets(blob);
    if (!starts.length) throw new Error('not-a-font');
    var start = starts[index || 0];
    if (start == null) start = starts[0];
    var tables = await directory(blob, start);
    if (!tables) throw new Error('not-a-font');

    var nameTable = await names(blob, tables.name);
    var lookup = await cmapLookup(blob, tables.cmap);

    return {
      collection: starts.length,
      names: nameTable,
      family: nameTable[16] || nameTable[1] || '',
      subfamily: nameTable[17] || nameTable[2] || '',
      fullName: nameTable[4] || '',
      postscriptName: nameTable[6] || '',
      copyright: nameTable[0] || '',
      trademark: nameTable[7] || '',
      manufacturer: nameTable[8] || '',
      designer: nameTable[9] || '',
      description: nameTable[10] || '',
      vendorUrl: nameTable[11] || '',
      designerUrl: nameTable[12] || '',
      license: nameTable[13] || '',
      licenseUrl: nameTable[14] || '',
      version: nameTable[5] || '',
      embedding: await embedding(blob, tables['OS/2']),
      glyphs: await glyphCount(blob, tables.maxp),
      outlines: tables['CFF '] ? 'CFF' : tables.glyf ? 'TrueType' : tables['CFF2'] ? 'CFF2' : '',
      variable: Boolean(tables.fvar),
      color: Boolean(tables.COLR || tables.sbix || tables['CBDT']),
      has: function (cp) { return lookup ? lookup(cp) : false; },
      cmapOk: Boolean(lookup)
    };
  }

  global.FontParse = { parse: parse, offsets: offsets };
})(this);
