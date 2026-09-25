/**
 * Lumi – Movie Website
 * Source API: https://phim.nguonc.com/api
 *
 * Architecture:
 *  - CacheStore  : in-memory TTL cache with localStorage persistence
 *  - API         : fetch wrapper with timeout, retry, CORS proxy
 *  - Auth        : localStorage-based mock auth (email/password + Google stub)
 *  - Router      : hash-based SPA router
 *  - UI helpers  : skeleton, toast, pagination, film card builder
 */

'use strict';

/* ═══════════════════════════════════════════════════════
   1. CONFIG
═══════════════════════════════════════════════════════ */
const CFG = {
  BASE: 'https://phim.nguonc.com/api',
  CACHE_TTL: {
    list: 5 * 60 * 1000,      // 5 min for list pages
    detail: 15 * 60 * 1000,   // 15 min for film detail
    search: 2 * 60 * 1000,    // 2 min for search results
  },
  TIMEOUT: 10000,              // 10s request timeout
  RETRY: 2,                    // max retries
  RETRY_DELAY: 800,            // ms between retries
  HERO_INTERVAL: 6000,         // hero banner rotation
  SEARCH_DEBOUNCE: 350,        // search input debounce
  ITEMS_PER_HOME_ROW: 12,      // cards per home section
};

/* ═══════════════════════════════════════════════════════
   2. CACHE
═══════════════════════════════════════════════════════ */
const Cache = (() => {
  const mem = new Map();
  const LS_KEY = 'lumi_cache_v2';

  // Restore from localStorage on boot
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const now = Date.now();
    for (const [k, v] of Object.entries(saved)) {
      if (v.exp > now) mem.set(k, v);
    }
  } catch (_) {}

  function persist() {
    try {
      const obj = {};
      for (const [k, v] of mem.entries()) obj[k] = v;
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
    } catch (_) {}
  }

  return {
    get(key) {
      const e = mem.get(key);
      if (!e) return null;
      if (Date.now() > e.exp) { mem.delete(key); return null; }
      return e.data;
    },
    set(key, data, ttl = CFG.CACHE_TTL.list) {
      mem.set(key, { data, exp: Date.now() + ttl });
      // Debounce persist
      clearTimeout(Cache._pt);
      Cache._pt = setTimeout(persist, 1500);
    },
    del(key) { mem.delete(key); },
    clear() { mem.clear(); try { localStorage.removeItem(LS_KEY); } catch(_){} },
    _pt: null,
  };
})();

/* ═══════════════════════════════════════════════════════
   3. API
═══════════════════════════════════════════════════════ */
const API = (() => {
  async function fetchWithTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), CFG.TIMEOUT);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  }

  async function req(url, ttl = CFG.CACHE_TTL.list) {
    const cached = Cache.get(url);
    if (cached) return cached;

    let lastErr;
    for (let i = 0; i <= CFG.RETRY; i++) {
      try {
        const data = await fetchWithTimeout(url);
        Cache.set(url, data, ttl);
        return data;
      } catch (e) {
        lastErr = e;
        if (i < CFG.RETRY) await sleep(CFG.RETRY_DELAY * (i + 1));
      }
    }
    throw lastErr;
  }

  return {
    // 1. List endpoints
    newUpdated: (page = 1) => req(`${CFG.BASE}/films/phim-moi-cap-nhat?page=${page}`),
    listBySlug: (slug, page = 1) => req(`${CFG.BASE}/films/danh-sach/${slug}?page=${page}`),

    // 2. Detail
    detail: (slug) => req(`${CFG.BASE}/film/${slug}`, CFG.CACHE_TTL.detail),

    // 3. Filters
    byGenre:   (slug, page = 1) => req(`${CFG.BASE}/films/the-loai/${slug}?page=${page}`),
    byCountry: (slug, page = 1) => req(`${CFG.BASE}/films/quoc-gia/${slug}?page=${page}`),
    byYear:    (year, page = 1) => req(`${CFG.BASE}/films/nam-phat-hanh/${year}?page=${page}`),
    byLang:    (slug, page = 1) => req(`${CFG.BASE}/films/ngon-ngu/${slug}?page=${page}`),

    // 4. Search
    search: (kw) => req(`${CFG.BASE}/films/search?keyword=${encodeURIComponent(kw)}`, CFG.CACHE_TTL.search),
  };
})();

