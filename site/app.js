/* ============================================================
   MiTaxi / TaxiMobility Documentation — client app
   Static, dependency-free: routing, rendering, search, i18n.
   ============================================================ */

const GUIDE_FILES = ['driver', 'passenger', 'admin', 'dispatcher', 'vendor'];
const GUIDE_ICONS = {
  driver: 'local_taxi',
  passenger: 'person',
  admin: 'admin_panel_settings',
  dispatcher: 'cell_tower',
  vendor: 'storefront',
};

const I18N = {
  en: {
    search_placeholder: 'Search documentation…',
    no_results: 'No matching results. Try a different keyword.',
    on_this_page: 'On this page',
    in_this_section: 'In this section',
    home: 'Home',
    prev: 'Previous',
    next: 'Next',
    home_title: 'Everything you need to run and support MiTaxi',
    home_lead: 'Complete, rewritten documentation for the MiTaxi Driver app, the MiTaxi Passenger app, and the TaxiMobility Admin Panel — fully searchable, and available in English and Spanish (México).',
    home_note: 'This site is a full rewrite of the TaxiMobility source manuals into structured, searchable documentation, with real screenshots throughout.',
    open_guide: 'Open guide',
    guides_label: 'Guides',
    theme_label: 'Toggle theme',
  },
  es: {
    search_placeholder: 'Buscar en la documentación…',
    no_results: 'No se encontraron resultados. Intente con otra palabra clave.',
    on_this_page: 'En esta página',
    in_this_section: 'En esta sección',
    home: 'Inicio',
    prev: 'Anterior',
    next: 'Siguiente',
    home_title: 'Todo lo que necesita para operar y respaldar MiTaxi',
    home_lead: 'Documentación completa y reescrita para la app MiTaxi para Conductores, la app MiTaxi para Pasajeros y el Panel de Administración de TaxiMobility — totalmente buscable y disponible en inglés y español (México).',
    home_note: 'Este sitio es una reescritura completa de los manuales originales de TaxiMobility en documentación estructurada y buscable, con capturas de pantalla reales en todo el contenido.',
    open_guide: 'Abrir guía',
    guides_label: 'Guías',
    theme_label: 'Cambiar tema',
  }
};

const state = {
  lang: localStorage.getItem('docs-lang') || 'es',
  guides: [],
  activeGuideId: null,
  collapsed: new Set(),
  searchIndex: [],
  searchActiveIndex: -1,
  searchItems: [],
};

