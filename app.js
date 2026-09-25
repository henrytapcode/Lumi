/**
 * Lumi – Movie Website (Vanilla JS)
 * Cải thiện:
 *  - Tài khoản & Đăng nhập Google (Google Chooser Modal, lưu thông tin, đổi mật khẩu)
 *  - Lưu dữ liệu lịch sử xem chi tiết, resume xem tiếp, danh sách tập đã xem (watched badge)
 *  - Chọn tập phim tùy chọn nhanh chóng ngay tại Detail và qua Episode Picker Modal
 *  - Điều hướng Next/Prev tập không delay, quick-bar
 *  - Tối ưu trải nghiệm xem phim với theo dõi lịch sử, đánh dấu tập đã xem và đăng nhập tài khoản nhất quán
 */

'use strict';

/* ═══════════════════════════════════════════════════════
   1. CONFIG & CACHE ENGINE
═══════════════════════════════════════════════════════ */
const CFG = {
  BASE: 'https://phim.nguonc.com/api',
  CINEMA_BASE: 'https://phimapi.com',
  CACHE_TTL: { list: 6 * 60 * 1000, detail: 20 * 60 * 1000, search: 3 * 60 * 1000 },
  TIMEOUT: 12000,
  RETRY: 2,
  RETRY_DELAY: 600,
  HERO_INTERVAL: 6000,
  SEARCH_DEBOUNCE: 300,
  ITEMS_PER_HOME_ROW: 12,
};

const Cache = (() => {
  const mem = new Map();
  const LS_KEY = 'lumi_cache_v4';

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
      clearTimeout(this._pt);
      this._pt = setTimeout(persist, 1200);
    },
    del(key) { mem.delete(key); },
    clear() { mem.clear(); try { localStorage.removeItem(LS_KEY); } catch(_){} }
  };
})();

/* ═══════════════════════════════════════════════════════
   2. API CLIENT (Pre-cached & low latency)
═══════════════════════════════════════════════════════ */
const API = (() => {
  const cinemaSlugs = new Set();
  const pending = new Map();
  async function fetchWithTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), CFG.TIMEOUT);
    try {
      const res = await fetch(url, {
        ...opts,
        signal: ctrl.signal,
        cache: 'no-store'
      });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  }

  async function req(url, ttl = CFG.CACHE_TTL.list, force = false) {
    if (!force) {
      const cached = Cache.get(url);
      if (cached) return cached;
    }
    let lastErr;
    for (let i = 0; i <= CFG.RETRY; i++) {
      try {
        const data = await fetchWithTimeout(url);
        if (!force) Cache.set(url, data, ttl);
        return data;
      } catch (e) {
        lastErr = e;
        if (i < CFG.RETRY) await sleep(CFG.RETRY_DELAY * (i + 1));
      }
    }
    throw lastErr;
  }

  function once(key, request) {
    if (pending.has(key)) return pending.get(key);
    const promise = request().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  function normalizeCinemaDetail(data) {
    const movie = data.movie || {};
    movie.category = {
      genre: { group: { name: 'Thể loại' }, list: movie.category || [] },
      country: { group: { name: 'Quốc gia' }, list: movie.country || [] }
    };
    movie.episodes = (data.episodes || []).map(server => ({
      server_name: server.server_name,
      items: (server.server_data || []).map(item => ({
        name: item.name, slug: item.slug,
        embed: item.link_embed || item.link_m3u8 || ''
      }))
    }));
    return { movie };
  }

  function cinemaList(page) {
    const url = `${CFG.CINEMA_BASE}/danh-sach/phim-chieu-rap?page=${page}`;
    return req(url, CFG.CACHE_TTL.list).then(data => {
      (data.items || []).forEach(item => cinemaSlugs.add(item.slug));
      return data;
    });
  }

  function cinemaDetail(slug) {
    return once(`cinema-detail:${slug}`, () =>
      req(`${CFG.CINEMA_BASE}/phim/${encodeURIComponent(slug)}`, CFG.CACHE_TTL.detail)
        .then(normalizeCinemaDetail)
    );
  }

  return {
    newUpdated: (p = 1) => req(`${CFG.BASE}/films/phim-moi-cap-nhat?page=${p}`, CFG.CACHE_TTL.list, true),
    // Nguồn cũ trả về 404 cho phim-chieu-rap; nguồn này có cùng cấu trúc dữ liệu.
    listBySlug: (s, p = 1) => s === 'phim-chieu-rap'
      ? cinemaList(p)
      : req(`${CFG.BASE}/films/danh-sach/${s}?page=${p}`),
    detail: (s) => cinemaSlugs.has(s)
      ? cinemaDetail(s)
      : once(`detail:${s}`, () => req(`${CFG.BASE}/film/${s}`, CFG.CACHE_TTL.detail)),
    byGenre: (s, p = 1) => req(`${CFG.BASE}/films/the-loai/${s}?page=${p}`),
    byCountry: (s, p = 1) => req(`${CFG.BASE}/films/quoc-gia/${s}?page=${p}`),
    byYear: (y, p = 1) => req(`${CFG.BASE}/films/nam-phat-hanh/${y}?page=${p}`),
    byLang: (s, p = 1) => req(`${CFG.BASE}/films/ngon-ngu/${s}?page=${p}`),
    search: (kw) => req(`${CFG.BASE}/films/search?keyword=${encodeURIComponent(kw)}`, CFG.CACHE_TTL.search),
  };
})();