/* ═══════════════════════════════════════════════════════
   4. AUTH (localStorage mock)
═══════════════════════════════════════════════════════ */
const Auth = (() => {
  const LS = 'lumi_user';
  let user = null;

  try { user = JSON.parse(localStorage.getItem(LS)); } catch(_) {}

  function save(u) {
    user = u;
    localStorage.setItem(LS, JSON.stringify(u));
  }

  return {
    current: () => user,
    isLoggedIn: () => !!user,

    login(email, password) {
      // Mock: any valid-looking email + password ≥ 6 chars
      if (!email.includes('@')) return { ok: false, err: 'Email không hợp lệ.' };
      if (password.length < 6) return { ok: false, err: 'Mật khẩu phải có ít nhất 6 ký tự.' };
      const name = email.split('@')[0].replace(/[._]/g, ' ');
      save({ name, email, avatar: name[0].toUpperCase() });
      return { ok: true };
    },

    signup(name, email, password) {
      if (!name.trim()) return { ok: false, err: 'Vui lòng nhập họ tên.' };
      if (!email.includes('@')) return { ok: false, err: 'Email không hợp lệ.' };
      if (password.length < 6) return { ok: false, err: 'Mật khẩu phải có ít nhất 6 ký tự.' };
      save({ name: name.trim(), email, avatar: name.trim()[0].toUpperCase() });
      return { ok: true };
    },

    googleLogin() {
      const name = 'Người dùng Google';
      save({ name, email: 'google@gmail.com', avatar: 'G' });
      return { ok: true };
    },

    logout() {
      user = null;
      localStorage.removeItem(LS);
    },

    getFavs() {
      try { return JSON.parse(localStorage.getItem('lumi_favs') || '[]'); } catch(_) { return []; }
    },
    isFav(slug) { return Auth.getFavs().some(f => f.slug === slug); },
    toggleFav(film) {
      const favs = Auth.getFavs();
      const idx = favs.findIndex(f => f.slug === film.slug);
      if (idx >= 0) favs.splice(idx, 1);
      else favs.unshift({ slug: film.slug, name: film.name, thumb_url: film.thumb_url });
      localStorage.setItem('lumi_favs', JSON.stringify(favs.slice(0, 100)));
    },
  };
})();

/* ═══════════════════════════════════════════════════════
   5. HELPERS
═══════════════════════════════════════════════════════ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function toast(msg, dur = 2800) {
  const t = qs('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), dur);
}

function makeSkeletons(n = 8, container) {
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const c = el('div', 'film-card skeleton');
    c.innerHTML = `<div class="skeleton-overlay"></div>`;
    container.appendChild(c);
  }
}

function buildCard(film) {
  const card = el('div', 'film-card');
  card.dataset.slug = film.slug;

  const ep = film.current_episode || '';
  const qual = film.quality || '';
  const lang = film.language || '';

  card.innerHTML = `
    <img src="${film.thumb_url}" alt="${film.name}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 240%22><rect fill=%22%231e1e28%22 width=%22160%22 height=%22240%22/><text x=%2280%22 y=%22130%22 text-anchor=%22middle%22 fill=%22%236b6b88%22 font-size=%2240%22>🎬</text></svg>'" />
    <div class="film-card-overlay">
      <div class="film-card-title">${film.name}</div>
      ${ep ? `<div class="film-card-ep">${ep}</div>` : ''}
    </div>
    <div class="film-card-badges">
      ${qual ? `<span class="badge quality">${qual}</span>` : ''}
      ${lang ? `<span class="badge lang">${lang}</span>` : ''}
    </div>
    <div class="film-card-play"><div class="play-circle">▶</div></div>
  `;

  card.addEventListener('click', () => Router.go('detail', { slug: film.slug }));
  return card;
}

function renderFilms(items, container) {
  container.innerHTML = '';
  if (!items || !items.length) return false;
  items.forEach(f => container.appendChild(buildCard(f)));
  return true;
}

function buildPagination(current, total, onPage) {
  const p = qs('#pagination');
  p.innerHTML = '';
  if (total <= 1) return;

  const maxVisible = 7;
  const pages = [];

  if (total <= maxVisible) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    const left = Math.max(2, current - 2);
    const right = Math.min(total - 1, current + 2);
    if (left > 2) pages.push('…');
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < total - 1) pages.push('…');
    pages.push(total);
  }

  const prev = el('button', `page-btn${current === 1 ? ' disabled' : ''}`, '‹');
  prev.disabled = current === 1;
  prev.addEventListener('click', () => onPage(current - 1));
  p.appendChild(prev);

  pages.forEach(pg => {
    if (pg === '…') {
      p.appendChild(el('span', 'page-ellipsis', '…'));
    } else {
      const b = el('button', `page-btn${pg === current ? ' active' : ''}`, String(pg));
      b.addEventListener('click', () => { if (pg !== current) onPage(pg); });
      p.appendChild(b);
    }
  });

  const next = el('button', `page-btn${current === total ? ' disabled' : ''}`, '›');
  next.disabled = current === total;
  next.addEventListener('click', () => onPage(current + 1));
  p.appendChild(next);
}

/* ═══════════════════════════════════════════════════════
   6. THEME
═══════════════════════════════════════════════════════ */
const Theme = (() => {
  const saved = localStorage.getItem('lumi_theme') || 'dark';
  document.documentElement.dataset.theme = saved;

  function update(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('lumi_theme', t);
    qs('#themeIcon').textContent = t === 'dark' ? '☀' : '☾';
  }

  update(saved);

  return {
    toggle() {
      const cur = document.documentElement.dataset.theme;
      update(cur === 'dark' ? 'light' : 'dark');
    }
  };
})();