const els = {
  sidebar: document.getElementById('sidebar-content'),
  content: document.getElementById('content'),
  otp: document.getElementById('on-this-page'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  langSwitch: document.getElementById('lang-switch'),
  themeToggle: document.getElementById('theme-toggle'),
  navToggle: document.getElementById('nav-toggle'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
};

function t(key) { return I18N[state.lang][key] || key; }

function icon(name, extraClass = '') {
  return `<span class="material-symbols-outlined${extraClass ? ' ' + extraClass : ''}" aria-hidden="true">${name}</span>`;
}

function getEffectiveTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  document.querySelectorAll('[data-logo]').forEach(img => {
    img.hidden = img.getAttribute('data-logo') !== theme;
  });
  document.querySelectorAll('.theme-icon').forEach(el => {
    el.hidden = el.getAttribute('data-icon') !== theme;
  });
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = theme === 'dark' ? 'assets/logo-dark.png' : 'assets/logo-light.png';
}

/* ---------------- Markdown (small controlled subset) ---------------- */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

function renderTableBlock(rows) {
  const cells = rows.map(r => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
  const header = cells[0];
  const body = cells.slice(2);
  let html = '<div class="table-wrap"><table><thead><tr>';
  html += header.map(h => `<th>${inline(h)}</th>`).join('');
  html += '</tr></thead><tbody>';
  for (const r of body) {
    html += '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

function lineIndent(line) {
  const m = line.match(/^[ \t]*/)[0];
  return m.replace(/\t/g, '  ').length;
}
function stripIndent(line) { return line.replace(/^[ \t]+/, ''); }

function lineType(line) {
  const s = stripIndent(line);
  if (s.trim() === '') return 'blank';
  if (/^\|.*\|\s*$/.test(s.trim())) return 'table';
  if (/^-\s+/.test(s)) return 'ul';
  if (/^\d+\.\s+/.test(s)) return 'ol';
  if (/^>\s?/.test(s)) return 'quote';
  if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(s.trim())) return 'image';
  return 'p';
}

function renderImageBlock(line) {
  const m = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
  if (!m) return '';
  const alt = m[1];
  const src = m[2];
  return `<figure class="doc-figure"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">${alt ? `<figcaption>${inline(alt)}</figcaption>` : ''}</figure>`;
}

/** Renders lines[start,end) at (or below) a given indentation level. */
function renderBlocks(lines, start, end) {
  let html = '';
  let i = start;
  while (i < end) {
    if (lines[i].trim() === '') { i++; continue; }
    const indent = lineIndent(lines[i]);
    const type = lineType(lines[i]);

    if (type === 'table') {
      const rows = [];
      while (i < end && lineType(lines[i]) === 'table') { rows.push(stripIndent(lines[i]).trim()); i++; }
      html += renderTableBlock(rows);
      continue;
    }
    if (type === 'quote') {
      const items = [];
      while (i < end && lineType(lines[i]) === 'quote') { items.push(stripIndent(lines[i]).replace(/^>\s?/, '')); i++; }
      html += `<blockquote><p>${items.map(inline).join('<br>')}</p></blockquote>`;
      continue;
    }
    if (type === 'image') {
      html += renderImageBlock(lines[i]);
      i++;
      continue;
    }
    if (type === 'ul' || type === 'ol') {
      const result = renderList(lines, i, end, indent, type);
      html += result.html;
      i = result.next;
      continue;
    }
    const para = [];
    while (i < end && lines[i].trim() !== '' && lineType(lines[i]) === 'p' && lineIndent(lines[i]) === indent) {
      para.push(stripIndent(lines[i])); i++;
    }
    if (para.length) html += `<p>${para.map(inline).join(' ')}</p>`;
    else i++;
  }
  return html;
}

/** Renders one list (ul/ol) starting at lines[i], including any indented sub-blocks nested under each item. */
function renderList(lines, i, end, baseIndent, kind) {
  const marker = kind === 'ul' ? /^-\s+/ : /^\d+\.\s+/;
  const items = [];
  while (i < end) {
    if (lines[i].trim() === '') {
      let j = i;
      while (j < end && lines[j].trim() === '') j++;
      if (j >= end || lineIndent(lines[j]) < baseIndent || (lineIndent(lines[j]) === baseIndent && lineType(lines[j]) !== kind)) { i = j; break; }
      i = j;
      continue;
    }
    const indent = lineIndent(lines[i]);
    if (indent < baseIndent) break;
    if (indent === baseIndent && lineType(lines[i]) === kind) {
      const text = stripIndent(lines[i]).replace(marker, '');
      i++;
      const subStart = i;
      while (i < end) {
        if (lines[i].trim() === '') {
          let j = i;
          while (j < end && lines[j].trim() === '') j++;
          if (j < end && lineIndent(lines[j]) > baseIndent) { i = j; continue; }
          break;
        }
        if (lineIndent(lines[i]) > baseIndent) { i++; continue; }
        break;
      }
      const subHtml = i > subStart ? renderBlocks(lines, subStart, i) : '';
      items.push(`<li>${inline(text)}${subHtml}</li>`);
      continue;
    }
    break;
  }
  const tag = kind === 'ul' ? 'ul' : 'ol';
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: i };
}

function renderMarkdown(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  return renderBlocks(lines, 0, lines.length);
}

function stripMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\|/g, ' ')
    .replace(/^[ \t]*[-*]\s+/gm, '')
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    .replace(/^[ \t]*>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------- Data loading & tree helpers ---------------- */

async function loadAll() {
  const results = await Promise.all(
    GUIDE_FILES.map(f => fetch(`content/${f}.json`).then(r => r.json()))
  );
  state.guides = results;
  buildSearchIndex();
}

function guideRoot(guide) {
  return {
    id: guide.id,
    number: null,
    title: guide.title,
    content: guide.tagline || { en: '', es: '' },
    children: guide.sections,
    isRoot: true,
  };
}

function findNode(guide, idsPath) {
  if (idsPath.length === 0) return guideRoot(guide);
  let nodes = guide.sections;
  let node = null;
  for (const id of idsPath) {
    node = (nodes || []).find(n => n.id === id);
    if (!node) return null;
    nodes = node.children || [];
  }
  return node;
}

function flattenGuide(guide) {
  const out = [];
  function walk(node, path) {
    out.push({ node, path: path.slice() });
    (node.children || []).forEach(c => walk(c, path.concat(c.id)));
  }
  const root = guideRoot(guide);
  walk(root, [guide.id]);
  return out;
}

function firstLeafPath(node, path) {
  if (!node.children || !node.children.length) return path;
  return firstLeafPath(node.children[0], path.concat(node.children[0].id));
}

/* ---------------- Search index ---------------- */

function buildSearchIndex() {
  const idx = [];
  for (const guide of state.guides) {
    const flat = flattenGuide(guide);
    for (const { node, path } of flat) {
      if (node.isRoot) continue;
      idx.push({
        guideId: guide.id,
        guideTitle: guide.title,
        path,
        title: node.title,
        text: { en: stripMarkdown(node.content && node.content.en), es: stripMarkdown(node.content && node.content.es) },
      });
    }
  }
  state.searchIndex = idx;
}

function breadcrumbTitles(path) {
  const guide = state.guides.find(g => g.id === path[0]);
  if (!guide) return [];
  const titles = [guide.title];
  let nodes = guide.sections;
  for (let i = 1; i < path.length; i++) {
    const node = (nodes || []).find(n => n.id === path[i]);
    if (!node) break;
    titles.push(node.title);
    nodes = node.children || [];
  }
  return titles;
}

/* ---------------- Routing ---------------- */

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  return raw ? raw.split('/').filter(Boolean) : [];
}

function navigate(path) {
  location.hash = '/' + path.join('/');
}

window.addEventListener('hashchange', render);

/* ---------------- Rendering: content ---------------- */

function renderHome() {
  const lang = state.lang;
  let html = `
    <div class="home-hero">
      <p class="page-kicker">MiTaxi &amp; TaxiMobility</p>
      <h1>${escapeHtml(t('home_title'))}</h1>
      <p>${escapeHtml(t('home_lead'))}</p>
    </div>
    <div class="home-grid">`;
  for (const guide of state.guides) {
    html += `
      <article class="home-card">
        <h3>${GUIDE_ICONS[guide.id] ? icon(GUIDE_ICONS[guide.id], 'guide-icon') : ''} ${escapeHtml(guide.title[lang])}</h3>
        <p>${escapeHtml(guide.tagline ? guide.tagline[lang] : '')}</p>
        <a href="#/${guide.id}">${escapeHtml(t('open_guide'))} →</a>
      </article>`;
  }
  html += `</div><p class="home-note">${escapeHtml(t('home_note'))}</p>`;
  els.content.innerHTML = html;
  els.otp.innerHTML = '';
}

function renderCrumbs(path) {
  const titles = breadcrumbTitles(path);
  const lang = state.lang;
  let html = `<a href="#/">${escapeHtml(t('home'))}</a>`;
  let acc = [];
  titles.forEach((title, i) => {
    acc.push(path[i]);
    html += ` <span class="sep">/</span> <a href="#/${acc.join('/')}">${escapeHtml(title[lang])}</a>`;
  });
  return `<div class="crumbs">${html}</div>`;
}

function renderNodePage(guide, node, path) {
  const lang = state.lang;
  let html = renderCrumbs(path);

  html += `<h1 class="page-title">${node.number ? `<span class="num">${node.number}</span>` : ''}${escapeHtml(node.title[lang])}</h1>`;

  const bodyMd = node.content ? node.content[lang] : '';
  if (bodyMd) {
    html += `<div class="prose">${renderMarkdown(bodyMd)}</div>`;
  }

  if (node.children && node.children.length) {
    html += `<ul class="child-toc">`;
    for (const child of node.children) {
      const childPath = path.concat(child.id);
      html += `<li><a href="#/${childPath.join('/')}"><span class="num">${child.number || ''}</span>${escapeHtml(child.title[lang])}</a></li>`;
    }
    html += `</ul>`;
  }

  const flat = flattenGuide(guide);
  const key = path.join('/');
  const i = flat.findIndex(f => f.path.join('/') === key);
  const prev = i > 0 ? flat[i - 1] : null;
  const next = i >= 0 && i < flat.length - 1 ? flat[i + 1] : null;
  html += `<div class="pagenav">`;
  html += prev ? `<a class="prev" href="#/${prev.path.join('/')}"><span class="dir">${escapeHtml(t('prev'))}</span>${escapeHtml(prev.node.title[lang])}</a>` : `<span></span>`;
  html += next ? `<a class="next" href="#/${next.path.join('/')}"><span class="dir">${escapeHtml(t('next'))}</span>${escapeHtml(next.node.title[lang])}</a>` : `<span></span>`;
  html += `</div>`;

  els.content.innerHTML = html;
  renderOtp(guide, node, path);
}

function renderOtp(guide, node, path) {
  if (!guide || !node) { els.otp.innerHTML = ''; return; }
  const lang = state.lang;
  let items = node.children && node.children.length ? node.children.map(c => ({ id: c.id, title: c.title, number: c.number })) : null;
  let heading = t('in_this_section');
  let basePath = path;
  if (!items) {
    const parentPath = path.slice(0, -1);
    const parent = findNode(guide, parentPath.slice(1));
    if (parent && parent.children) {
      items = parent.children.map(c => ({ id: c.id, title: c.title, number: c.number }));
      basePath = parentPath;
      heading = t('on_this_page');
    }
  }
  if (!items || !items.length) { els.otp.innerHTML = ''; return; }
  let html = `<div class="otp-title">${escapeHtml(heading)}</div><ul class="otp-list">`;
  for (const it of items) {
    const p = basePath.concat(it.id).join('/');
    const active = p === path.join('/') ? ' class="active"' : '';
    html += `<li><a href="#/${p}"${active}>${escapeHtml(it.title[lang])}</a></li>`;
  }
  html += `</ul>`;
  els.otp.innerHTML = html;
}

/* ---------------- Rendering: sidebar ---------------- */

function renderSidebar() {
  const lang = state.lang;
  let html = `<div class="nav-guide-switch" style="display:flex;gap:.4rem;margin-bottom:1rem;">`;
  for (const guide of state.guides) {
    const active = guide.id === state.activeGuideId;
    html += `<button data-guide="${guide.id}" class="lang-btn${active ? ' active' : ''}" style="flex:1;padding:.5rem .3rem;" title="${escapeHtml(guide.title[lang])}">${GUIDE_ICONS[guide.id] ? icon(GUIDE_ICONS[guide.id], 'guide-icon') : ''}</button>`;
  }
  html += `</div>`;

  const guide = state.guides.find(g => g.id === state.activeGuideId) || state.guides[0];
  if (guide) {
    html += `<div class="nav-guide">`;
    html += `<div class="nav-guide-title">${escapeHtml(guide.title[lang])}</div>`;
    html += renderNavList(guide.sections, [guide.id]);
    html += `</div>`;
  }
  els.sidebar.innerHTML = html;

  els.sidebar.querySelectorAll('[data-guide]').forEach(btn => {
    btn.addEventListener('click', () => {
      const gid = btn.getAttribute('data-guide');
      navigate([gid]);
      closeMobileNav();
    });
  });
  els.sidebar.querySelectorAll('.nav-caret').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.getAttribute('data-key');
      if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
      renderSidebar();
      highlightActiveNav();
    });
  });
  els.sidebar.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', () => closeMobileNav());
  });
  highlightActiveNav();
}