/* ═══════════════════════════════════════════════════════
   3. AUTH & USER DATA (Tài khoản, Google, Lịch sử, Yêu thích)
═══════════════════════════════════════════════════════ */
const Auth = (() => {
  const LS_USER = 'lumi_user';
  const LS_USERS_DB = 'lumi_users_db';
  const LS_FAV = 'lumi_favs';
  const LS_HIST = 'lumi_history';
  const LS_WATCHED = 'lumi_watched_eps';

  let user = null;
  try { user = JSON.parse(localStorage.getItem(LS_USER)); } catch(_) {}

  function getUsersDB() {
    try { return JSON.parse(localStorage.getItem(LS_USERS_DB) || '{}'); } catch { return {}; }
  }
  function saveUsersDB(db) {
    try { localStorage.setItem(LS_USERS_DB, JSON.stringify(db)); } catch(_) {}
  }
  function saveUser(u) {
    user = u;
    if (u) localStorage.setItem(LS_USER, JSON.stringify(u));
    else localStorage.removeItem(LS_USER);
  }
  function userScopedKey(prefix) {
    const email = user?.email || (() => {
      try {
        const active = JSON.parse(localStorage.getItem(LS_USER) || 'null');
        return active?.email || '';
      } catch {
        return '';
      }
    })();
    return email ? `${prefix}_${encodeURIComponent(email.toLowerCase())}` : prefix;
  }
  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  return {
    current: () => user,
    isLoggedIn: () => !!user,

    // Đăng ký tài khoản thường
    signup(name, email, password) {
      name = name.trim();
      email = email.trim().toLowerCase();
      if (!name) return { ok: false, err: 'Vui lòng nhập họ và tên.' };
      if (!email.includes('@')) return { ok: false, err: 'Email không hợp lệ.' };
      if (password.length < 6) return { ok: false, err: 'Mật khẩu phải từ 6 ký tự.' };

      const db = getUsersDB();
      if (db[email]) return { ok: false, err: 'Email này đã được sử dụng. Vui lòng đăng nhập.' };

      const newUser = {
        name, email, password,
        avatar: name[0].toUpperCase(),
        type: 'local',
        createdAt: Date.now()
      };
      db[email] = newUser;
      saveUsersDB(db);
      saveUser(newUser);
      return { ok: true };
    },

    // Đăng nhập tài khoản thường
    login(email, password) {
      email = email.trim().toLowerCase();
      if (!email.includes('@')) return { ok: false, err: 'Email không đúng định dạng.' };
      if (!password) return { ok: false, err: 'Vui lòng nhập mật khẩu.' };

      const db = getUsersDB();
      const existing = db[email];
      if (!existing) {
        return { ok: false, err: 'Email hoặc mật khẩu không chính xác.' };
      }
      if (existing.password !== password) {
        return { ok: false, err: 'Email hoặc mật khẩu không chính xác.' };
      }
      saveUser(existing);
      return { ok: true };
    },

    // Đăng nhập Google
    googleLogin(name, email, avatar = '') {
      email = (email || 'google.user@gmail.com').toLowerCase().trim();
      name = name ? name.trim() : 'Người dùng Google';
      const db = getUsersDB();
      const existing = db[email];
      const u = {
        name,
        email,
        avatar: avatar || name[0].toUpperCase(),
        type: 'google',
        createdAt: existing?.createdAt || Date.now(),
        password: existing?.password || undefined
      };
      db[email] = u;
      saveUsersDB(db);
      saveUser(u);
      return { ok: true };
    },

    // Cập nhật thông tin
    updateInfo(name) {
      if (!user) return { ok: false };
      user.name = name.trim();
      user.avatar = user.name[0].toUpperCase();
      saveUser(user);
      const db = getUsersDB();
      if (db[user.email]) {
        db[user.email].name = user.name;
        db[user.email].avatar = user.avatar;
        saveUsersDB(db);
      }
      return { ok: true };
    },

    // Đổi mật khẩu
    changePassword(oldPw, newPw) {
      if (!user) return { ok: false, err: 'Chưa đăng nhập.' };
      if (user.type === 'google') {
        return { ok: false, err: 'Tài khoản Google không sử dụng mật khẩu tại đây.' };
      }
      if (user.password && user.password !== oldPw) {
        return { ok: false, err: 'Mật khẩu hiện tại không chính xác.' };
      }
      if (newPw.length < 6) {
        return { ok: false, err: 'Mật khẩu mới phải có tối thiểu 6 ký tự.' };
      }
      if (oldPw === newPw) {
        return { ok: false, err: 'Mật khẩu mới không được trùng với mật khẩu cũ.' };
      }

      user.password = newPw;
      saveUser(user);
      const db = getUsersDB();
      if (db[user.email]) {
        db[user.email].password = newPw;
        saveUsersDB(db);
      }
      return { ok: true };
    },

    logout() {
      saveUser(null);
    },

    // Quản lý Phim yêu thích
    getFavs() {
      const key = userScopedKey(LS_FAV);
      return readJson(key, []);
    },
    isFav(slug) {
      return this.getFavs().some(f => f.slug === slug);
    },
    toggleFav(film) {
      const favs = this.getFavs();
      const idx = favs.findIndex(f => f.slug === film.slug);
      if (idx >= 0) favs.splice(idx, 1);
      else favs.unshift({ slug: film.slug, name: film.name, thumb_url: film.thumb_url || film.poster_url });
      writeJson(userScopedKey(LS_FAV), favs.slice(0, 100));
    },

    // Quản lý Lịch sử xem phim (Watch History)
    getHistory() {
      const key = userScopedKey(LS_HIST);
      return readJson(key, []);
    },
    clearHistory() {
      const h = this.getHistory();
      const slugs = [...new Set(h.map(x => x.slug).filter(Boolean))];
      slugs.forEach(slug => this.clearWatchedBySlug(slug));
      localStorage.removeItem(userScopedKey(LS_HIST));
    },
    removeHistoryItem(slug) {
      const h = this.getHistory().filter(x => x.slug !== slug);
      writeJson(userScopedKey(LS_HIST), h);
      this.clearWatchedBySlug(slug);
    },
    addHistory(film, epName, sIdx = 0, eIdx = 0) {
      let h = this.getHistory();
      h = h.filter(x => x.slug !== film.slug);
      h.unshift({
        slug: film.slug,
        name: film.name,
        thumb_url: film.thumb_url || film.poster_url,
        epName: String(epName),
        sIdx,
        eIdx,
        time: Date.now()
      });
      writeJson(userScopedKey(LS_HIST), h.slice(0, 80));
      this.markWatched(film.slug, epName);
    },
    getLastWatched(slug) {
      return this.getHistory().find(x => x.slug === slug) || null;
    },

    // Quản lý tập phim đã xem (đánh dấu badge ✓)
    getWatchedEps() {
      const key = userScopedKey(LS_WATCHED);
      return readJson(key, []);
    },
    clearWatchedBySlug(slug) {
      const list = this.getWatchedEps().filter(key => !key.startsWith(`${slug}:`));
      writeJson(userScopedKey(LS_WATCHED), list);
    },
    isEpWatched(slug, epName) {
      const key = `${slug}:${epName}`;
      return this.getWatchedEps().includes(key);
    },
    markWatched(slug, epName) {
      const list = this.getWatchedEps();
      const key = `${slug}:${epName}`;
      if (!list.includes(key)) {
        list.push(key);
        writeJson(userScopedKey(LS_WATCHED), list.slice(-500));
      }
    }
  };
})();