/* ═══════════════════════════════════════════════════════
   7. ROUTER
═══════════════════════════════════════════════════════ */
const Router = (() => {
  const pages = {
    home:    qs('#pageHome'),
    list:    qs('#pageList'),
    detail:  qs('#pageDetail'),
    watch:   qs('#pageWatch'),
  };

  let current = null;

  function show(name) {
    Object.values(pages).forEach(p => p.classList.remove('active'));
    pages[name]?.classList.add('active');
    current = name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Highlight nav
  function highlightNav(pageKey) {
    qsa('.nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.page === pageKey);
    });
  }

  return {
    go(page, params = {}) {
      show(page);
      switch (page) {
        case 'home':
          highlightNav('home');
          Home.init();
          break;
        case 'list':
          highlightNav(params.slug || '');
          List.load(params);
          break;
        case 'detail':
          highlightNav('');
          Detail.load(params.slug);
          break;
        case 'watch':
          highlightNav('');
          Watch.load(params);
          break;
      }
    },
    current: () => current,
  };
})();

/* ═══════════════════════════════════════════════════════
   8. HOME PAGE
═══════════════════════════════════════════════════════ */
const Home = (() => {
  let heroFilms = [];
  let heroIdx = 0;
  let heroTimer = null;
  let heroTouched = false; // track if user touched hero
  let initialized = false;

  // ── Hero ──────────────────────────────────
  function initHero(films) {
    heroFilms = films.slice(0, 8);
    heroIdx = 0;
    renderHero(heroIdx);
    renderDots();
    clearInterval(heroTimer);
    heroTimer = setInterval(() => {
      heroIdx = (heroIdx + 1) % heroFilms.length;
      renderHero(heroIdx);
      updateDots();
    }, CFG.HERO_INTERVAL);
  }

  function renderHero(idx) {
    const f = heroFilms[idx];
    if (!f) return;
    const bg = qs('#heroBg');
    bg.style.backgroundImage = `url('${f.poster_url || f.thumb_url}')`;

    const cats = getCategoryList(f);

    qs('#heroContent').innerHTML = `
      <div class="hero-badges">
        ${cats.genre ? `<span class="badge">${cats.genre}</span>` : ''}
        ${f.quality ? `<span class="badge quality">${f.quality}</span>` : ''}
        ${f.language ? `<span class="badge lang">${f.language}</span>` : ''}
      </div>
      <div class="hero-title">${f.name}</div>
      ${f.original_name ? `<div class="hero-original">${f.original_name}</div>` : ''}
      <div class="hero-desc">${f.description || ''}</div>
      <div class="hero-meta-row">
        ${f.year ? `<div class="hero-meta-item"><strong>${f.year}</strong></div>` : ''}
        ${f.current_episode ? `<div class="hero-meta-item"><strong>${f.current_episode}</strong></div>` : ''}
        ${f.time ? `<div class="hero-meta-item">${f.time}</div>` : ''}
      </div>
      <div class="hero-actions">
        <button class="hero-play-btn" data-slug="${f.slug}">▶ &nbsp; Xem ngay</button>
        <button class="hero-info-btn" data-slug="${f.slug}">ℹ &nbsp; Chi tiết</button>
      </div>
    `;

    // Bind buttons
    qs('[data-slug].hero-play-btn', qs('#heroContent'))?.addEventListener('click', () => {
      Router.go('detail', { slug: f.slug, autoPlay: true });
    });
    qs('[data-slug].hero-info-btn', qs('#heroContent'))?.addEventListener('click', () => {
      Router.go('detail', { slug: f.slug });
    });
  }

  function renderDots() {
    const d = qs('#heroDots');
    d.innerHTML = '';
    heroFilms.forEach((_, i) => {
      const dot = el('div', `hero-dot${i === 0 ? ' active' : ''}`);
      dot.addEventListener('click', () => {
        heroIdx = i; renderHero(i); updateDots();
        clearInterval(heroTimer);
        heroTimer = setInterval(() => {
          heroIdx = (heroIdx + 1) % heroFilms.length;
          renderHero(heroIdx); updateDots();
        }, CFG.HERO_INTERVAL);
      });
      d.appendChild(dot);
    });
  }

  function updateDots() {
    qsa('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === heroIdx));
  }

  // ── Rows ──────────────────────────────────
  async function loadRow(fetchFn, containerId, slug) {
    const container = qs(`#${containerId}`);
    makeSkeletons(CFG.ITEMS_PER_HOME_ROW, container);
    try {
      const data = await fetchFn;
      const items = (data.items || []).slice(0, CFG.ITEMS_PER_HOME_ROW);
      renderFilms(items, container);
      return items;
    } catch (e) {
      container.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:20px">Không tải được nội dung. <button onclick="Home.init()" style="color:var(--accent);background:none;border:none;cursor:pointer;font-size:13px">Thử lại</button></div>`;
      return [];
    }
  }

  return {
    async init() {
      if (initialized) return;
      initialized = true;

      // Load all rows in parallel — allSettled so one error won't block the rest
      const results = await Promise.allSettled([
        loadRow(API.newUpdated(1), 'rowNew', 'new'),
        loadRow(API.listBySlug('phim-le', 1), 'rowPhimLe', 'phim-le'),
        loadRow(API.listBySlug('phim-bo', 1), 'rowPhimBo', 'phim-bo'),
        loadRow(API.listBySlug('phim-chieu-rap', 1), 'rowRap', 'phim-chieu-rap'),
      ]);

      // Hero from new films
      const newResult = results[0];
      if (newResult.status === 'fulfilled' && newResult.value?.length) {
        initHero(newResult.value);
      }

      // Load filter options
      FilterBar.init();
    },
    reset() { initialized = false; },
  };
})();

/* ═══════════════════════════════════════════════════════
   9. FILTER BAR (dropdown options)
═══════════════════════════════════════════════════════ */
const FilterBar = (() => {
  const GENRES = [
    {v:'hanh-dong',l:'Hành Động'},{v:'tinh-cam',l:'Tình Cảm'},{v:'hai-huoc',l:'Hài Hước'},
    {v:'co-trang',l:'Cổ Trang'},{v:'tam-ly',l:'Tâm Lý'},{v:'kinh-di',l:'Kinh Dị'},
    {v:'vien-tuong',l:'Viễn Tưởng'},{v:'phieu-luu',l:'Phiêu Lưu'},{v:'hoat-hinh',l:'Hoạt Hình'},
    {v:'tai-lieu',l:'Tài Liệu'},{v:'am-nhac',l:'Âm Nhạc'},{v:'the-thao',l:'Thể Thao'},
    {v:'bi-an',l:'Bí Ẩn'},{v:'chien-tranh',l:'Chiến Tranh'},{v:'lich-su',l:'Lịch Sử'},
    {v:'gia-dinh',l:'Gia Đình'},{v:'vo-thuat',l:'Võ Thuật'},{v:'kinh-dien',l:'Kinh Điển'},
    {v:'the-gioi-dong-vat',l:'Thế Giới Động Vật'},
  ];
  const COUNTRIES = [
    {v:'my',l:'Mỹ'},{v:'han-quoc',l:'Hàn Quốc'},{v:'trung-quoc',l:'Trung Quốc'},
    {v:'nhat-ban',l:'Nhật Bản'},{v:'thai-lan',l:'Thái Lan'},{v:'phap',l:'Pháp'},
    {v:'anh',l:'Anh'},{v:'an-do',l:'Ấn Độ'},{v:'viet-nam',l:'Việt Nam'},
    {v:'hong-kong',l:'Hong Kong'},{v:'dai-loan',l:'Đài Loan'},{v:'duc',l:'Đức'},
    {v:'tay-ban-nha',l:'Tây Ban Nha'},{v:'y',l:'Ý'},{v:'uc',l:'Úc'},
    {v:'canada',l:'Canada'},{v:'philippines',l:'Philippines'},
  ];
  const LANGS = [
    {v:'vietsub',l:'Vietsub'},{v:'thuyet-minh',l:'Thuyết minh'},{v:'long-tieng',l:'Lồng tiếng'},
  ];

  function fillSelect(selId, opts) {
    const sel = qs(`#${selId}`);
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.l;
      sel.appendChild(opt);
    });
  }

  // Fill year from 2010 to current
  function fillYears() {
    const sel = qs('#filterYear');
    const cur = new Date().getFullYear();
    for (let y = cur; y >= 2010; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      sel.appendChild(o);
    }
  }

  let inited = false;
  return {
    init() {
      if (inited) return; inited = true;
      fillSelect('filterGenre', GENRES);
      fillSelect('filterCountry', COUNTRIES);
      fillSelect('filterLang', LANGS);
      fillYears();
    },
    getGenres: () => GENRES,
    getCountries: () => COUNTRIES,
  };
})();