function renderNavList(nodes, parentPath) {
  const lang = state.lang;
  let html = `<ul class="nav-tree">`;
  for (const node of nodes) {
    const path = parentPath.concat(node.id);
    const key = path.join('/');
    const hasChildren = node.children && node.children.length;
    const collapsed = hasChildren && state.collapsed.has(key);
    html += `<li class="nav-node${collapsed ? ' collapsed' : ''}" data-key="${key}">`;
    html += `<div class="nav-row">`;
    if (hasChildren) {
      html += `<button class="nav-caret" data-key="${key}" aria-label="Toggle">${icon('chevron_right')}</button>`;
    } else {
      html += `<span class="nav-caret spacer"></span>`;
    }
    html += `<a class="nav-link" href="#/${path.join('/')}">${node.number ? `<span class="nav-num">${node.number}</span>` : ''}${escapeHtml(node.title[lang])}</a>`;
    html += `</div>`;
    if (hasChildren) html += renderNavList(node.children, path);
    html += `</li>`;
  }
  html += `</ul>`;
  return html;
}

function highlightActiveNav() {
  const current = parseHash().join('/');
  els.sidebar.querySelectorAll('.nav-node').forEach(li => {
    li.classList.toggle('active', li.getAttribute('data-key') === current);
  });
}