/* ═══════════════════════════════════════════════════════
   4. UI HELPERS
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
function toast(msg, dur = 2600) {
  const t = qs('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), dur);
}
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'Vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} ngày trước`;
  return new Date(ts).toLocaleDateString('vi-VN');
}

function makeSkeletons(n = 8, container) {
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    container.innerHTML += `<div class="film-card skeleton"><div class="skeleton-overlay"></div></div>`;
  }
}

function buildCard(film, extraInfo = '') {
  const card = el('div', 'film-card');
  card.dataset.slug = film.slug;
  const ep = extraInfo || film.current_episode || '';
  card.innerHTML = `
    <img src="${film.thumb_url || film.poster_url}" alt="${film.name}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 240%22><rect fill=%22%231e1e28%22 width=%22160%22 height=%22240%22/><text x=%2280%22 y=%22130%22 text-anchor=%22middle%22 fill=%22%236b6b88%22 font-size=%2240%22>🎬</text></svg>'" />
    <div class="film-card-overlay">
      <div class="film-card-title">${film.name}</div>
      ${ep ? `<div class="film-card-ep">${ep}</div>` : ''}
    </div>
    <div class="film-card-badges">
      ${film.quality ? `<span class="badge quality">${film.quality}</span>` : ''}
      ${film.language ? `<span class="badge lang">${film.language}</span>` : ''}
    </div>
    <div class="film-card-play"><div class="play-circle">▶</div></div>
  `;
  card.addEventListener('click', () => Router.go('detail', { slug: film.slug }));
  return card;
}

function renderFilms(items, container) {
  container.innerHTML = '';
  if (!items?.length) return false;
  items.forEach(f => container.appendChild(buildCard(f)));
  return true;
}

/* ═══════════════════════════════════════════════════════
   5. ROUTER
═══════════════════════════════════════════════════════ */
const Router = (() => {
  const pages = {
    home: qs('#pageHome'),
    list: qs('#pageList'),
    detail: qs('#pageDetail'),
    watch: qs('#pageWatch')
  };
  const LS_ROUTE = 'lumi_last_route';
  let current = null;

  function show(name) {
    Object.values(pages).forEach(p => p?.classList.remove('active'));
    pages[name]?.classList.add('active');
    current = name;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (name !== 'watch') {
      const frame = qs('#playerFrame');
      if (frame && frame.src) frame.src = '';
    }
  }

  function highlightNav(pageKey) {
    qsa('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.page === pageKey));
  }

  function saveRoute(page, params = {}) {
    try {
      const payload = { page, params };
      sessionStorage.setItem(LS_ROUTE, JSON.stringify(payload));
    } catch {}
  }

  function restoreRoute() {
    try {
      const raw = sessionStorage.getItem(LS_ROUTE);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function applyRoute(page, params = {}) {
    const route = { page, params };
    saveRoute(page, params);
    show(page);
    switch (page) {
      case 'home':
        highlightNav('home');
        Home.init();
        break;
      case 'list':
        highlightNav(params.slug || params.type || '');
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
    return route;
  }

  return {
    go(page, params = {}) {
      applyRoute(page, params);
      try {
        history.pushState({ page, params }, '', location.href.split('#')[0]);
      } catch {}
    },
    restore() {
      const route = history.state || restoreRoute();
      if (!route) return false;
      const page = route.page || 'home';
      const params = route.params || {};
      if (page === 'watch' && !params.movie) {
        return false;
      }
      applyRoute(page, params);
      return true;
    },
    current: () => current,
  };
})();

/* ═══════════════════════════════════════════════════════
   6. HOME MODULE
═══════════════════════════════════════════════════════ */
const Home = (() => {
  let heroFilms = [], heroIdx = 0, heroTimer = null, initialized = false;

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
    qs('#heroBg').style.backgroundImage = `url('${f.poster_url || f.thumb_url}')`;
    qs('#heroContent').innerHTML = `
      <div class="hero-badges">
        ${f.quality ? `<span class="badge quality">${f.quality}</span>` : ''}
        ${f.language ? `<span class="badge lang">${f.language}</span>` : ''}
        ${f.year ? `<span class="badge" style="background:var(--blue)">${f.year}</span>` : ''}
      </div>
      <div class="hero-title">${f.name}</div>
      ${f.original_name ? `<div class="hero-original">${f.original_name}</div>` : ''}
      <div class="hero-desc">${f.description || 'Khám phá bộ phim hấp dẫn với trải nghiệm hình ảnh sắc nét và âm thanh sống động.'}</div>
      <div class="hero-meta-row">
        ${f.current_episode ? `<div class="hero-meta-item">Trạng thái: <strong>${f.current_episode}</strong></div>` : ''}
        ${f.time ? `<div class="hero-meta-item">Thời lượng: <strong>${f.time}</strong></div>` : ''}
      </div>
      <div class="hero-actions">
        <button class="hero-play-btn" data-slug="${f.slug}">▶ &nbsp; Xem ngay</button>
      </div>
    `;
    qs('.hero-play-btn', qs('#heroContent'))?.addEventListener('click', () => {
      Router.go('detail', { slug: f.slug });
    });
  }

  function renderDots() {
    const d = qs('#heroDots');
    d.innerHTML = '';
    heroFilms.forEach((_, i) => {
      const dot = el('div', `hero-dot${i === 0 ? ' active' : ''}`);
      dot.onclick = () => {
        heroIdx = i; renderHero(i); updateDots();
        clearInterval(heroTimer);
        heroTimer = setInterval(() => {
          heroIdx = (heroIdx + 1) % heroFilms.length;
          renderHero(heroIdx); updateDots();
        }, CFG.HERO_INTERVAL);
      };
      d.appendChild(dot);
    });
  }
  function updateDots() {
    qsa('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === heroIdx));
  }

  async function loadRow(fetchFn, containerId) {
    const c = qs(`#${containerId}`);
    makeSkeletons(CFG.ITEMS_PER_HOME_ROW, c);
    try {
      const data = await fetchFn;
      const items = (data.items || []).slice(0, CFG.ITEMS_PER_HOME_ROW);
      renderFilms(items, c);
      return items;
    } catch {
      c.innerHTML = `<div style="padding:20px;color:var(--text3)">Lỗi kết nối máy chủ.</div>`;
      return [];
    }
  }

  return {
    async init() {
      if (initialized) return;
      initialized = true;
      const res = await Promise.allSettled([
        loadRow(API.newUpdated(1), 'rowNew'),
        loadRow(API.listBySlug('phim-le', 1), 'rowPhimLe'),
        loadRow(API.listBySlug('phim-bo', 1), 'rowPhimBo'),
        loadRow(API.listBySlug('phim-chieu-rap', 1), 'rowRap'),
      ]);
      if (res[0].status === 'fulfilled' && res[0].value?.length) {
        initHero(res[0].value);
      }
    },
    reset() { initialized = false; }
  };
})();

/* ═══════════════════════════════════════════════════════
   7. LIST MODULE
═══════════════════════════════════════════════════════ */
const List = (() => {
  const FILTER_PAGE_SIZE = 18;
  // Tải song song và khử trùng request chi tiết giúp lọc nhiều tiêu chí phản hồi nhanh hơn.
  const FILTER_REQUEST_CONCURRENCY = 10;
  const filteredResults = new Map();

  function slugify(v) {
    return String(v || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getCategoryNames(item) {
    const cats = [];
    const groups = item?.category ? Object.values(item.category) : [];
    groups.forEach(group => {
      const arr = Array.isArray(group?.list) ? group.list : [];
      arr.forEach(x => {
        if (x && x.name) cats.push(x.name);
      });
    });
    return cats;
  }

  function matchesFilters(item, p) {
    const genre = p.genre ? slugify(p.genre) : '';
    const country = p.country ? slugify(p.country) : '';
    const year = p.year ? String(p.year) : '';
    const lang = p.lang ? slugify(p.lang) : '';

    if (genre) {
      const ok = getCategoryNames(item).some(name => slugify(name) === genre);
      if (!ok) return false;
    }
    if (country) {
      const ok = getCategoryNames(item).some(name => slugify(name) === country);
      if (!ok) return false;
    }
    if (year) {
      const itemYear = String(item?.year || '').trim();
      if (!itemYear || itemYear !== year) return false;
    }
    if (lang) {
      const itemLang = slugify(item?.language || '');
      if (itemLang !== lang) return false;
    }
    return true;
  }

  function getFilterSources(p) {
    return [
      p.genre && { load: page => API.byGenre(p.genre, page) },
      p.country && { load: page => API.byCountry(p.country, page) },
      p.year && { load: page => API.byYear(p.year, page) },
      p.lang && { load: page => API.byLang(p.lang, page) },
    ].filter(Boolean);
  }

  async function getFilteredState(p) {
    const cacheKey = JSON.stringify({
      genre: p.genre || '', country: p.country || '', year: p.year || '', lang: p.lang || ''
    });
    if (filteredResults.has(cacheKey)) return filteredResults.get(cacheKey);

    // Danh sách tóm tắt từ API không chứa category. Tải trang đầu của từng
    // tiêu chí để chọn nguồn có ít ứng viên nhất, sau đó chỉ truy vấn chi tiết
    // của các phim cần đối chiếu. Điều này tránh tải toàn bộ mọi danh sách.
    const firstPages = await Promise.all(getFilterSources(p).map(source => source.load(1)));
    const sourceIndex = firstPages.reduce((best, data, index) => {
      const total = Number(data.paginate?.total_items) || Infinity;
      const bestTotal = Number(firstPages[best].paginate?.total_items) || Infinity;
      return total < bestTotal ? index : best;
    }, 0);

    const state = {
      source: getFilterSources(p)[sourceIndex],
      firstPage: firstPages[sourceIndex],
      nextSourcePage: 1,
      totalSourcePages: Math.max(1, Number(firstPages[sourceIndex].paginate?.total_page) || 1),
      items: [],
      exhausted: false,
    };
    filteredResults.set(cacheKey, state);
    return state;
  }

  async function enrichAndMatch(items, p) {
    const matched = [];
    for (let start = 0; start < items.length; start += FILTER_REQUEST_CONCURRENCY) {
      const batch = items.slice(start, start + FILTER_REQUEST_CONCURRENCY);
      const details = await Promise.all(batch.map(async item => {
        try {
          const data = await API.detail(item.slug);
          return { ...item, ...(data.movie || data) };
        } catch {
          return item;
        }
      }));
      matched.push(...details.filter(item => matchesFilters(item, p)));
    }
    return matched;
  }

  async function fetchFilteredPage(p, page) {
    const state = await getFilteredState(p);
    const targetCount = page * FILTER_PAGE_SIZE;

    while (!state.exhausted && state.items.length < targetCount) {
      const sourcePage = state.nextSourcePage === 1
        ? state.firstPage
        : await state.source.load(state.nextSourcePage);
      state.nextSourcePage++;
      state.items.push(...await enrichAndMatch(sourcePage.items || [], p));
      if (state.nextSourcePage > state.totalSourcePages) state.exhausted = true;
    }

    const start = (page - 1) * FILTER_PAGE_SIZE;
    return {
      items: state.items.slice(start, start + FILTER_PAGE_SIZE),
      paginate: {
        current_page: page,
        // Khi chưa quét hết, giữ thêm một trang để người dùng tiếp tục tìm.
        total_page: state.exhausted
          ? Math.max(1, Math.ceil(state.items.length / FILTER_PAGE_SIZE))
          : Math.max(page + 1, Math.ceil(state.items.length / FILTER_PAGE_SIZE) + 1),
        total_items: state.exhausted ? state.items.length : null,
      }
    };
  }

  async function fetchPage(p, page) {
    if (p._favs) return { items: p._favs, paginate: { current_page: 1, total_page: 1 } };
    if (p.keyword) return API.search(p.keyword);

    const filterCount = [p.genre, p.country, p.year, p.lang].filter(Boolean).length;
    if (filterCount > 1) {
      return fetchFilteredPage(p, page);
    }

    if (p.genre) return API.byGenre(p.genre, page);
    if (p.country) return API.byCountry(p.country, page);
    if (p.year) return API.byYear(p.year, page);
    if (p.lang) return API.byLang(p.lang, page);
    if (p.type === 'new') return API.newUpdated(page);
    return API.listBySlug(p.slug || p.type, page);
  }

  function getTitle(p) {
    const l = {
      'new': 'Phim Mới Cập Nhật',
      'phim-le': 'Danh Sách Phim Lẻ',
      'phim-bo': 'Danh Sách Phim Bộ',
      'phim-chieu-rap': 'Phim Chiếu Rạp'
    };
    return p.title || (p.keyword ? `Kết quả tìm kiếm: "${p.keyword}"` : l[p.slug || p.type] || 'Danh sách phim');
  }

  return {
    async load(params, page = 1) {
      const grid = qs('#filmGrid'), empty = qs('#emptyState'), pagi = qs('#pagination');
      empty.classList.add('hidden');
      pagi.innerHTML = '';
      makeSkeletons(18, grid);
      qs('#listTitle').textContent = getTitle(params);
      qs('#listMeta').textContent = 'Đang tải dữ liệu...';

      try {
        const data = await fetchPage(params, page);
        const items = data.items || [];
        if (!items.length) {
          grid.innerHTML = '';
          empty.classList.remove('hidden');
          qs('#listMeta').textContent = '0 phim';
          return;
        }

        const pg = data.paginate || {};
        const tot = pg.total_page || 1;
        const totalLabel = pg.total_items == null
          ? 'Đang tìm thêm kết quả'
          : `${pg.total_items.toLocaleString()} phim`;
        qs('#listMeta').textContent = `${totalLabel} · Trang ${page}/${tot}`;
        renderFilms(items, grid);

        // Render pagination
        if (!params.keyword && !params._favs && tot > 1) {
          const start = Math.max(1, page - 2);
          const end = Math.min(tot, page + 2);
          if (page > 1) {
            const prev = el('button', 'page-btn', '‹');
            prev.onclick = () => List.load(params, page - 1);
            pagi.appendChild(prev);
          }
          for (let i = start; i <= end; i++) {
            const b = el('button', `page-btn ${i === page ? 'active' : ''}`, i);
            b.onclick = () => List.load(params, i);
            pagi.appendChild(b);
          }
          if (page < tot) {
            const next = el('button', 'page-btn', '›');
            next.onclick = () => List.load(params, page + 1);
            pagi.appendChild(next);
          }
        }
      } catch {
        grid.innerHTML = `<div style="text-align:center;padding:60px;grid-column:1/-1;color:var(--text3)">Không thể kết nối máy chủ phim. Vui lòng thử lại sau.</div>`;
      }
    }
  };
})();

/* ═══════════════════════════════════════════════════════
   8. DETAIL MODULE (Chi tiết phim & Danh sách tập trực quan)
═══════════════════════════════════════════════════════ */
const Detail = (() => {
  return {
    async load(slug) {
      const c = qs('#detailContent');
      c.innerHTML = `
        <div style="display:flex;justify-content:center;padding:80px 0">
          <div class="skeleton-box" style="width:240px;height:340px;border-radius:16px"></div>
        </div>
      `;

      try {
        const data = await API.detail(slug);
        const m = data.movie;
        const isFav = Auth.isFav(slug);
        const lastWatched = Auth.getLastWatched(slug);

        // Nút xem: Nếu đã có lịch sử thì hiện "Xem tiếp Tập X", chưa thì hiện "Xem ngay"
        const watchBtnText = lastWatched ? `▶ &nbsp; Xem tiếp: Tập ${lastWatched.epName}` : `▶ &nbsp; Xem Tập 1`;

        // Trích xuất thể loại và quốc gia
        let genres = [], countries = [];
        if (m.category) {
          Object.values(m.category).forEach(cat => {
            const gName = cat.group?.name?.toLowerCase() || '';
            if (gName.includes('thể loại')) genres = cat.list || [];
            if (gName.includes('quốc gia')) countries = cat.list || [];
          });
        }
        const tagHTML = (k, arr) => arr?.length ? `
          <div style="margin-bottom:6px">
            <span class="meta-label" style="display:inline;margin-right:8px">${k}:</span>
            <span class="cat-tags">${arr.map(x => `<span class="cat-tag">${x.name}</span>`).join('')}</span>
          </div>` : '';

        // Xây dựng danh sách các tập phim trực quan ngay tại trang chi tiết
        const episodes = m.episodes || [];
        const hasEps = episodes.length > 0 && episodes[0].items?.length > 0;
        let episodesSectionHTML = '';

        if (hasEps) {
          const firstServer = episodes[0];
          episodesSectionHTML = `
            <div class="detail-episodes-section">
              <div class="detail-episodes-head">
                <div>
                  <h3>📑 Danh sách tập phim (${firstServer.items.length} tập)</h3>
                  <span style="font-size:12px;color:var(--text3)">Nhấp trực tiếp vào tập mong muốn để phát ngay lập tức:</span>
                </div>
                <div class="detail-server-tabs" id="detailServerTabs">
                  ${episodes.map((s, idx) => `<button class="server-tab ${idx === 0 ? 'active' : ''}" data-sidx="${idx}">${s.server_name}</button>`).join('')}
                </div>
              </div>
              <div class="detail-ep-grid" id="detailEpGrid">
                ${firstServer.items.map((ep, eIdx) => {
                  const watched = Auth.isEpWatched(m.slug, ep.name) ? 'watched' : '';
                  return `<button class="detail-ep-btn ${watched}" data-sidx="0" data-eidx="${eIdx}" title="Tập ${ep.name}">Tập ${ep.name}</button>`;
                }).join('')}
              </div>
            </div>
          `;
        }

        c.innerHTML = `
          <div class="detail-hero">
            <div class="detail-poster">
              <img src="${m.poster_url || m.thumb_url}" alt="${m.name}" />
            </div>
            <div class="detail-info">
              <h1 class="detail-title">${m.name}</h1>
              ${m.original_name ? `<div class="detail-original">${m.original_name}</div>` : ''}
              <div class="detail-meta">
                ${m.year ? `<div class="meta-item"><span class="meta-label">Năm phát hành</span><span class="meta-value">${m.year}</span></div>` : ''}
                ${m.current_episode ? `<div class="meta-item"><span class="meta-label">Tình trạng</span><span class="meta-value">${m.current_episode}</span></div>` : ''}
                ${m.time ? `<div class="meta-item"><span class="meta-label">Thời lượng</span><span class="meta-value">${m.time}</span></div>` : ''}
                ${m.quality ? `<div class="meta-item"><span class="meta-label">Chất lượng</span><span class="meta-value">${m.quality}</span></div>` : ''}
              </div>
              <div class="detail-desc">${m.description || 'Bộ phim đang được cập nhật thông tin chi tiết.'}</div>
              
              <div class="detail-actions">
                <button class="watch-btn" id="watchNowBtn">${watchBtnText}</button>
                <button class="fav-btn ${isFav ? 'active' : ''}" id="favBtn">${isFav ? '♥ &nbsp; Đã yêu thích' : '♡ &nbsp; Yêu thích'}</button>
              </div>

              <div style="margin-top:14px">
                ${tagHTML('Thể loại', genres)}
                ${tagHTML('Quốc gia', countries)}
              </div>
            </div>
          </div>

          ${episodesSectionHTML}
        `;

        // Xử lý nút xem chính
        qs('#watchNowBtn').onclick = () => {
          if (!hasEps) return toast('Chưa có nguồn tập phim khả dụng.');
          if (lastWatched) {
            // Xem tiếp từ lịch sử
            const sIdx = lastWatched.sIdx || 0;
            const eIdx = lastWatched.eIdx || 0;
            const srv = episodes[sIdx] || episodes[0];
            const ep = srv.items[eIdx] || srv.items[0];
            Router.go('watch', { movie: m, serverIdx: sIdx, epIdx: eIdx, embed: ep.embed });
          } else {
            // Xem tập đầu tiên
            Router.go('watch', { movie: m, serverIdx: 0, epIdx: 0, embed: episodes[0].items[0].embed });
          }
        };

        // Nút yêu thích
        qs('#favBtn').onclick = () => {
          if (!Auth.isLoggedIn()) {
            openAuthModal('login');
            toast('Vui lòng đăng nhập để lưu phim yêu thích!');
            return;
          }
          Auth.toggleFav(m);
          const f = Auth.isFav(slug);
          qs('#favBtn').className = `fav-btn ${f ? 'active' : ''}`;
          qs('#favBtn').innerHTML = f ? '♥ &nbsp; Đã yêu thích' : '♡ &nbsp; Yêu thích';
          toast(f ? 'Đã thêm vào danh sách yêu thích!' : 'Đã xoá khỏi danh sách yêu thích.');
        };

        // Bắt sự kiện click vào các tập trên giao diện Detail
        if (hasEps) {
          const sTabs = qsa('.server-tab', qs('#detailServerTabs'));
          const epGrid = qs('#detailEpGrid');

          function renderDetailServer(sIdx) {
            sTabs.forEach((t, i) => t.classList.toggle('active', i === sIdx));
            const srv = episodes[sIdx];
            epGrid.innerHTML = srv.items.map((ep, eIdx) => {
              const watched = Auth.isEpWatched(m.slug, ep.name) ? 'watched' : '';
              return `<button class="detail-ep-btn ${watched}" data-sidx="${sIdx}" data-eidx="${eIdx}" title="Tập ${ep.name}">Tập ${ep.name}</button>`;
            }).join('');
            bindDetailEpButtons();
          }

          function bindDetailEpButtons() {
            qsa('.detail-ep-btn', epGrid).forEach(btn => {
              btn.onclick = () => {
                const sIdx = parseInt(btn.dataset.sidx);
                const eIdx = parseInt(btn.dataset.eidx);
                const embed = episodes[sIdx].items[eIdx].embed;
                Router.go('watch', { movie: m, serverIdx: sIdx, epIdx: eIdx, embed });
              };
            });
          }

          sTabs.forEach((t, idx) => {
            t.onclick = () => renderDetailServer(idx);
          });
          bindDetailEpButtons();
        }

      } catch {
        c.innerHTML = `
          <div style="text-align:center;padding:60px 20px;color:var(--text3)">
            <div style="font-size:42px;margin-bottom:12px">⚠</div>
            <h3>Không thể tải thông tin phim</h3>
            <p>Vui lòng kiểm tra lại kết nối mạng hoặc thử lại sau.</p>
          </div>
        `;
      }
    }
  };
})();

/* ═══════════════════════════════════════════════════════
   10. WATCH MODULE (Next/Prev, lưu lịch sử & đánh dấu tập đã xem)
═══════════════════════════════════════════════════════ */
const Watch = (() => {
  let state = {
    movie: null,
    serverIdx: 0,
    epIdx: 0,
  };

  // Cập nhật điều hướng Next / Prev
  function updateControlsUI(si, ei) {
    const eps = state.movie.episodes || [];
    const server = eps[si];
    if (!server || !server.items) return;
    const items = server.items;

    const btnPrev = qs('#prevEpBtn');
    const btnNext = qs('#nextEpBtn');
    btnPrev.disabled = ei <= 0;
    btnNext.disabled = ei >= items.length - 1;
  }

  // Tải một tập phim
  function loadEp(si, ei, embed) {
    state.serverIdx = si;
    state.epIdx = ei;

    const server = state.movie.episodes[si];
    const ep = server?.items?.[ei];
    if (!ep) return;

    // Cập nhật tiêu đề
    qs('#playerTitle').textContent = `${state.movie.name} — Tập ${ep.name}`;
    qs('#playerSubtitle').textContent = `Máy chủ: ${server.server_name} · Tốc độ tải ưu tiên cao`;

    // Tối ưu Iframe: Không tái tạo thẻ, chỉ thay src nếu khác để tua/đổi tập mượt mà
    const iframe = qs('#playerFrame');
    const loader = qs('#playerLoader');

    if (iframe.src !== embed) {
      loader?.classList.remove('hidden');
      iframe.src = embed;
      iframe.onload = () => {
        loader?.classList.add('hidden');
      };
      // Timeout fallback phòng khi iframe không bắn onload
      setTimeout(() => loader?.classList.add('hidden'), 1500);
    }

    // Tự động lưu vào lịch sử xem & đánh dấu tập đã xem
    Auth.addHistory(state.movie, ep.name, si, ei);
    // Cập nhật trạng thái active trên danh sách tập ở Sidebar
    qsa('.ep-btn').forEach((b, idx) => {
      b.classList.toggle('active', idx === ei);
      if (Auth.isEpWatched(state.movie.slug, state.movie.episodes[si].items[idx].name)) {
        b.classList.add('watched');
      }
    });
    const activeSidebarBtn = qs('.ep-btn.active');
    activeSidebarBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    updateControlsUI(si, ei);
    toast(`Đang phát: Tập ${ep.name}`);
  }

  function loadServer(si, ei = 0) {
    state.serverIdx = si;
    const eps = state.movie.episodes || [];
    if (!eps[si]) return;

    qsa('.server-tab', qs('#serverTabs')).forEach((t, i) => t.classList.toggle('active', i === si));

    const grid = qs('#epGrid');
    grid.innerHTML = eps[si].items.map((ep, idx) => {
      const isCur = idx === ei ? 'active' : '';
      const isWatched = Auth.isEpWatched(state.movie.slug, ep.name) ? 'watched' : '';
      return `<button class="ep-btn ${isCur} ${isWatched}" data-ei="${idx}" title="Tập ${ep.name}">${ep.name}</button>`;
    }).join('');

    qsa('.ep-btn', grid).forEach(b => {
      b.onclick = () => {
        const idx = parseInt(b.dataset.ei);
        loadEp(si, idx, eps[si].items[idx].embed);
      };
    });

    if (eps[si].items[ei]) {
      loadEp(si, ei, eps[si].items[ei].embed);
    }
  }

  // Chuyển sang tập tiếp theo (Next)
  function nextEpisode() {
    const items = state.movie.episodes[state.serverIdx].items;
    if (state.epIdx < items.length - 1) {
      loadEp(state.serverIdx, state.epIdx + 1, items[state.epIdx + 1].embed);
    } else {
      toast('Bạn đang ở tập cuối cùng của bộ phim!');
    }
  }

  // Quay lại tập trước (Prev)
  function prevEpisode() {
    if (state.epIdx > 0) {
      const items = state.movie.episodes[state.serverIdx].items;
      loadEp(state.serverIdx, state.epIdx - 1, items[state.epIdx - 1].embed);
    } else {
      toast('Bạn đang ở tập đầu tiên!');
    }
  }

  // Tìm kiếm tập phim ở Sidebar
  qs('#epSearch').addEventListener('input', e => {
    const t = e.target.value.toLowerCase().trim();
    qsa('.ep-btn', qs('#epGrid')).forEach(b => {
      b.style.display = b.textContent.toLowerCase().includes(t) ? 'block' : 'none';
    });
  });

  // Gắn sự kiện nút Next / Prev
  const prevBtn = qs('#prevEpBtn');
  const nextBtn = qs('#nextEpBtn');
  prevBtn?.addEventListener('click', prevEpisode);
  nextBtn?.addEventListener('click', nextEpisode);

  // Shortcuts Modal
  const shortcutsHelp = qs('#btnShortcutsHelp');
  const shortcutsClose = qs('#shortcutsClose');
  shortcutsHelp?.addEventListener('click', () => qs('#shortcutsModal').classList.remove('hidden'));
  shortcutsClose?.addEventListener('click', () => qs('#shortcutsModal').classList.add('hidden'));

  // Lắng nghe phím tắt bàn phím toàn cục khi ở trang Watch
  window.addEventListener('keydown', e => {
    if (Router.current() !== 'watch') return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.key === 'n' || e.key === 'N') {
      nextEpisode();
    } else if (e.key === 'p' || e.key === 'P') {
      prevEpisode();
    }
  });

  return {
    load({ movie, serverIdx = 0, epIdx = 0, embed }) {
      state.movie = movie;
      state.serverIdx = serverIdx;
      state.epIdx = epIdx;

      const eps = movie.episodes || [];
      qs('#epSearch').value = '';
      if (!eps.length) return Router.go('detail', { slug: movie.slug });

      qs('#serverTabs').innerHTML = eps.map((s, i) =>
        `<button class="server-tab ${i === serverIdx ? 'active' : ''}">${s.server_name}</button>`
      ).join('');

      qsa('.server-tab', qs('#serverTabs')).forEach((t, i) => {
        t.onclick = () => loadServer(i, 0);
      });

      loadServer(serverIdx, epIdx);
    },
    state: () => state,
  };
})();

/* ═══════════════════════════════════════════════════════
   11. SEARCH MODULE
═══════════════════════════════════════════════════════ */
const Search = (() => {
  const inp = qs('#globalSearch');
  const drop = qs('#searchDropdown');

  const doSearch = debounce(async (kw) => {
    const t = kw.trim();
    if (t.length < 2) return drop.classList.remove('active');
    drop.innerHTML = `<div class="sd-loading">Đang tìm kiếm phim...</div>`;
    drop.classList.add('active');

    try {
      const data = await API.search(t);
      const items = (data.items || []).slice(0, 8);
      if (!items.length) {
        drop.innerHTML = `<div class="sd-empty">Không tìm thấy phim nào khớp</div>`;
        return;
      }
      drop.innerHTML = items.map(f => `
        <div class="sd-item" data-slug="${f.slug}">
          <img src="${f.thumb_url || f.poster_url}" onerror="this.style.display='none'" />
          <div class="sd-info">
            <div class="sd-name">${f.name}</div>
            <div class="sd-sub">${f.year || ''} ${f.current_episode ? '· ' + f.current_episode : ''} ${f.quality ? '· ' + f.quality : ''}</div>
          </div>
        </div>
      `).join('');

      qsa('.sd-item', drop).forEach(el => {
        el.onclick = () => {
          drop.classList.remove('active');
          inp.value = '';
          Router.go('detail', { slug: el.dataset.slug });
        };
      });
    } catch {
      drop.innerHTML = `<div class="sd-empty">Lỗi kết nối tìm kiếm.</div>`;
    }
  }, CFG.SEARCH_DEBOUNCE);

  inp.addEventListener('input', e => doSearch(e.target.value));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && inp.value.trim().length >= 2) {
      drop.classList.remove('active');
      Router.go('list', { keyword: inp.value.trim() });
      inp.value = '';
    }
  });

  document.addEventListener('click', e => {
    if (!qs('#globalSearchWrap').contains(e.target)) drop.classList.remove('active');
  });
})();

/* ═══════════════════════════════════════════════════════
   12. AUTH & PROFILE UI (Google Login, Đổi mật khẩu, Lịch sử)
═══════════════════════════════════════════════════════ */
function openAuthModal(tab = 'login') {
  qs('#authModal').classList.remove('hidden');
  qsa('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  qs('#loginForm').classList.toggle('hidden', tab !== 'login');
  qs('#signupForm').classList.toggle('hidden', tab !== 'signup');
}

// Google Identity Services opens Google's own account chooser popup.
const RealGoogleAuth = (() => {
  const clientId = document.querySelector('meta[name="google-client-id"]')?.content.trim();
  let tokenClient;

  async function loadLibrary() {
    if (window.google?.accounts?.oauth2) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Unable to load Google sign-in.'));
      document.head.appendChild(script);
    });
  }

  async function login() {
    if (!clientId) return toast('Google Client ID is not configured. See README.');
    try {
      await loadLibrary();
      tokenClient ||= google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        callback: async response => {
          if (response.error) return toast('Google sign-in was cancelled.');
          try {
            const profile = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${response.access_token}` }
            }).then(r => r.ok ? r.json() : Promise.reject(new Error('Could not read Google profile.')));
            Auth.googleLogin(profile.name, profile.email, profile.picture);
            qs('#authModal').classList.add('hidden');
            updateAuthUI();
            toast(`Signed in with Google: ${profile.name}`);
          } catch (error) {
            toast(error.message || 'Google sign-in could not be completed.');
          }
        }
      });
      // Force the account chooser even when a Google session is already active.
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    } catch (error) {
      toast(error.message || 'Could not open Google sign-in.');
    }
  }

  // Capture phase prevents the former mock-account click handler from running.
  qs('#googleLoginBtn').addEventListener('click', event => {
    event.stopImmediatePropagation();
    login();
  }, true);
})();
qs('#authModalClose').addEventListener('click', () => qs('#authModal').classList.add('hidden'));
qsa('.auth-tab').forEach(t => t.addEventListener('click', () => openAuthModal(t.dataset.tab)));

// Google Account Chooser
const GoogleAuthUI = (() => {
  const modal = qs('#googleChooserModal');
  const customBox = qs('#googleCustomBox');

  qs('#googleLoginBtn').addEventListener('click', () => {
    qs('#authModal').classList.add('hidden');
    customBox.classList.add('hidden');
    modal.classList.remove('hidden');
  });

  qs('#googleChooserClose').addEventListener('click', () => modal.classList.add('hidden'));

  // Chọn từ tài khoản có sẵn
  qsa('.google-acc-item[data-email]').forEach(item => {
    item.addEventListener('click', () => {
      const email = item.dataset.email;
      const name = item.dataset.name;
      const avatar = item.dataset.avatar;
      Auth.googleLogin(name, email, avatar);
      modal.classList.add('hidden');
      updateAuthUI();
      toast(`Đã đăng nhập Google: ${name} 🎉`);
    });
  });

  // Tùy chọn nhập tài khoản Google khác
  qs('#googleCustomAccBtn').addEventListener('click', () => {
    customBox.classList.toggle('hidden');
  });

  qs('#customGoogleSubmit').addEventListener('click', () => {
    const name = qs('#customGoogleName').value.trim() || 'Google User';
    const email = qs('#customGoogleEmail').value.trim();
    if (!email.includes('@')) return toast('Vui lòng nhập đúng địa chỉ Gmail.');
    Auth.googleLogin(name, email, name[0].toUpperCase());
    modal.classList.add('hidden');
    updateAuthUI();
    toast(`Đã đăng nhập Google: ${name} 🎉`);
  });
})();

// Profile Modal Controller (Thông tin, Lịch sử xem, Phim yêu thích, Đổi mật khẩu)
const ProfileUI = (() => {
  const mod = qs('#profileModal');

  function renderHistory() {
    const list = qs('#historyList');
    const h = Auth.getHistory();
    qs('#statHistoryCount').textContent = h.length;

    if (!h.length) {
      list.innerHTML = `<div class="empty-state" style="padding:30px 10px"><div class="empty-icon" style="font-size:32px">⏳</div><p>Bạn chưa xem phim nào gần đây.</p></div>`;
      return;
    }

    list.innerHTML = h.map(item => `
      <div class="profile-list-item" data-slug="${item.slug}" data-sidx="${item.sIdx || 0}" data-eidx="${item.eIdx || 0}">
        <img src="${item.thumb_url}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 240%22><rect fill=%22%232a2e42%22 width=%22160%22 height=%22240%22/></svg>'" />
        <div class="pli-info">
          <div class="pli-name">${item.name}</div>
          <div class="pli-sub">Đang xem: <strong>Tập ${item.epName}</strong> · ${timeAgo(item.time)}</div>
        </div>
        <button class="pli-remove" title="Xóa khỏi lịch sử">✕</button>
      </div>
    `).join('');

    // Resume watch
    qsa('.profile-list-item', list).forEach(itemEl => {
      itemEl.addEventListener('click', async (e) => {
        if (e.target.closest('.pli-remove')) {
          e.stopPropagation();
          Auth.removeHistoryItem(itemEl.dataset.slug);
          renderHistory();
          toast('Đã xoá phim khỏi lịch sử xem.');
          return;
        }
        mod.classList.add('hidden');
        try {
          const m = (await API.detail(itemEl.dataset.slug)).movie;
          const sIdx = parseInt(itemEl.dataset.sidx) || 0;
          const eIdx = parseInt(itemEl.dataset.eidx) || 0;
          const srv = m.episodes[sIdx] || m.episodes[0];
          const ep = srv.items[eIdx] || srv.items[0];
          Router.go('watch', { movie: m, serverIdx: sIdx, epIdx: eIdx, embed: ep.embed });
        } catch {
          toast('Không thể mở lại phim.');
        }
      });
    });
  }

  function renderFavs() {
    const list = qs('#favsList');
    const f = Auth.getFavs();
    qs('#statFavCount').textContent = f.length;

    if (!f.length) {
      list.innerHTML = `<div class="empty-state" style="padding:30px 10px"><div class="empty-icon" style="font-size:32px">♥</div><p>Chưa có phim trong danh sách yêu thích.</p></div>`;
      return;
    }

    list.innerHTML = f.map(item => `
      <div class="profile-list-item" data-slug="${item.slug}">
        <img src="${item.thumb_url}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 240%22><rect fill=%22%232a2e42%22 width=%22160%22 height=%22240%22/></svg>'" />
        <div class="pli-info">
          <div class="pli-name">${item.name}</div>
        </div>
      </div>
    `).join('');

    qsa('.profile-list-item', list).forEach(itemEl => {
      itemEl.onclick = () => {
        mod.classList.add('hidden');
        Router.go('detail', { slug: itemEl.dataset.slug });
      };
    });
  }

  function showTab(tabId) {
    qsa('.profile-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === tabId));
    qsa('.profile-panel').forEach(p => p.classList.add('hidden'));
    qs(`#ptab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`).classList.remove('hidden');

    if (tabId === 'history') renderHistory();
    if (tabId === 'favs') renderFavs();

    qs('#changePassError').classList.add('hidden');
    qs('#profileInfoError').classList.add('hidden');
  }

  qsa('.profile-tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.ptab)));
  qs('#profileModalClose').addEventListener('click', () => mod.classList.add('hidden'));

  // Lưu thông tin cơ bản
  qs('#profileInfoForm').addEventListener('submit', e => {
    e.preventDefault();
    const res = Auth.updateInfo(qs('#profileNameInput').value);
    const err = qs('#profileInfoError');
    if (res.ok) {
      err.textContent = 'Đã lưu thay đổi họ tên!';
      err.className = 'form-success';
      err.classList.remove('hidden');
      updateAuthUI();
      open();
    }
  });

  // Đổi mật khẩu
  qs('#changePassForm').addEventListener('submit', e => {
    e.preventDefault();
    const oldP = qs('#oldPassword').value;
    const newP = qs('#newPassword').value;
    const confP = qs('#confirmPassword').value;
    const err = qs('#changePassError');
    err.className = 'form-error';

    if (newP.length < 6) {
      err.textContent = 'Mật khẩu mới phải có tối thiểu 6 ký tự.';
      err.classList.remove('hidden');
      return;
    }
    if (newP !== confP) {
      err.textContent = 'Xác nhận mật khẩu mới không trùng khớp.';
      err.classList.remove('hidden');
      return;
    }

    const res = Auth.changePassword(oldP, newP);
    if (!res.ok) {
      err.textContent = res.err;
      err.classList.remove('hidden');
    } else {
      err.textContent = 'Đổi mật khẩu thành công!';
      err.className = 'form-success';
      err.classList.remove('hidden');
      qs('#changePassForm').reset();
      toast('Đã cập nhật mật khẩu mới! 🔒');
    }
  });

  // Xóa lịch sử
  qs('#clearHistoryBtn').addEventListener('click', () => {
    Auth.clearHistory();
    renderHistory();
    toast('Đã dọn dẹp sạch toàn bộ lịch sử xem.');
  });

  // Đăng xuất
  qs('#profileLogoutBtn').addEventListener('click', () => {
    Auth.logout();
    mod.classList.add('hidden');
    updateAuthUI();
    toast('Đã đăng xuất tài khoản.');
  });

  function open() {
    const u = Auth.current();
    if (!u) return;
    qs('#profileAvatar').textContent = u.avatar;
    qs('#profileName').textContent = u.name;
    qs('#profileEmail').textContent = u.email;

    const isGoogle = u.type === 'google';
    qs('#profileBadge').textContent = isGoogle ? '✓ Google Account Verified' : 'Lumi Member';
    qs('#profileBadge').style.color = isGoogle ? '#4285f4' : 'var(--green)';

    qs('#profileNameInput').value = u.name;
    qs('#profileEmailInput').value = u.email;

    // Hiển thị giao diện tab Đổi mật khẩu tương ứng với loại tài khoản
    const googleNotice = qs('#googlePasswordNotice');
    const changeForm = qs('#changePassForm');
    if (isGoogle) {
      googleNotice.classList.remove('hidden');
      changeForm.classList.add('hidden');
    } else {
      googleNotice.classList.add('hidden');
      changeForm.classList.remove('hidden');
    }

    renderHistory();
    renderFavs();
    showTab('info');
    mod.classList.remove('hidden');
  }

  return { open };
})();

// Password Visibility Toggles
qsa('.pass-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = qs(`#${btn.dataset.target}`);
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
    } else {
      input.type = 'password';
      btn.textContent = '👁';
    }
  });
});

function updateAuthUI() {
  const u = Auth.current();
  if (u) {
    qs('#avatarBadge').textContent = u.avatar;
    qs('#authLabel').textContent = u.name.split(' ')[0] || 'Tài khoản';
  } else {
    qs('#avatarBadge').textContent = '👤';
    qs('#authLabel').textContent = 'Đăng nhập';
  }
}

// Bắt sự kiện form Đăng nhập / Đăng ký
qs('#authBtn').addEventListener('click', () => {
  if (Auth.isLoggedIn()) ProfileUI.open();
  else openAuthModal('login');
});

qs('#loginFormEl').addEventListener('submit', e => {
  e.preventDefault();
  const res = Auth.login(qs('#loginEmail').value, qs('#loginPassword').value);
  const err = qs('#loginError');
  if (!res.ok) {
    err.textContent = res.err;
    err.classList.remove('hidden');
  } else {
    err.classList.add('hidden');
    qs('#authModal').classList.add('hidden');
    updateAuthUI();
    toast('Chào mừng bạn đã trở lại! 🎬');
  }
});

qs('#signupFormEl').addEventListener('submit', e => {
  e.preventDefault();
  const res = Auth.signup(qs('#signupName').value, qs('#signupEmail').value, qs('#signupPassword').value);
  const err = qs('#signupError');
  if (!res.ok) {
    err.textContent = res.err;
    err.classList.remove('hidden');
  } else {
    err.classList.add('hidden');
    qs('#authModal').classList.add('hidden');
    updateAuthUI();
    toast('Tạo tài khoản thành công! 🎉');
  }
});

/* ═══════════════════════════════════════════════════════
   13. QUICK FILTER BAR & INITIALIZATION
═══════════════════════════════════════════════════════ */
const FilterBar = (() => {
  const GENRES = [
    { v: 'hanh-dong', l: 'Hành Động' }, { v: 'tinh-cam', l: 'Tình Cảm' },
    { v: 'hai-huoc', l: 'Hài Hước' }, { v: 'tam-ly', l: 'Tâm Lý' },
    { v: 'hoat-hinh', l: 'Hoạt Hình' }, { v: 'kinh-di', l: 'Kinh Dị' },
    { v: 'vien-tuong', l: 'Viễn Tưởng' }, { v: 'phieu-luu', l: 'Phiêu Lưu' },
    { v: 'co-trang', l: 'Cổ Trang' }, { v: 'chien-tranh', l: 'Chiến Tranh' }
  ];
  const COUNTRIES = [
    { v: 'my', l: 'Mỹ' }, { v: 'han-quoc', l: 'Hàn Quốc' },
    { v: 'trung-quoc', l: 'Trung Quốc' }, { v: 'viet-nam', l: 'Việt Nam' },
    { v: 'nhat-ban', l: 'Nhật Bản' }, { v: 'thai-lan', l: 'Thái Lan' },
    { v: 'anh', l: 'Anh' }, { v: 'phap', l: 'Pháp' }
  ];

  function fillSelect(selId, opts) {
    const sel = qs(`#${selId}`);
    opts.forEach(o => {
      const opt = el('option');
      opt.value = o.v;
      opt.textContent = o.l;
      sel.appendChild(opt);
    });
  }

  let inited = false;
  return {
    init() {
      if (inited) return;
      inited = true;
      fillSelect('filterGenre', GENRES);
      fillSelect('filterCountry', COUNTRIES);
      fillSelect('filterLang', [
        { v: 'vietsub', l: 'Vietsub' },
        { v: 'thuyet-minh', l: 'Thuyết minh' },
        { v: 'long-tieng', l: 'Lồng tiếng' }
      ]);
      const selYear = qs('#filterYear');
      const curYear = new Date().getFullYear();
      for (let y = curYear; y >= 2012; y--) {
        const o = el('option');
        o.value = y;
        o.textContent = `Năm ${y}`;
        selYear.appendChild(o);
      }
    }
  };
})();

/* ═══════════════════════════════════════════════════════
   14. BOOTSTRAP EVENT LISTENERS
═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Theme Toggle (Light / Dark)
  qs('#themeToggle').addEventListener('click', () => {
    const ds = document.documentElement.dataset;
    const isDark = ds.theme === 'dark';
    ds.theme = isDark ? 'light' : 'dark';
    localStorage.setItem('lumi_theme', ds.theme);
    qs('#themeIcon').textContent = isDark ? '☾' : '☀';
  });
  if (localStorage.getItem('lumi_theme') === 'light') {
    document.documentElement.dataset.theme = 'light';
    qs('#themeIcon').textContent = '☾';
  }

  // Filter Apply & Reset
  qs('#filterApply').addEventListener('click', () => {
    const g = qs('#filterGenre').value;
    const c = qs('#filterCountry').value;
    const y = qs('#filterYear').value;
    const l = qs('#filterLang').value;
    if (!g && !c && !y && !l) return toast('Vui lòng chọn ít nhất một tiêu chí lọc.');

    const p = {};
    const labels = [];
    if (g) {
      p.genre = g;
      labels.push(qs('#filterGenre option:checked').text);
    }
    if (c) {
      p.country = c;
      labels.push(qs('#filterCountry option:checked').text);
    }
    if (y) {
      p.year = y;
      labels.push(`Năm ${y}`);
    }
    if (l) {
      p.lang = l;
      labels.push(qs('#filterLang option:checked').text);
    }
    p.title = labels.join(' · ');

    Router.go('list', p);
  });
  qs('#filterReset').addEventListener('click', () => {
    qsa('.select-group select').forEach(s => s.value = '');
  });

  // Navigation Links
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-page]');
    if (!link) return;
    e.preventDefault();
    const p = link.dataset.page;
    if (p === 'home') {
      Home.reset();
      Router.go('home');
    } else if (['new', 'phim-le', 'phim-bo', 'phim-chieu-rap'].includes(p)) {
      Router.go('list', { type: p, slug: p === 'new' ? undefined : p });
    } else {
      Router.go('list', { slug: p });
    }
    qs('#mobileNav').classList.remove('open');
  });

  // Mobile hamburger
  qs('#hamburger').addEventListener('click', () => qs('#mobileNav').classList.toggle('open'));

  // Back buttons
  qs('#backBtn').addEventListener('click', () => history.back() || Router.go('home'));
  qs('#backFromWatch').addEventListener('click', () => {
    const m = Watch.state().movie;
    if (m) Router.go('detail', { slug: m.slug });
    else Router.go('home');
  });

  // Brand home logo
  qs('#brandHome').onclick = qs('#footerBrand').onclick = (e) => {
    e.preventDefault();
    Home.reset();
    Router.go('home');
  };

  // Khởi động
  updateAuthUI();
  FilterBar.init();
  if (!Router.restore()) Router.go('home');

  window.addEventListener('popstate', () => {
    const route = Router.restore();
    if (!route) Router.go('home');
  });
});