/* ═══════════════════════════════════════════════════════
   10. LIST PAGE
═══════════════════════════════════════════════════════ */
const List = (() => {
  let state = {};

  const LABELS = {
    'new': 'Mới cập nhật',
    'phim-le': 'Phim lẻ',
    'phim-bo': 'Phim bộ',
    'phim-chieu-rap': 'Chiếu rạp',
    'hoat-hinh': 'Hoạt hình',
  };

  async function fetchPage(params, page) {
    const { type, slug, keyword, genre, country, year, lang, _favs } = params;
    if (_favs)   return { items: _favs, paginate: { current_page: 1, total_page: 1 } };
    if (keyword) return API.search(keyword);
    if (genre)   return API.byGenre(genre, page);
    if (country) return API.byCountry(country, page);
    if (year)    return API.byYear(year, page);
    if (lang)    return API.byLang(lang, page);
    if (type === 'new') return API.newUpdated(page);
    return API.listBySlug(slug || type, page);
  }

  function getTitle(params) {
    if (params.title) return params.title;
    if (params.keyword) return `Kết quả: "${params.keyword}"`;
    return LABELS[params.slug || params.type] || 'Danh sách phim';
  }

  async function render(params, page = 1) {
    state = { params, page };

    const grid = qs('#filmGrid');
    const empty = qs('#emptyState');
    const pagi = qs('#pagination');
    empty.classList.add('hidden');
    pagi.innerHTML = '';
    makeSkeletons(24, grid);

    qs('#listTitle').textContent = getTitle(params);
    qs('#listMeta').textContent = '';

    try {
      const data = await fetchPage(params, page);
      const items = data.items || [];

      if (!items.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }

      const pg = data.paginate || {};
      const totalPage = pg.total_page || 1;
      const totalItems = pg.total_items || items.length;

      qs('#listMeta').textContent = `${totalItems.toLocaleString()} phim · Trang ${page}/${totalPage}`;
      renderFilms(items, grid);

      // Only show pagination if not search (search returns all results at once)
      if (!params.keyword) {
        buildPagination(page, totalPage, (p) => render(params, p));
      }
    } catch (e) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text3)">
          <div style="font-size:40px;margin-bottom:14px">📡</div>
          <h3 style="color:var(--text);margin-bottom:8px">Không thể tải phim</h3>
          <p>Kiểm tra kết nối và thử lại.</p>
          <button onclick="List.reload()" style="margin-top:16px;padding:10px 22px;border-radius:8px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-weight:600">Thử lại</button>
        </div>`;
    }
  }

  return {
    load(params) { render(params, params.page || 1); },
    reload() { render(state.params, state.page); },
  };
})();

/* ═══════════════════════════════════════════════════════
   11. DETAIL PAGE
═══════════════════════════════════════════════════════ */
const Detail = (() => {
  let currentFilm = null;

  function getCats(movie) {
    const result = { format: [], genre: [], year: [], country: [] };
    const cat = movie.category || {};
    Object.values(cat).forEach(c => {
      const grp = c.group?.name?.toLowerCase() || '';
      const list = c.list?.map(x => x.name) || [];
      if (grp.includes('định dạng') || grp.includes('format')) result.format = list;
      else if (grp.includes('thể loại') || grp.includes('genre')) result.genre = list;
      else if (grp.includes('năm') || grp.includes('year')) result.year = list;
      else if (grp.includes('quốc') || grp.includes('country')) result.country = list;
    });
    return result;
  }

  function renderCatTags(cats, type) {
    const items = cats[type] || [];
    if (!items.length) return '';
    const map = { genre: 'the-loai', country: 'quoc-gia', year: 'nam-phat-hanh' };
    return items.map(n => {
      const slug = toSlug(n);
      return `<span class="cat-tag" data-filter="${type}" data-slug="${slug}" data-name="${n}">${n}</span>`;
    }).join('');
  }

  async function load(slug) {
    const container = qs('#detailContent');
    container.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--text3)">
      <div class="skeleton-box" style="width:200px;height:300px;margin:0 auto 24px"></div>
      <div class="skeleton-box" style="width:60%;height:28px;margin:0 auto 12px"></div>
      <div class="skeleton-box" style="width:40%;height:16px;margin:0 auto"></div>
    </div>`;

    try {
      const data = await API.detail(slug);
      const movie = data.movie;
      currentFilm = movie;
      const cats = getCats(movie);
      const isFav = Auth.isFav(slug);

      container.innerHTML = `
        <div class="detail-hero">
          <div class="detail-poster">
            <img src="${movie.poster_url || movie.thumb_url}" alt="${movie.name}" onerror="this.src='${movie.thumb_url}'" />
          </div>
          <div class="detail-info">
            <div class="detail-badges">
              ${cats.format.map(f => `<span class="badge">${f}</span>`).join('')}
              ${movie.quality ? `<span class="badge quality">${movie.quality}</span>` : ''}
              ${movie.language ? `<span class="badge lang">${movie.language}</span>` : ''}
            </div>
            <div class="detail-title">${movie.name}</div>
            ${movie.original_name ? `<div class="detail-original">${movie.original_name}</div>` : ''}
            <div class="detail-meta">
              ${movie.year ? `<div class="meta-item"><span class="meta-label">Năm</span><span class="meta-value">${movie.year}</span></div>` : ''}
              ${movie.current_episode ? `<div class="meta-item"><span class="meta-label">Tập hiện tại</span><span class="meta-value">${movie.current_episode}</span></div>` : ''}
              ${movie.total_episodes ? `<div class="meta-item"><span class="meta-label">Tổng tập</span><span class="meta-value">${movie.total_episodes}</span></div>` : ''}
              ${movie.time ? `<div class="meta-item"><span class="meta-label">Thời lượng</span><span class="meta-value">${movie.time}</span></div>` : ''}
              ${movie.director ? `<div class="meta-item"><span class="meta-label">Đạo diễn</span><span class="meta-value">${movie.director}</span></div>` : ''}
              ${movie.casts ? `<div class="meta-item" style="grid-column:1/-1"><span class="meta-label">Diễn viên</span><span class="meta-value">${movie.casts}</span></div>` : ''}
            </div>
            ${movie.description ? `<div class="detail-desc">${movie.description}</div>` : ''}
            <div class="detail-actions">
              <button class="watch-btn" id="watchNowBtn">▶ &nbsp; Xem ngay</button>
              <button class="fav-btn ${isFav ? 'active' : ''}" id="favBtn">${isFav ? '♥' : '♡'} &nbsp; ${isFav ? 'Đã yêu thích' : 'Yêu thích'}</button>
            </div>
            <div>
              ${cats.genre.length ? `<div style="margin-bottom:8px"><span class="meta-label" style="display:inline;margin-right:8px">Thể loại:</span><span class="cat-tags">${renderCatTags(cats,'genre')}</span></div>` : ''}
              ${cats.country.length ? `<div style="margin-bottom:8px"><span class="meta-label" style="display:inline;margin-right:8px">Quốc gia:</span><span class="cat-tags">${renderCatTags(cats,'country')}</span></div>` : ''}
              ${cats.year.length ? `<div><span class="meta-label" style="display:inline;margin-right:8px">Năm:</span><span class="cat-tags">${renderCatTags(cats,'year')}</span></div>` : ''}
            </div>
          </div>
        </div>
      `;

      // Watch Now
      qs('#watchNowBtn').addEventListener('click', () => {
        const eps = movie.episodes || [];
        const server = eps[0];
        if (!server || !server.items?.length) { toast('Chưa có tập phim nào.'); return; }
        const firstEp = server.items[0];
        Router.go('watch', { movie, serverIdx: 0, epIdx: 0, embed: firstEp.embed });
      });

      // Fav
      qs('#favBtn').addEventListener('click', () => {
        if (!Auth.isLoggedIn()) { toast('Đăng nhập để lưu phim yêu thích!'); openAuth(); return; }
        Auth.toggleFav(movie);
        const f = Auth.isFav(slug);
        const btn = qs('#favBtn');
        btn.innerHTML = `${f ? '♥' : '♡'} &nbsp; ${f ? 'Đã yêu thích' : 'Yêu thích'}`;
        btn.classList.toggle('active', f);
        toast(f ? 'Đã thêm vào yêu thích!' : 'Đã xoá khỏi yêu thích');
      });

      // Cat tags click
      qsa('.cat-tag', container).forEach(tag => {
        tag.addEventListener('click', () => {
          const filter = tag.dataset.filter;
          const slug2 = tag.dataset.slug;
          const name = tag.dataset.name;
          const params = {};
          if (filter === 'genre') params.genre = slug2;
          else if (filter === 'country') params.country = slug2;
          else if (filter === 'year') params.year = slug2;
          params.title = name;
          Router.go('list', params);
        });
      });

    } catch (e) {
      container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text3)">
        <div style="font-size:40px;margin-bottom:14px">⚠</div>
        <h3 style="color:var(--text)">Không tải được thông tin phim</h3>
        <button onclick="Detail.load('${slug}')" style="margin-top:16px;padding:10px 22px;border-radius:8px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-weight:600">Thử lại</button>
      </div>`;
    }
  }

  return {
    load,
    current: () => currentFilm,
  };
})();

/* ═══════════════════════════════════════════════════════
   12. WATCH PAGE
═══════════════════════════════════════════════════════ */
const Watch = (() => {
  let state = {};

  function load({ movie, serverIdx = 0, epIdx = 0 }) {
    state = { movie, serverIdx, epIdx };
    const eps = movie.episodes || [];
    if (!eps.length) { toast('Chưa có nguồn phim.'); Router.go('detail', { slug: movie.slug }); return; }

    // Build server tabs
    const serverTabs = qs('#serverTabs');
    serverTabs.innerHTML = '';
    eps.forEach((srv, si) => {
      const t = el('button', `server-tab${si === serverIdx ? ' active' : ''}`, srv.server_name);
      t.addEventListener('click', () => loadServer(si, 0));
      serverTabs.appendChild(t);
    });

    loadServer(serverIdx, epIdx);
  }

  function loadServer(si, ei) {
    state.serverIdx = si; state.epIdx = ei;
    const eps = state.movie.episodes || [];
    const server = eps[si];
    if (!server) return;

    // Highlight server tabs
    qsa('.server-tab').forEach((t, i) => t.classList.toggle('active', i === si));

    // Build ep grid
    const grid = qs('#epGrid');
    grid.innerHTML = '';
    (server.items || []).forEach((ep, idx) => {
      const b = el('button', `ep-btn${idx === ei ? ' active' : ''}`, ep.name);
      b.title = ep.name;
      b.addEventListener('click', () => loadEp(si, idx, ep.embed));
      grid.appendChild(b);
    });

    // Scroll active ep into view
    const activeBtn = qs('.ep-btn.active', grid);
    activeBtn?.scrollIntoView({ block: 'nearest' });

    const ep = server.items[ei];
    if (ep) loadEp(si, ei, ep.embed);
  }

  function loadEp(si, ei, embed) {
    state.serverIdx = si; state.epIdx = ei;

    // Highlight ep btn
    qsa('.ep-btn').forEach((b, i) => b.classList.toggle('active', i === ei));

    const ep = (state.movie.episodes[si]?.items || [])[ei];
    qs('#playerTitle').textContent = `${state.movie.name} — Tập ${ep?.name || ''}`;
    qs('#playerFrame').src = embed || '';
  }

  return {
    load,
    state: () => state,
  };
})();

/* ═══════════════════════════════════════════════════════
   13. SEARCH
═══════════════════════════════════════════════════════ */
const Search = (() => {
  const input = qs('#globalSearch');
  const dropdown = qs('#searchDropdown');

  const doSearch = debounce(async (kw) => {
    const trimmed = kw.trim();
    if (trimmed.length < 2) { dropdown.classList.remove('active'); return; }
    dropdown.innerHTML = `<div class="sd-loading">Đang tìm...</div>`;
    dropdown.classList.add('active');
    try {
      const data = await API.search(trimmed);
      const items = (data.items || []).slice(0, 10);
      if (!items.length) {
        dropdown.innerHTML = `<div class="sd-empty">Không tìm thấy phim nào</div>`;
        return;
      }
      dropdown.innerHTML = '';
      items.forEach(f => {
        const item = el('div', 'sd-item');
        item.innerHTML = `
          <img src="${f.thumb_url}" alt="${f.name}" onerror="this.style.display='none'" />
          <div class="sd-info">
            <div class="sd-name">${f.name}</div>
            <div class="sd-sub">${f.year || ''} ${f.current_episode ? '· ' + f.current_episode : ''} ${f.language ? '· ' + f.language : ''}</div>
          </div>
        `;
        item.addEventListener('click', () => {
          dropdown.classList.remove('active');
          input.value = '';
          Router.go('detail', { slug: f.slug });
        });
        dropdown.appendChild(item);
      });
    } catch (_) {
      dropdown.innerHTML = `<div class="sd-empty">Lỗi tìm kiếm, thử lại sau.</div>`;
    }
  }, CFG.SEARCH_DEBOUNCE);

  input.addEventListener('input', e => doSearch(e.target.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const kw = input.value.trim();
      if (kw.length >= 2) {
        dropdown.classList.remove('active');
        input.value = '';
        Router.go('list', { keyword: kw });
      }
    }
    if (e.key === 'Escape') dropdown.classList.remove('active');
  });

  document.addEventListener('click', e => {
    if (!qs('#globalSearchWrap').contains(e.target)) dropdown.classList.remove('active');
  });
})();

/* ═══════════════════════════════════════════════════════
   14. AUTH UI
═══════════════════════════════════════════════════════ */
function openAuth(tab = 'login') {
  qs('#authModal').classList.remove('hidden');
  switchAuthTab(tab);
}

function closeAuth() {
  qs('#authModal').classList.add('hidden');
}

function switchAuthTab(tab) {
  qsa('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  qs('#loginForm').classList.toggle('hidden', tab !== 'login');
  qs('#signupForm').classList.toggle('hidden', tab !== 'signup');
}

function updateAuthUI() {
  const user = Auth.current();
  const btn = qs('#authBtn');
  if (user) {
    qs('#avatarIcon').textContent = user.avatar || '👤';
    qs('#authLabel').textContent = user.name?.split(' ')[0] || 'Tôi';
    btn.title = user.email;
  } else {
    qs('#avatarIcon').textContent = '👤';
    qs('#authLabel').textContent = 'Đăng nhập';
  }
}

// Create user menu dropdown
function buildUserMenu() {
  let menu = qs('#userMenu');
  if (!menu) {
    menu = el('div', 'user-menu', '');
    menu.id = 'userMenu';
    qs('.top-actions').appendChild(menu);
  }
  const user = Auth.current();
  if (!user) { menu.classList.remove('open'); return; }
  menu.innerHTML = `
    <div class="user-menu-header">
      <div class="user-menu-name">${user.name}</div>
      <div class="user-menu-email">${user.email}</div>
    </div>
    <button class="user-menu-item" id="menuFavs">♥ &nbsp; Phim yêu thích</button>
    <button class="user-menu-item danger" id="menuLogout">Đăng xuất</button>
  `;
  qs('#menuFavs').addEventListener('click', () => {
    menu.classList.remove('open');
    const favs = Auth.getFavs();
    if (!favs.length) { toast('Chưa có phim yêu thích.'); return; }
    Router.go('list', { keyword: '', title: 'Phim yêu thích', _favs: favs });
    // Override grid with favs
    setTimeout(() => {
      const grid = qs('#filmGrid');
      renderFilms(favs, grid);
      qs('#listMeta').textContent = `${favs.length} phim`;
    }, 50);
  });
  qs('#menuLogout').addEventListener('click', () => {
    Auth.logout();
    updateAuthUI();
    menu.classList.remove('open');
    toast('Đã đăng xuất.');
  });
  menu.classList.add('open');
  setTimeout(() => {
    document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
  }, 10);
}

/* ═══════════════════════════════════════════════════════
   15. UTILITIES
═══════════════════════════════════════════════════════ */
function toSlug(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g,'d').replace(/[^a-z0-9\s-]/g,'')
    .trim().replace(/\s+/g,'-');
}

function getCategoryList(film) {
  // Extract category names from flat film object (used in home sections)
  return { genre: '', country: '', year: film.year || '' };
}

/* ═══════════════════════════════════════════════════════
   16. EVENT WIRING
═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Theme toggle
  qs('#themeToggle').addEventListener('click', () => Theme.toggle());

  // Auth button
  qs('#authBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (Auth.isLoggedIn()) buildUserMenu();
    else openAuth('login');
  });

  // Auth modal close
  qs('[data-close="authModal"]').addEventListener('click', closeAuth);
  qs('#authModal').addEventListener('click', e => {
    if (e.target === qs('#authModal')) closeAuth();
  });

  // Auth tabs
  qsa('.auth-tab').forEach(t => {
    t.addEventListener('click', () => switchAuthTab(t.dataset.tab));
  });

  // Login form
  qs('#loginFormEl').addEventListener('submit', e => {
    e.preventDefault();
    const email = qs('#loginEmail').value;
    const pw = qs('#loginPassword').value;
    const res = Auth.login(email, pw);
    const errEl = qs('#loginError');
    if (!res.ok) {
      errEl.textContent = res.err;
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
      closeAuth();
      updateAuthUI();
      toast(`Chào mừng trở lại! 🎬`);
    }
  });

  // Signup form
  qs('#signupFormEl').addEventListener('submit', e => {
    e.preventDefault();
    const name = qs('#signupName').value;
    const email = qs('#signupEmail').value;
    const pw = qs('#signupPassword').value;
    const res = Auth.signup(name, email, pw);
    const errEl = qs('#signupError');
    if (!res.ok) {
      errEl.textContent = res.err;
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
      closeAuth();
      updateAuthUI();
      toast(`Chào mừng ${name}! 🎉`);
    }
  });

  // Google login
  qs('#googleLoginBtn').addEventListener('click', () => {
    Auth.googleLogin();
    closeAuth();
    updateAuthUI();
    toast('Đã đăng nhập với Google! 🎬');
  });

  // Filter apply
  qs('#filterApply').addEventListener('click', () => {
    const genre = qs('#filterGenre').value;
    const country = qs('#filterCountry').value;
    const year = qs('#filterYear').value;
    const lang = qs('#filterLang').value;
    if (!genre && !country && !year && !lang) { toast('Vui lòng chọn ít nhất một bộ lọc.'); return; }
    const params = {};
    if (genre) { params.genre = genre; params.title = qs('#filterGenre option:checked').text; }
    else if (country) { params.country = country; params.title = qs('#filterCountry option:checked').text; }
    else if (year) { params.year = year; params.title = `Năm ${year}`; }
    else if (lang) { params.lang = lang; params.title = qs('#filterLang option:checked').text; }
    Router.go('list', params);
  });

  // Filter reset
  qs('#filterReset').addEventListener('click', () => {
    qs('#filterGenre').value = '';
    qs('#filterCountry').value = '';
    qs('#filterYear').value = '';
    qs('#filterLang').value = '';
  });

  // Nav links (desktop + mobile + footer)
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-page]');
    if (!link) return;
    e.preventDefault();
    const page = link.dataset.page;
    if (page === 'home') {
      Home.reset();
      Router.go('home');
    } else if (['phim-le','phim-bo','phim-chieu-rap','hoat-hinh','new'].includes(page)) {
      const params = page === 'new'
        ? { type: 'new' }
        : { slug: page, type: page };
      Router.go('list', params);
    } else {
      Router.go('list', { slug: page });
    }
    // Close mobile nav
    qs('#mobileNav').classList.remove('open');
  });

  // Back buttons
  qs('#backBtn').addEventListener('click', () => history.back() || Router.go('home'));
  qs('#backFromWatch').addEventListener('click', () => {
    const m = Watch.state().movie;
    if (m) Router.go('detail', { slug: m.slug });
    else Router.go('home');
  });

  // Hamburger
  qs('#hamburger').addEventListener('click', () => {
    qs('#mobileNav').classList.toggle('open');
  });

  // Brand / footer brand
  qs('#brandHome').addEventListener('click', (e) => { e.preventDefault(); Home.reset(); Router.go('home'); });
  qs('#footerBrand').addEventListener('click', (e) => { e.preventDefault(); Home.reset(); Router.go('home'); });

  // Init
  updateAuthUI();
  FilterBar.init();
  Router.go('home');
});
