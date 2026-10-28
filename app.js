/* Каталог шрифтов: сбор, разбор, автоподхват новых, фильтры, ручные решения, экспорт. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------- язык и тема ---------- */

  var lang = localStorage.getItem('fonts_ui_lang') ||
    ((navigator.language || '').slice(0, 2) === 'uk' ? 'uk' : 'ru');
  var t = I18N[lang];

  function plural(n, forms) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }
  function fmt(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
  }

  var theme = localStorage.getItem('fonts_ui_theme') || 'auto';
  function applyTheme() {
    var dark = theme === 'dark' ||
      (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('theme').textContent = dark ? '☀' : '☾';
  }

  /* ---------- контрольные наборы символов ---------- */

  var SETS = {
    latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    cyr: 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяЁё',
    ua: 'ҐґЄєІіЇї'
  };
  var EXTRA = {
    pl: 'ĄąĆćĘęŁłŃńÓóŚśŹźŻż',
    cs: 'ÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž',
    de: 'ÄäÖöÜüß',
    fr: 'ÀàÂâÇçÉéÈèÊêËëÎîÏïÔôÙùÛûŸÿŒœ',
    tr: 'ÇçĞğİıÖöŞşÜü',
    el: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρςστυφχψω'
  };

  /* Символы, которые встречаются в образцах. Проверяем их напрямую:
     «частичного» покрытия для показа текста недостаточно — пропавшие буквы
     браузер подменит чужим шрифтом, и образец соврёт. */
  var SAMPLE_CYR = 'АаБбҐґЄєЇїБыстраяжлнцидкву0123';
  var SAMPLE_LAT = 'AaBbCcDdEeThquickbrownfox0123';

  /* Шрифты других письменностей: показываем их родным алфавитом,
     иначе дизайнер видит «без букв» там, где букв полно. */
  /* Порядок важен: японский и китайский шрифты обычно включают греческий
     как довесок, поэтому специфичные письменности проверяем раньше общих. */
  var SCRIPTS = [
    { id: 'hangul', text: '한글 가나다라' },
    { id: 'kana', text: 'あいうえ アイウエ' },
    { id: 'han', text: '漢字 永東國' },
    { id: 'thai', text: 'กขคง จฉชญ' },
    { id: 'devanagari', text: 'अआइई कखगघ' },
    { id: 'arabic', text: 'ابجد هوز' },
    { id: 'hebrew', text: 'אבגד הוזח' },
    { id: 'armenian', text: 'Աա Բբ Գգ Դդ' },
    { id: 'georgian', text: 'აბგდ ევზთ' },
    { id: 'greek', text: 'Αα Ββ Γγ Δδ Εε' }
  ];

  function covers(font, chars) {
    if (!font.cmapOk) return false;
    for (var i = 0; i < chars.length; i++) {
      if (!font.has(chars.codePointAt(i))) return false;
    }
    return true;
  }

  /* Какая письменность у шрифта, если это не латиница и не кириллица. */
  function scriptOf(font) {
    for (var i = 0; i < SCRIPTS.length; i++) {
      if (covers(font, SCRIPTS[i].text.replace(/\s/g, ''))) return SCRIPTS[i].id;
    }
    return '';
  }

  function coverage(font, chars) {
    if (!font.cmapOk) return 'unchecked';
    var hit = 0;
    for (var i = 0; i < chars.length; i++) if (font.has(chars.codePointAt(i))) hit++;
    return hit === chars.length ? 'yes' : hit === 0 ? 'no' : 'partly';
  }

  /* ---------- тип лицензии по метаданным ---------- */

  var LICENSE_RULES = [
    { kind: 'ofl', label: 'SIL Open Font License', open: true, re: /sil open font license|\bOFL\b|openfontlicense/i },
    { kind: 'apache', label: 'Apache License', open: true, re: /apache license/i },
    { kind: 'ubuntu', label: 'Ubuntu Font Licence', open: true, re: /ubuntu font licence/i },
    { kind: 'gpl', label: 'GNU GPL', open: true, re: /gnu general public license|\bGPL\b/i },
    { kind: 'mit', label: 'MIT License', open: true, re: /\bMIT license\b|permission is hereby granted, free of charge/i },
    { kind: 'cc', label: 'Creative Commons', open: true, re: /creative commons|\bCC BY\b/i },
    { kind: 'publicdomain', label: 'Public domain', open: true, re: /public domain|unlicense/i },
    { kind: 'personal', label: 'Personal use only', open: false, re: /personal use only|for personal use|non-?commercial use only|not for commercial/i },
    { kind: 'demo', label: 'Demo / Trial', open: false, re: /\bdemo\b|\btrial\b|evaluation (?:only|purposes)|test ?drive/i },
    { kind: 'noredistribute', label: 'No redistribution', open: false, re: /may not be (?:copied|distributed|redistributed|transferred)|redistribution is (?:not )?prohibited|no redistribution/i }
  ];

  function classify(family) {
    var hay = [family.license.text, family.license.copyright, family.license.trademark,
      family.license.url, family.name].join(' \n ');
    for (var i = 0; i < LICENSE_RULES.length; i++) {
      if (LICENSE_RULES[i].re.test(hay)) return LICENSE_RULES[i];
    }
    return { kind: 'unknown', label: '', open: false };
  }

  /* ---------- права из OS/2 fsType ---------- */

  function rights(family) {
    var e = family.embedding;
    var kind = family.rule.kind;
    var open = family.rule.open;
    var out = {};
    out.commercial = open ? 'allowed' : (kind === 'personal' || kind === 'demo') ? 'forbidden' : 'check';
    if (!e) { out.web = 'check'; out.edit = 'check'; out.share = 'check'; return out; }
    if (e.restricted) { out.web = 'forbidden'; out.edit = 'forbidden'; out.share = 'forbidden'; return out; }
    if (e.previewPrint) { out.web = 'previewOnly'; out.edit = 'forbidden'; out.share = 'forbidden'; return out; }
    if (e.editable) { out.web = 'allowed'; out.edit = 'allowed'; out.share = 'limited'; return out; }
    if (e.installable) { out.web = 'allowed'; out.edit = 'allowed'; out.share = open ? 'allowed' : 'limited'; return out; }
    out.web = 'allowed'; out.edit = 'forbidden'; out.share = 'limited';
    return out;
  }

  /* ---------- хранилище ---------- */

  function read(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  var decisions = read('fonts_decisions', {});
  var languageEdits = read('fonts_language_edits', {});
  var favorites = new Set(read('fonts_favorites', []));

  /* ---------- состояние ---------- */

  var DATA = [];
  var activeCategory = 'all';
  var view = localStorage.getItem('fonts_ui_view') || 'grid';
  var expanded = new Set();
  var message = null;          // {key, vars, kind}
  var customText = localStorage.getItem('fonts_ui_text') || '';
  var sampleSize = Number(localStorage.getItem('fonts_ui_size')) || 30;
  var liveOn = false;
  var lastSync = 0;
  var syncing = false;

  /* ---------- образцы: подключаем сам шрифт ---------- */

  var sampleStyle = document.createElement('style');
  document.head.appendChild(sampleStyle);
  var sampleRegistered = new Set();

  function sampleFace(family) {
    var faces = family.faces;
    var regular = faces.filter(function (f) { return /^(regular|book|normal|roman)$/i.test(f.style); })[0];
    return regular || faces[0];
  }

  /* Системные шрифты подключаем по имени — файл уже стоит в системе.
     Для перетащенных файлов держим blob и грузим его как FontFace. */
  function registerSample(family) {
    if (!family.system) return family.cssFamily || '';
    var face = sampleFace(family);
    if (!face || !face.ps) return '';
    var id = 'fs-' + family.id;
    if (!sampleRegistered.has(id)) {
      sampleRegistered.add(id);
      sampleStyle.sheet.insertRule(
        '@font-face{font-family:"' + id + '";src:local("' + face.ps.replace(/"/g, '') + '");font-display:swap}',
        sampleStyle.sheet.cssRules.length
      );
    }
    return id;
  }

  /* Отдельное начертание: системное подключаем по имени,
     принесённое файлом — из самого файла. */
  function registerFaceSample(family, face, index) {
    if (!face) return '';
    if (family.system) {
      if (!face.ps) return '';
      var id = 'fs-' + family.id + '-' + index;
      if (!sampleRegistered.has(id)) {
        sampleRegistered.add(id);
        sampleStyle.sheet.insertRule(
          '@font-face{font-family:"' + id + '";src:local("' + face.ps.replace(/"/g, '') + '");font-display:swap}',
          sampleStyle.sheet.cssRules.length
        );
      }
      return id;
    }
    return face.cssFamily || '';
  }

  async function loadBlobFont(id, blob) {
    try {
      var ff = new FontFace(id, await blob.arrayBuffer());
      await ff.load();
      document.fonts.add(ff);
      return id;
    } catch (e) { return ''; }
  }

  async function registerFileSample(family) {
    if (family.cssFamily || !family.blobRef) return;
    family.cssFamily = await loadBlobFont('fs-' + family.id, family.blobRef);
  }

  async function loadFaceSamples(family) {
    if (family.system || family.facesLoaded) return;
    family.facesLoaded = true;
    for (var i = 0; i < family.faces.length; i++) {
      var face = family.faces[i];
      if (face.cssFamily || !face.blobRef) continue;
      face.cssFamily = await loadBlobFont('fs-' + family.id + '-' + i, face.blobRef);
    }
    scheduleRepaint();
  }

  /* ---------- сборка семейств ---------- */

  var nextId = 1;

  function emptyFamily(name) {
    return {
      id: nextId++, name: name, foundry: '', faces: [], langs: {}, extra: {},
      license: { text: '', url: '', copyright: '', trademark: '', vendorUrl: '', designer: '' },
      embedding: null, glyphs: 0, variable: false, color: false, system: false,
      blobRef: null, cssFamily: ''
    };
  }

  function mergeEmbedding(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      fsType: a.fsType | b.fsType,
      installable: a.installable && b.installable,
      restricted: a.restricted || b.restricted,
      previewPrint: a.previewPrint || b.previewPrint,
      editable: a.editable && b.editable,
      noSubsetting: a.noSubsetting || b.noSubsetting,
      bitmapOnly: a.bitmapOnly || b.bitmapOnly
    };
  }

  var ORDER = { no: 0, partly: 1, unchecked: 2, yes: 3 };
  function worst(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return ORDER[a] <= ORDER[b] ? a : b;
  }

  /* У многих шрифтов поле «производитель» пустое, зато есть копирайт
     вида «© 2021 Apple Inc. All rights reserved» — вытаскиваем имя оттуда. */
  function cleanFoundry(name) {
    return String(name || '')
      .replace(/\s+/g, ' ')
      .replace(/^(?:copyright|©|\(c\))\s*/i, '')
      .replace(/^(?:©\s*)?(?:\d{4}\s*[-–—]\s*\d{4}|\d{4})\s*/, '')
      .replace(/^(?:by|the)\s+/i, '')
      .replace(/[,;]\s*$/, '')
      .trim();
  }

  function guessFoundry(f) {
    if (f.manufacturer) return cleanFoundry(f.manufacturer);
    if (f.designer) return cleanFoundry(f.designer);
    var mark = /trademarks? of ([^.;]{2,60})/i.exec(f.trademark || '');
    if (mark) return cleanFoundry(mark[1]);
    var text = (f.copyright || '').replace(/\s+/g, ' ');
    var cop = /(?:©|\(c\)|copyright)[\s©]*(?:copyright\s*)?([^.,;©]{2,60})/i.exec(text);
    if (cop) {
      var name = cleanFoundry(cop[1]).replace(/\ball rights reserved\b.*/i, '').trim();
      if (name.length > 2 && !/^\d+$/.test(name)) return name;
    }
    return '';
  }

  function absorb(fam, f) {
    var face = {
      style: f.subfamily || 'Regular',
      ps: f.postscriptName,
      glyphs: f.glyphs,
      blobRef: f.blobRef || null,
      cssFamily: '',
      latin: coverage(f, SETS.latin),
      cyr: coverage(f, SETS.cyr),
      ua: coverage(f, SETS.ua),
      okCyr: covers(f, SAMPLE_CYR),
      okLat: covers(f, SAMPLE_LAT),
      script: scriptOf(f)
    };
    if (!fam.faces.some(function (x) { return x.style === face.style && x.ps === face.ps; })) fam.faces.push(face);

    fam.foundry = fam.foundry || guessFoundry(f);
    fam.license.text = fam.license.text || f.license || '';
    fam.license.url = fam.license.url || f.licenseUrl || '';
    fam.license.copyright = fam.license.copyright || f.copyright || '';
    fam.license.trademark = fam.license.trademark || f.trademark || '';
    fam.license.vendorUrl = fam.license.vendorUrl || f.vendorUrl || '';
    fam.license.designer = fam.license.designer || f.designer || '';
    fam.embedding = mergeEmbedding(fam.embedding, f.embedding);
    fam.glyphs = Math.max(fam.glyphs, f.glyphs || 0);
    fam.variable = fam.variable || f.variable;
    fam.color = fam.color || f.color;
    fam.system = fam.system || f.system === true;
    if (!fam.blobRef && f.blobRef) fam.blobRef = f.blobRef;

    ['latin', 'cyr', 'ua'].forEach(function (k) { fam.langs[k] = worst(fam.langs[k], face[k]); });
    Object.keys(EXTRA).forEach(function (k) { fam.extra[k] = worst(fam.extra[k], coverage(f, EXTRA[k])); });
  }

  function finish(fam) {
    fam.rule = classify(fam);
    fam.rights = rights(fam);
    fam.faces.sort(function (a, b) { return a.style.localeCompare(b.style); });
    /* Языки семейства считаем по основному начертанию, а не по худшему:
       одни орнаменты внутри семейства не должны объявлять весь шрифт безбуквенным.
       Разбивка по начертаниям всё равно видна в подробностях. */
    var main = sampleFace(fam);
    if (main) {
      fam.langs = { latin: main.latin, cyr: main.cyr, ua: main.ua };
    }
    return fam;
  }

  /* Добавляем разобранные начертания к уже имеющемуся каталогу. */
  function mergeIntoData(parsed) {
    var byName = new Map();
    DATA.forEach(function (f) { byName.set(f.name.toLocaleLowerCase(), f); });
    var added = 0;
    parsed.forEach(function (f) {
      var name = f.family || f.fullName || f.postscriptName || '—';
      var key = name.toLocaleLowerCase();
      var fam = byName.get(key);
      if (!fam) {
        fam = emptyFamily(name);
        byName.set(key, fam);
        DATA.push(fam);
        added++;
      }
      absorb(fam, f);
    });
    DATA.forEach(finish);
    return added;
  }

  async function parseAll(items, onProgress) {
    var parsed = [], skipped = 0, done = 0;
    var BATCH = 12;
    for (var i = 0; i < items.length; i += BATCH) {
      var chunk = items.slice(i, i + BATCH);
      var results = await Promise.all(chunk.map(async function (item) {
        try {
          var f = await FontParse.parse(item.blob, item.index || 0);
          f.system = item.system === true;
          f.blobRef = item.system ? null : item.blob;
          return f;
        } catch (e) { return null; }
      }));
      results.forEach(function (r) { r ? parsed.push(r) : skipped++; });
      done += chunk.length;
      if (onProgress) onProgress(done, items.length);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    return { parsed: parsed, skipped: skipped };
  }

  function showProgress(on, text, done, total) {
    $('progress').classList.toggle('on', on);
    if (text != null) $('progresstext').textContent = text;
    $('progressbar').style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
  }

  /* Сообщение храним ключом, а не готовой строкой, — иначе при смене
     языка интерфейса оно осталось бы на прежнем. */
  function say(key, vars, kind) { message = key ? { key: key, vars: vars || {}, kind: kind || '' } : null; }

  function messageText() {
    if (!message) return '';
    if (message.key === 'raw') return message.vars.text;
    var vars = Object.assign({}, message.vars);
    if (vars.n != null && t[message.key] && /\{word\}/.test(t[message.key])) {
      vars.word = plural(vars.n, t.fontsPlural);
    }
    return fmt(t[message.key], vars);
  }

  async function ingest(items, opts) {
    opts = opts || {};
    if (!items.length) { showProgress(false); return 0; }
    if (!opts.silent) showProgress(true, t.reading, 0, items.length);
    var res = await parseAll(items, function (done, total) {
      if (!opts.silent) showProgress(true, fmt(t.readingOf, { done: done, total: total }), done, total);
    });
    var added = mergeIntoData(res.parsed);
    sortData();
    showProgress(false);
    if (!persistCatalog() && !opts.silent) say('storageFull', {}, 'bad');
    return opts.newOnly ? added : res.parsed.length;
  }

  /* ---------- источник 1: установленные шрифты ---------- */

  function knownFaceKeys() {
    var set = new Set();
    DATA.forEach(function (fam) {
      fam.faces.forEach(function (face) { if (face.ps) set.add(face.ps); });
    });
    return set;
  }

  async function permissionState() {
    if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
    try { return (await navigator.permissions.query({ name: 'local-fonts' })).state; }
    catch (e) { return 'unknown'; }
  }

  /* Главный путь: спросить у системы список шрифтов и дочитать только новые. */
  async function syncInstalled(opts) {
    opts = opts || {};
    if (syncing || typeof window.queryLocalFonts !== 'function') return;
    syncing = true;
    try {
      var faces;
      try {
        faces = await window.queryLocalFonts();
      } catch (e) {
        if (!opts.silent) {
          if (e && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) say('permissionDenied', {}, 'bad');
          else say('raw', { text: t.scanFailed + (e && e.message ? e.message : e) }, 'bad');
          render();
        }
        return;
      }

      liveOn = true;
      var known = knownFaceKeys();
      var fresh = faces.filter(function (f) { return !known.has(f.postscriptName); });

      // Ничего не изменилось — молча выходим, таблицу не трогаем.
      if (!fresh.length) {
        if (!opts.silent) { say('upToDate', { n: DATA.length }, 'good'); render(); }
        else renderLive();
        return;
      }

      if (!opts.silent) showProgress(true, t.reading, 0, fresh.length * 2);
      var items = [];
      for (var i = 0; i < fresh.length; i += 24) {
        var chunk = fresh.slice(i, i + 24);
        var blobs = await Promise.all(chunk.map(function (f) {
          return f.blob().catch(function () { return null; });
        }));
        blobs.forEach(function (b) { if (b) items.push({ blob: b, index: 0, system: true }); });
        if (!opts.silent) {
          showProgress(true, fmt(t.readingOf, { done: i + chunk.length, total: fresh.length }),
            i + chunk.length, fresh.length * 2);
        }
      }

      var before = DATA.length;
      await ingest(items, { silent: opts.silent, newOnly: true });
      var added = DATA.length - before;

      if (opts.silent) {
        if (added) say('autoAdded', { n: added }, 'good');
      } else {
        say('doneScan', { families: DATA.length, faces: items.length }, 'good');
      }
      render();
    } finally {
      syncing = false;
      lastSync = Date.now();
    }
  }

  /* ---------- источник 2: папка или перетаскивание ---------- */

  var FONT_EXT = /\.(ttf|otf|ttc|otc|woff)$/i;

  async function filesFromDirectory(handle, out, depth) {
    if (depth > 6 || out.length > 8000) return;
    for await (var entry of handle.values()) {
      if (entry.kind === 'file' && FONT_EXT.test(entry.name)) {
        try { out.push(await entry.getFile()); } catch (e) {}
      } else if (entry.kind === 'directory') {
        await filesFromDirectory(entry, out, depth + 1);
      }
    }
  }

  async function pickFolder() {
    if (typeof window.showDirectoryPicker !== 'function') { $('filepick').click(); return; }
    var handle;
    try { handle = await window.showDirectoryPicker({ id: 'fonts', mode: 'read' }); }
    catch (e) { return; }
    var files = [];
    showProgress(true, t.reading, 0, 1);
    await filesFromDirectory(handle, files, 0);
    await scanFiles(files);
  }

  async function scanFiles(files) {
    var items = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!FONT_EXT.test(file.name)) continue;
      var count = 1;
      try { count = (await FontParse.offsets(file)).length || 1; } catch (e) { count = 1; }
      for (var k = 0; k < count; k++) items.push({ blob: file, index: k });
    }
    if (!items.length) { showProgress(false); say('noFonts', {}, 'bad'); render(); return; }
    var n = await ingest(items, {});
    say('doneScan', { families: DATA.length, faces: n }, 'good');
    render();
  }

  /* ---------- сохранение каталога ---------- */

  function persistCatalog() {
    var slim = DATA.map(function (f) {
      return {
        name: f.name, foundry: f.foundry, faces: f.faces, langs: f.langs, extra: f.extra,
        license: {
          text: (f.license.text || '').slice(0, 1200), url: f.license.url,
          copyright: (f.license.copyright || '').slice(0, 400),
          trademark: (f.license.trademark || '').slice(0, 200),
          vendorUrl: f.license.vendorUrl, designer: f.license.designer
        },
        embedding: f.embedding, glyphs: f.glyphs, variable: f.variable,
        color: f.color, system: f.system
      };
    });
    return write('fonts_catalog', { saved: Date.now(), families: slim });
  }

  function loadCatalog() {
    var saved = read('fonts_catalog', null);
    if (!saved || !Array.isArray(saved.families) || !saved.families.length) return false;
    // в старом кэше нет данных о покрытии образцов — он бесполезен, сканируем заново
    var sample = saved.families[0].faces && saved.families[0].faces[0];
    if (!sample || sample.okLat === undefined) {
      localStorage.removeItem('fonts_catalog');
      return false;
    }
    DATA = saved.families.map(function (f) {
      f.id = nextId++;
      f.blobRef = null;
      f.cssFamily = '';
      return finish(f);
    });
    sortData();
    return true;
  }

  /* ---------- ручные решения ---------- */

  function manualStatus(f) {
    var d = decisions[f.name];
    return d ? (typeof d === 'string' ? d : d.status) : '';
  }
  function currentStatus(f) {
    return manualStatus(f) || (f.rule.open ? t.openByFile : t.statuses[0]);
  }
  function categoryOf(f) {
    var manual = manualStatus(f);
    if (manual) {
      var i = t.statuses.indexOf(manual);
      if (i === 1) return 'commercial';
      if (i === 2) return 'personal';
      if (i === 3) return 'demo';
      if (i === 4) return 'forbidden';
      if (i === 5) return 'transfer';
      if (i === 0) return 'check';
    }
    if (f.rule.open) return 'open';
    if (f.rule.kind === 'personal') return 'personal';
    if (f.rule.kind === 'demo') return 'demo';
    if (f.rule.kind === 'noredistribute') return 'transfer';
    if (f.embedding && f.embedding.restricted) return 'forbidden';
    if (f.embedding && f.embedding.previewPrint) return 'transfer';
    return 'check';
  }
  function langValue(f, key) {
    var o = languageEdits[f.name] && languageEdits[f.name][key];
    return o || f.langs[key] || 'unchecked';
  }
  function isFav(f) { return favorites.has(f.name.toLocaleLowerCase()); }

  /* Фильтр по алфавитам. «Только латиница» — это именно отсутствие кириллицы,
     а не просто её наличие, иначе выборка теряет смысл. */
  function matchesAlphabet(f, mode) {
    var lat = langValue(f, 'latin') === 'yes';
    var cyr = langValue(f, 'cyr') === 'yes';
    var ua = langValue(f, 'ua') === 'yes';
    var face = sampleFace(f);
    var script = face && face.script;
    var unchecked = langValue(f, 'latin') === 'unchecked' && langValue(f, 'cyr') === 'unchecked';

    if (mode === 'latin-only') return lat && !cyr;
    if (mode === 'cyr-only') return cyr && !lat;
    if (mode === 'both') return lat && cyr;
    if (mode === 'ua') return ua;
    if (mode === 'other') return !lat && !cyr && Boolean(script);
    if (mode === 'unknown') return unchecked || (!lat && !cyr && !script);
    return true;
  }

  /* ---------- отрисовка ---------- */

  var CATS = ['all', 'open', 'commercial', 'check', 'personal', 'demo', 'forbidden', 'transfer', 'favorites'];
  var PILL = { yes: 'ok', partly: 'warn', no: 'bad', unchecked: '' };
  var RIGHT_PILL = { allowed: 'ok', forbidden: 'bad', check: 'warn', limited: 'warn', previewOnly: 'warn' };

  function sortData() {
    var mode = $('sort') && $('sort').value || 'name';
    DATA.sort(function (a, b) {
      if (mode === 'foundry') return (a.foundry || 'яя').localeCompare(b.foundry || 'яя') || a.name.localeCompare(b.name);
      if (mode === 'styles') return b.faces.length - a.faces.length || a.name.localeCompare(b.name);
      if (mode === 'status') return CATS.indexOf(categoryOf(a)) - CATS.indexOf(categoryOf(b)) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }

  /* Какой текст показывать образцом. Шрифт без кириллицы браузер молча
     подменит системным — выглядит так, будто кириллица есть. Поэтому
     подбираем набор под реальное покрытие и честно это подписываем. */
  function hasCyrillic(text) { return /[\u0400-\u04FF]/.test(text); }
  function hasLatin(text) { return /[A-Za-z]/.test(text); }

  /* Покрытие берём у того начертания, которым рисуем образец, а не худшее
     по семейству: одни орнаменты внутри семейства не должны занижать остальные. */
  function sampleCoverage(f, key, face) {
    var manual = languageEdits[f.name] && languageEdits[f.name][key];
    if (manual) return manual;
    var src = face || sampleFace(f);
    return (src && src[key]) || f.langs[key] || 'unchecked';
  }

  function sampleFor(f, which, face) {
    var src = face || sampleFace(f);
    var manualCyr = languageEdits[f.name] && languageEdits[f.name].cyr;
    var cyr = manualCyr ? manualCyr === 'yes' : Boolean(src && src.okCyr);
    var ua = cyr;
    var lat = Boolean(src && src.okLat);

    if (customText) {
      var needCyr = hasCyrillic(customText);
      var needLat = hasLatin(customText);
      if ((needCyr && (cyr || ua)) || (!needCyr && needLat && lat) || (!needCyr && !needLat)) {
        return { text: customText, note: '' };
      }
      if (lat) return { text: t.sampleTopLatin, note: t.fallbackLatinText };
      if (src && src.script) {
        var own = SCRIPTS.filter(function (x) { return x.id === src.script; })[0];
        if (own) return { text: own.text, note: fmt(t.fallbackScript, { script: t.scripts[src.script] }) };
      }
      return { text: '', note: t.noLetters };
    }

    if (cyr || ua) {
      if (which === 'two' && src && src.script && src.script !== 'greek') {
        var own3 = SCRIPTS.filter(function (x) { return x.id === src.script; })[0];
        if (own3) return { text: own3.text, note: '' };
      }
      return { text: which === 'two' ? t.sampleBottom : t.sampleTop, note: '' };
    }
    if (lat) {
      // у шрифта есть и своя письменность — второй строкой показываем её,
      // это полезнее, чем ещё одна строка латиницы
      if (which === 'two' && src && src.script && src.script !== 'greek') {
        var own2 = SCRIPTS.filter(function (x) { return x.id === src.script; })[0];
        if (own2) return { text: own2.text, note: '' };
      }
      return {
        text: which === 'two' ? t.sampleBottomLatin : t.sampleTopLatin,
        note: which === 'two' ? '' : t.fallbackLatin
      };
    }
    if (src && src.script) {
      var sc = SCRIPTS.filter(function (x) { return x.id === src.script; })[0];
      if (sc) {
        return {
          text: which === 'two' ? '' : sc.text,
          note: which === 'two' ? '' : fmt(t.fallbackScript, { script: t.scripts[src.script] })
        };
      }
    }
    return { text: '', note: which === 'two' ? '' : t.noLetters };
  }

  function sampleMarkup(f, text, extraClass) {
    var css = f.system ? registerSample(f) : f.cssFamily;
    if (!css) return extraClass ? '' : '<div class="sample nosample">' + esc(t.samplePending) + '</div>';
    return '<div class="sample ' + (extraClass || '') + '" data-sample="' + (extraClass || 'top') +
      '" style="font-family:\'' + esc(css) + '\'">' + esc(text) + '</div>';
  }

  function sampleBlock(f, which) {
    var s = sampleFor(f, which);
    if (!s.text) {
      return which === 'two' ? '' : '<div class="sample nosample">' + esc(s.note) + '</div>';
    }
    return sampleMarkup(f, s.text, which === 'two' ? 'two' : '') +
      (s.note ? '<div class="samplenote">' + esc(s.note) + '</div>' : '');
  }

  function topSample(f) {
    if (customText) return sampleBlock(f, 'top');
    return sampleBlock(f, 'top') + sampleBlock(f, 'two');
  }

  /* Все начертания семейства одним списком — чтобы сравнить свой текст
     в Regular, Bold, Italic и так далее. */
  function facesPreview(f) {
    var rows = f.faces.map(function (face, idx) {
      var css = registerFaceSample(f, face, idx);
      var s = sampleFor(f, 'top', face);
      var body;
      if (!css) body = '<div class="facesample nosample">' + esc(t.faceMissing) + '</div>';
      else if (!s.text) body = '<div class="facesample nosample">' + esc(s.note) + '</div>';
      else {
        body = '<div class="sample facesample" data-sample="face" style="font-family:\'' + esc(css) + '\'">' +
          esc(s.text) + '</div>';
      }
      return '<div class="facerow"><span class="facename">' + esc(face.style) + '</span>' + body + '</div>';
    }).join('');
    return '<div class="faces">' + rows + '</div>';
  }

  function langPills(f) {
    return ['latin', 'cyr', 'ua'].map(function (k) {
      var v = langValue(f, k);
      return '<span class="pill ' + PILL[v] + '">' + esc(t[k]) +
        (v === 'yes' ? '' : ' · ' + esc(t[v])) + '</span>';
    }).join('');
  }

  function rightsBlock(f) {
    var r = f.rights;
    return '<div class="rights">' +
      ['commercial', 'web', 'edit', 'share'].map(function (k) {
        var key = { commercial: 'rightsCommercial', web: 'rightsWeb', edit: 'rightsEdit', share: 'rightsShare' }[k];
        return '<div class="right"><b>' + esc(t[key]) + '</b>' +
          '<span class="pill ' + RIGHT_PILL[r[k]] + '">' + esc(t[r[k]]) + '</span></div>';
      }).join('') + '</div>';
  }

  function sourcesBlock(f) {
    var query = encodeURIComponent(f.name + ' font license ' + (f.foundry || ''));
    var links = [];
    if (/^https?:/i.test(f.license.url)) links.push('<a href="' + esc(f.license.url) + '" target="_blank" rel="noopener noreferrer">' + esc(t.licenseInFile) + '</a>');
    if (/^https?:/i.test(f.license.vendorUrl)) links.push('<a href="' + esc(f.license.vendorUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(t.findFoundry) + '</a>');
    links.push('<a href="https://www.google.com/search?q=' + query + '" target="_blank" rel="noopener noreferrer">Google</a>');
    links.push('<a href="https://fonts.google.com/?query=' + encodeURIComponent(f.name) + '" target="_blank" rel="noopener noreferrer">Google Fonts</a>');
    links.push('<a href="https://www.myfonts.com/search?query=' + encodeURIComponent(f.name) + '" target="_blank" rel="noopener noreferrer">MyFonts</a>');
    return '<div class="links">' + links.join('') + '</div>';
  }

  function detailBlock(f, i) {
    var langs = ['latin', 'cyr', 'ua'].map(function (key) {
      var manual = Boolean(languageEdits[f.name] && languageEdits[f.name][key]);
      var value = langValue(f, key);
      var opts = ['yes', 'partly', 'no', 'unchecked'].map(function (v) {
        return '<option value="' + v + '"' + (v === value ? ' selected' : '') + '>' + esc(t[v]) + '</option>';
      }).join('');
      return '<div class="langrow"><span>' + esc(t[key]) + (manual ? ' ✎' : '') + '</span>' +
        '<select data-lang="' + i + '" data-key="' + key + '">' + opts + '</select></div>';
    }).join('');

    var extraOk = Object.keys(EXTRA).filter(function (k) { return f.extra && f.extra[k] === 'yes'; });
    var extraHtml = extraOk.length
      ? '<div class="pills" style="margin-top:8px">' + extraOk.map(function (k) {
        return '<span class="pill ok">' + esc(t.langNames[k]) + '</span>';
      }).join('') + '</div>' : '';

    var styleList = facesPreview(f);
    var licText = [f.license.text, f.license.copyright, f.license.trademark].filter(Boolean).join('\n\n');

    return '<div class="detail">' +
      '<div class="block"><h4>' + esc(t.facesPreview) + '</h4>' + styleList + '</div>' +
      '<div class="block"><h4>' + esc(t.colLangs) + '</h4>' + langs + extraHtml +
      (languageEdits[f.name] ? '<button class="minibtn" data-resetlang="' + i + '" style="margin-top:6px">' + esc(t.resetLangs) + '</button>' : '') +
      '</div>' +
      '<div class="block"><h4>' + esc(t.licenseText) + '</h4>' +
      '<div class="lictext">' + esc(licText || t.noLicenseText) + '</div></div>' +
      '<div class="block"><h4>' + esc(t.colSources) + '</h4>' + sourcesBlock(f) +
      '<div style="margin-top:6px;color:var(--ink-3)">' + esc(t.searchNote) + '</div></div>' +
      '</div>';
  }

  function statusSelect(f, i) {
    var opts = t.statuses.map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === manualStatus(f) ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
    return '<select data-status="' + i + '"><option value="">' + esc(currentStatus(f)) + '</option>' + opts + '</select>';
  }

  function card(f, i) {
    var meta = [
      f.faces.length + ' ' + plural(f.faces.length, t.stylesPlural),
      f.glyphs ? f.glyphs + ' ' + plural(f.glyphs, t.glyphsPlural) : '',
      f.variable ? t.variable : '', f.color ? t.color : ''
    ].filter(Boolean).join(' · ');

    return '<article class="font">' +
      '<div class="fonttop"><div><div class="fontname">' + esc(f.name) + '</div>' +
      '<div class="foundry">' + esc(f.foundry || t.foundryUnknown) + '</div></div>' +
      '<button class="star' + (isFav(f) ? ' on' : '') + '" data-fav="' + i + '" aria-label="★">' +
      (isFav(f) ? '★' : '☆') + '</button></div>' +
      topSample(f) +
      '<div class="meta">' + esc(meta) + '</div>' +
      '<div class="pills">' + langPills(f) + '</div>' +
      rightsBlock(f) +
      '<div class="cardfoot">' + statusSelect(f, i) +
      '<button class="expand" data-expand="' + i + '">' + (expanded.has(f.name) ? '−' : '+') + '</button></div>' +
      (expanded.has(f.name) ? detailBlock(f, i) : '') +
      '</article>';
  }

  function tableRow(f, i) {
    return '<tr>' +
      '<td><button class="star' + (isFav(f) ? ' on' : '') + '" data-fav="' + i + '">' + (isFav(f) ? '★' : '☆') + '</button></td>' +
      '<td><div class="fontname">' + esc(f.name) + '</div><div class="foundry">' + esc(f.foundry || t.foundryUnknown) + '</div></td>' +
      '<td>' + sampleBlock(f, 'top') + '</td>' +
      '<td>' + f.faces.length + '</td>' +
      '<td><div class="pills">' + langPills(f) + '</div></td>' +
      '<td>' + statusSelect(f, i) + '</td>' +
      '<td><div class="pills"><span class="pill ' + RIGHT_PILL[f.rights.commercial] + '">' + esc(t[f.rights.commercial]) + '</span></div></td>' +
      '<td><button class="expand" data-expand="' + i + '">' + (expanded.has(f.name) ? '−' : '+') + '</button></td>' +
      '</tr>' +
      (expanded.has(f.name) ? '<tr><td colspan="8">' + detailBlock(f, i) + '</td></tr>' : '');
  }

  function paintCategories() {
    var counts = { all: DATA.length, favorites: DATA.filter(isFav).length };
    ['open', 'commercial', 'check', 'personal', 'demo', 'forbidden', 'transfer'].forEach(function (k) {
      counts[k] = DATA.filter(function (f) { return categoryOf(f) === k; }).length;
    });
    $('cats').innerHTML = CATS.filter(function (k) {
      return k === 'all' || k === 'favorites' || counts[k] > 0;
    }).map(function (k) {
      return '<button class="catchip" data-category="' + k + '" aria-pressed="' + (activeCategory === k) + '">' +
        esc(t.cats[k]) + '<b>' + (counts[k] || 0) + '</b></button>';
    }).join('');
  }

  function renderLive() {
    $('live').classList.toggle('hidden', !liveOn);
    $('live').innerHTML = liveOn ? '<i></i>' + esc(t.liveOn) : '';
  }

  function render() {
    $('message').innerHTML = message
      ? '<div class="msg ' + message.kind + '">' + esc(messageText()) + '</div>' : '';
    renderLive();
    $('scan').textContent = DATA.length ? t.scanAgain : t.scan;
    $('note').textContent = DATA.length
      ? (liveOn ? t.hintLive : t.hintHasData)
      : (typeof window.queryLocalFonts === 'function' ? t.hintChrome : t.hintOther);

    if (!DATA.length) {
      $('results').innerHTML = '<div class="card empty"><b>' + esc(t.emptyTitle) + '</b>' + esc(t.emptyText) + '</div>';
      ['statFamilies', 'statFaces', 'statUnknown', 'statManual'].forEach(function (id) { $(id).textContent = '—'; });
      $('filters').classList.add('hidden');
      $('count').textContent = '';
      return;
    }
    $('filters').classList.remove('hidden');
    paintCategories();

    var q = $('search').value.trim().toLocaleLowerCase();
    var alphabet = $('alphabet').value;

    var shown = DATA.filter(function (f) {
      if (activeCategory === 'favorites') { if (!isFav(f)) return false; }
      else if (activeCategory !== 'all' && categoryOf(f) !== activeCategory) return false;
      if (alphabet && !matchesAlphabet(f, alphabet)) return false;
      if (q) {
        var hay = [f.name, f.foundry].concat(f.faces.map(function (x) { return x.style; })).join(' ').toLocaleLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    $('statFamilies').textContent = DATA.length;
    $('statFaces').textContent = DATA.reduce(function (n, f) { return n + f.faces.length; }, 0);
    $('statUnknown').textContent = DATA.filter(function (f) { return categoryOf(f) === 'check'; }).length;
    $('statManual').textContent = Object.keys(decisions).length;
    $('count').textContent = fmt(t.shown, { shown: shown.length, total: DATA.length });

    if (!shown.length) {
      $('results').innerHTML = '<div class="card empty">' + esc(t.nothing) + '</div>';
      return;
    }

    if (view === 'table') {
      $('results').innerHTML = '<div class="tablewrap"><table><thead><tr>' +
        '<th></th><th>' + esc(t.colFont) + '</th><th>' + esc(t.colSample) + '</th>' +
        '<th>' + esc(t.colStylesShort) + '</th><th>' + esc(t.colLangs) + '</th>' +
        '<th>' + esc(t.colLicense) + '</th><th>' + esc(t.rightsCommercial) + '</th><th></th>' +
        '</tr></thead><tbody>' +
        shown.map(function (f) { return tableRow(f, DATA.indexOf(f)); }).join('') +
        '</tbody></table></div>';
    } else {
      $('results').innerHTML = '<div class="grid">' +
        shown.map(function (f) { return card(f, DATA.indexOf(f)); }).join('') + '</div>';
    }

    // перетащенные файлы: подключаем шрифт для образца по мере показа
    shown.forEach(function (f) {
      if (!f.system && !f.cssFamily && f.blobRef) {
        registerFileSample(f).then(function () { if (f.cssFamily) scheduleRepaint(); });
      }
      if (!f.system && expanded.has(f.name)) loadFaceSamples(f);
    });

    bindRows();
  }

  function refreshSampleText() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), function (el) {
      var kind = el.dataset.sample;
      if (kind === 'two') { el.style.display = customText ? 'none' : ''; return; }
      el.textContent = customText || (kind === 'face' ? t.sampleTop : t.sampleTop);
    });
  }

  var repaintTimer = null;
  function scheduleRepaint() {
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(render, 220);
  }

  function bindRows() {
    var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };
    each('[data-fav]', function (el) {
      el.onclick = function () {
        var f = DATA[+el.dataset.fav];
        var k = f.name.toLocaleLowerCase();
        isFav(f) ? favorites.delete(k) : favorites.add(k);
        write('fonts_favorites', Array.from(favorites));
        render();
      };
    });
    each('[data-expand]', function (el) {
      el.onclick = function () {
        var name = DATA[+el.dataset.expand].name;
        expanded.has(name) ? expanded.delete(name) : expanded.add(name);
        render();
      };
    });
    each('[data-status]', function (el) {
      el.onchange = function () {
        var f = DATA[+el.dataset.status];
        if (!el.value) delete decisions[f.name];
        else decisions[f.name] = { status: el.value, date: new Date().toISOString() };
        write('fonts_decisions', decisions);
        render();
      };
    });
    each('[data-lang]', function (el) {
      el.onchange = function () {
        var f = DATA[+el.dataset.lang];
        languageEdits[f.name] = languageEdits[f.name] || {};
        languageEdits[f.name][el.dataset.key] = el.value;
        write('fonts_language_edits', languageEdits);
        render();
      };
    });
    each('[data-resetlang]', function (el) {
      el.onclick = function () {
        delete languageEdits[DATA[+el.dataset.resetlang].name];
        write('fonts_language_edits', languageEdits);
        render();
      };
    });
    each('[data-category]', function (el) {
      el.onclick = function () { activeCategory = el.dataset.category; render(); };
    });
  }

  /* ---------- экспорт ---------- */

  function download(name, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function exportCSV() {
    var rows = [[t.colFont, 'Foundry', t.colStyles, t.latin, t.cyr, t.ua, t.colLicense,
      t.rightsCommercial, t.rightsWeb, t.rightsEdit, t.rightsShare, 'fsType', 'URL', '★']];
    DATA.forEach(function (f) {
      rows.push([
        f.name, f.foundry, f.faces.map(function (x) { return x.style; }).join('; '),
        t[langValue(f, 'latin')], t[langValue(f, 'cyr')], t[langValue(f, 'ua')],
        currentStatus(f), t[f.rights.commercial], t[f.rights.web], t[f.rights.edit], t[f.rights.share],
        f.embedding ? f.embedding.fsType : '', f.license.url || '', isFav(f) ? '★' : ''
      ]);
    });
    var csv = '﻿' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    download('fonts.csv', csv, 'text/csv;charset=utf-8');
  }

  /* ---------- статический текст ---------- */

  function applyStaticText() {
    document.documentElement.lang = lang;
    document.title = t.title;
    $('title').textContent = t.title;
    $('lead').textContent = t.subtitle;
    $('scan').textContent = DATA.length ? t.scanAgain : t.scan;
    $('pickfolder').textContent = t.pickFolder;
    $('drop').textContent = t.drop;
    $('note').textContent = DATA.length
      ? (liveOn ? t.hintLive : t.hintHasData)
      : (typeof window.queryLocalFonts === 'function' ? t.hintChrome : t.hintOther);
    $('search').placeholder = t.searchPlaceholder;
    $('sampletext').placeholder = t.yourTextPlaceholder;
    $('sampletextlabel').textContent = t.yourText;
    $('resettext').textContent = t.resetText;
    $('sizelabel').textContent = t.sampleSize;
    $('statFamiliesLabel').textContent = t.statFamilies;
    $('statFacesLabel').textContent = t.statFaces;
    $('statUnknownLabel').textContent = t.statUnknown;
    $('statManualLabel').textContent = t.statManual;
    $('backup').textContent = t.backup;
    $('restore').textContent = t.restore;
    $('exportCSV').textContent = t.exportCSV;
    $('clearAll').textContent = t.clearAll;
    $('disclaimer').textContent = t.disclaimer;
    $('viewGrid').textContent = t.viewGrid;
    $('viewTable').textContent = t.viewTable;
    var alphabetValue = $('alphabet').value || '';
    $('alphabet').innerHTML =
      '<option value="">' + esc(t.allAlphabets) + '</option>' +
      '<option value="latin-only">' + esc(t.onlyLatin) + '</option>' +
      '<option value="cyr-only">' + esc(t.onlyCyr) + '</option>' +
      '<option value="both">' + esc(t.latinAndCyr) + '</option>' +
      '<option value="ua">' + esc(t.uaOnly) + '</option>' +
      '<option value="other">' + esc(t.otherScripts) + '</option>' +
      '<option value="unknown">' + esc(t.notDetected) + '</option>';
    $('alphabet').value = alphabetValue;
    var sortValue = $('sort').value || 'name';
    $('sort').innerHTML =
      '<option value="name">' + esc(t.sortName) + '</option>' +
      '<option value="foundry">' + esc(t.sortFoundry) + '</option>' +
      '<option value="styles">' + esc(t.sortStyles) + '</option>' +
      '<option value="status">' + esc(t.sortStatus) + '</option>';
    $('sort').value = sortValue;
    Array.prototype.forEach.call(document.querySelectorAll('[data-setlang]'), function (el) {
      el.setAttribute('aria-pressed', String(el.dataset.setlang === lang));
    });
    $('viewGrid').setAttribute('aria-pressed', String(view === 'grid'));
    $('viewTable').setAttribute('aria-pressed', String(view === 'table'));
    $('scan').classList.toggle('hidden', typeof window.queryLocalFonts !== 'function');
  }

  /* ---------- запуск ---------- */

  async function init() {
    applyTheme();
    applyStaticText();

    $('theme').onclick = function () {
      theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('fonts_ui_theme', theme);
      applyTheme();
    };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (theme === 'auto') applyTheme();
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-setlang]'), function (el) {
      el.onclick = function () {
        lang = el.dataset.setlang;
        localStorage.setItem('fonts_ui_lang', lang);
        t = I18N[lang];
        DATA.forEach(finish);
        applyStaticText();
        render();
      };
    });

    $('viewGrid').onclick = function () { view = 'grid'; localStorage.setItem('fonts_ui_view', view); applyStaticText(); render(); };
    $('viewTable').onclick = function () { view = 'table'; localStorage.setItem('fonts_ui_view', view); applyStaticText(); render(); };

    $('scan').onclick = function () { syncInstalled({}); };
    $('pickfolder').onclick = pickFolder;
    $('filepick').onchange = function (e) { scanFiles(Array.from(e.target.files || [])); };

    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', async function (e) {
      var files = [];
      var items = e.dataTransfer.items;
      if (items && items.length && items[0].getAsFileSystemHandle) {
        for (var i = 0; i < items.length; i++) {
          try {
            var handle = await items[i].getAsFileSystemHandle();
            if (!handle) continue;
            if (handle.kind === 'directory') await filesFromDirectory(handle, files, 0);
            else files.push(await handle.getFile());
          } catch (err) {}
        }
      } else {
        files = Array.from(e.dataTransfer.files || []);
      }
      scanFiles(files);
    });
    drop.onclick = function () { $('filepick').click(); };

    $('sampletext').value = customText;
    $('sampletext').addEventListener('input', function () {
      customText = $('sampletext').value;
      localStorage.setItem('fonts_ui_text', customText);
      refreshSampleText();
      scheduleRepaint();
    });
    $('resettext').onclick = function () {
      customText = '';
      $('sampletext').value = '';
      localStorage.removeItem('fonts_ui_text');
      render();
    };

    $('sizerange').value = sampleSize;
    document.documentElement.style.setProperty('--sample-size', sampleSize + 'px');
    $('sizevalue').textContent = sampleSize;
    $('sizerange').addEventListener('input', function () {
      sampleSize = Number($('sizerange').value);
      localStorage.setItem('fonts_ui_size', sampleSize);
      document.documentElement.style.setProperty('--sample-size', sampleSize + 'px');
      $('sizevalue').textContent = sampleSize;
    });

    $('search').addEventListener('input', render);
    $('alphabet').addEventListener('change', render);
    $('sort').addEventListener('change', function () { sortData(); render(); });

    $('backup').onclick = function () {
      download('fonts-backup.json', JSON.stringify({
        version: 1, decisions: decisions, languageEdits: languageEdits, favorites: Array.from(favorites)
      }, null, 2));
    };
    $('restore').onclick = function () { $('restorefile').click(); };
    $('restorefile').onchange = async function (e) {
      try {
        var data = JSON.parse(await e.target.files[0].text());
        decisions = Object.assign(decisions, data.decisions || {});
        languageEdits = Object.assign(languageEdits, data.languageEdits || {});
        if (Array.isArray(data.favorites)) data.favorites.forEach(function (k) { favorites.add(String(k).toLocaleLowerCase()); });
        write('fonts_decisions', decisions);
        write('fonts_language_edits', languageEdits);
        write('fonts_favorites', Array.from(favorites));
        say('restored', {}, 'good');
      } catch (err) { say('restoreFailed', {}, 'bad'); }
      render();
    };
    $('exportCSV').onclick = exportCSV;
    $('clearAll').onclick = function () {
      if (!confirm(t.confirmClear)) return;
      ['fonts_catalog', 'fonts_decisions', 'fonts_language_edits', 'fonts_favorites'].forEach(function (k) {
        localStorage.removeItem(k);
      });
      DATA = []; decisions = {}; languageEdits = {}; favorites = new Set();
      message = null; liveOn = false;
      applyStaticText(); render();
    };

    var hadCatalog = loadCatalog();
    render();

    // Разрешение браузер помнит: если оно уже есть — подхватываем молча,
    // и дальше перепроверяем при каждом возврате на вкладку.
    var state = await permissionState();
    if (state === 'granted') {
      liveOn = true;
      renderLive();
      syncInstalled({ silent: true });
    } else if (!hadCatalog && state === 'prompt') {
      say('pressToStart', {}, '');
      render();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !liveOn) return;
      if (Date.now() - lastSync < 8000) return;
      syncInstalled({ silent: true });
    });
    window.addEventListener('focus', function () {
      if (!liveOn || Date.now() - lastSync < 8000) return;
      syncInstalled({ silent: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.__app = {
    load: async function (items) {
      var n = await ingest(items, {});
      say('doneScan', { families: DATA.length, faces: n }, 'good');
      render();
      return DATA.length;
    },
    sync: function (opts) { return syncInstalled(opts || {}); },
    data: function () { return DATA; },
    setView: function (v) { view = v; applyStaticText(); render(); }
  };
})();