function ensureAncestorsExpanded(path) {
  for (let i = 1; i < path.length; i++) {
    state.collapsed.delete(path.slice(0, i).join('/'));
  }
}

/* ---------------- Main render ---------------- */

function render() {
  const path = parseHash();
  if (path.length === 0) {
    state.activeGuideId = state.guides[0] ? state.guides[0].id : null;
    renderSidebar();
    renderHome();
    document.title = 'MiTaxi & TaxiMobility Documentation';
    return;
  }
  const guide = state.guides.find(g => g.id === path[0]);
  if (!guide) { navigate([]); return; }
  state.activeGuideId = guide.id;
  const node = findNode(guide, path.slice(1));
  if (!node) {
    renderSidebar();
    els.content.innerHTML = `<div class="crumbs">${escapeHtml(guide.title[state.lang])}</div><p>Page not found.</p>`;
    els.otp.innerHTML = '';
    return;
  }
  ensureAncestorsExpanded(path);
  renderSidebar();
  renderNodePage(guide, node, path);
  document.title = `${node.title[state.lang]} · ${guide.title[state.lang]}`;
  window.scrollTo({ top: 0 });
}

/* ---------------- Search ---------------- */

function highlightSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text.slice(0, 140));
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 90);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  return escapeHtml(snippet).replace(re, m => `<mark>${escapeHtml(m)}</mark>`);
}

function runSearch(query) {
  const lang = state.lang;
  const q = query.trim();
  if (!q) { els.searchResults.classList.add('hidden'); els.searchResults.innerHTML = ''; return; }
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const entry of state.searchIndex) {
    const title = entry.title[lang] || '';
    const text = entry.text[lang] || '';
    const hay = (title + ' ' + text).toLowerCase();
    let score = 0;
    if (hay.includes(q.toLowerCase())) score += 10;
    for (const term of terms) { if (hay.includes(term)) score += 2; if (title.toLowerCase().includes(term)) score += 3; }
    if (score > 0) scored.push({ entry, score, text, title });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 20);
  state.searchItems = top;
  state.searchActiveIndex = -1;

  if (!top.length) {
    els.searchResults.innerHTML = `<div class="sr-empty">${escapeHtml(t('no_results'))}</div>`;
    els.searchResults.classList.remove('hidden');
    return;
  }

  let html = '';
  let lastGuide = null;
  top.forEach((item, i) => {
    const guideTitle = item.entry.guideTitle[lang];
    if (guideTitle !== lastGuide) {
      html += `<div class="sr-group-label">${escapeHtml(guideTitle)}</div>`;
      lastGuide = guideTitle;
    }
    const crumbs = breadcrumbTitles(item.entry.path).slice(1, -1).map(x => x[lang]).join(' › ');
    const snippet = item.text ? highlightSnippet(item.text, q) : '';
    html += `<a class="sr-item" data-index="${i}" href="#/${item.entry.path.join('/')}">
      <div class="sr-title">${escapeHtml(item.title)}</div>
      ${crumbs ? `<div class="sr-breadcrumb">${escapeHtml(crumbs)}</div>` : ''}
      ${snippet ? `<div class="sr-snippet">${snippet}</div>` : ''}
    </a>`;
  });
  els.searchResults.innerHTML = html;
  els.searchResults.classList.remove('hidden');
}

function setupSearch() {
  els.searchInput.addEventListener('input', () => runSearch(els.searchInput.value));
  els.searchInput.addEventListener('focus', () => { if (els.searchInput.value.trim()) els.searchResults.classList.remove('hidden'); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) els.searchResults.classList.add('hidden');
  });
  els.searchResults.addEventListener('click', () => els.searchResults.classList.add('hidden'));

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== els.searchInput) {
      e.preventDefault();
      els.searchInput.focus();
    }
    if (e.key === 'Escape') {
      els.searchResults.classList.add('hidden');
      els.searchInput.blur();
    }
  });

  els.searchInput.addEventListener('keydown', (e) => {
    const items = () => Array.from(els.searchResults.querySelectorAll('.sr-item'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.searchActiveIndex = Math.min(state.searchActiveIndex + 1, items().length - 1);
      updateSearchActive(items());
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.searchActiveIndex = Math.max(state.searchActiveIndex - 1, 0);
      updateSearchActive(items());
    } else if (e.key === 'Enter') {
      const arr = items();
      const el = arr[state.searchActiveIndex] || arr[0];
      if (el) { el.click(); }
    }
  });
}

function updateSearchActive(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === state.searchActiveIndex));
  const active = items[state.searchActiveIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

/* ---------------- Language & theme ---------------- */

function setLang(lang) {
  state.lang = lang;
  localStorage.setItem('docs-lang', lang);
  document.documentElement.lang = lang;
  els.searchInput.placeholder = t('search_placeholder');
  els.langSwitch.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-lang') === lang));
  render();
}

function setupLangSwitch() {
  els.langSwitch.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang')));
  });
}

function setupTheme() {
  applyTheme(getEffectiveTheme());
  els.themeToggle.addEventListener('click', () => {
    const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem('docs-theme', next);
    applyTheme(next);
  });
}

function setupMobileNav() {
  els.navToggle.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });
  els.sidebarBackdrop.addEventListener('click', closeMobileNav);
}
function closeMobileNav() { document.body.classList.remove('nav-open'); }

/* ---------------- Init ---------------- */

(async function init() {
  setupLangSwitch();
  setupTheme();
  setupSearch();
  setupMobileNav();
  els.searchInput.placeholder = t('search_placeholder');
  document.documentElement.lang = state.lang;
  els.langSwitch.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-lang') === state.lang));

  await loadAll();
  render();
})();
