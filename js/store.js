/* ============================================================
   数据层：读写 localStorage，维护咖啡 / 专注记录
   ============================================================ */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'coffee-pomodoro:v1';

  var DEFAULT_SETTINGS = {
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    roundsPerLongBreak: 4,
    dailyGoalRounds: 4,
    dailyCaffeineLimit: 400,
    soundOn: true,
    notifyOn: true,
    theme: 'system'
  };

  var state = null;
  var listeners = [];

  /* ---------- 小工具 ---------- */

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function isSameDay(a, b) {
    return startOfDay(a) === startOfDay(b);
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatTime(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formatDateLabel(ts) {
    var today = startOfDay(Date.now());
    var day = startOfDay(ts);
    if (day === today) return '今天';
    if (day === today - 86400000) return '昨天';
    var d = new Date(ts);
    return d.getMonth() + 1 + '月' + d.getDate() + '日';
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clampInt(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  /* ---------- 初始化 ---------- */

  function createEmpty() {
    return {
      version: 1,
      meta: { seeded: false, demoFocusRemoved: false },
      settings: clone(DEFAULT_SETTINGS),
      coffees: [],
      sessions: []
    };
  }

  function load() {
    var raw = null;
    try {
      raw = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (err) {
      raw = null;
    }

    var next = createEmpty();
    if (!raw || typeof raw !== 'object') return next;

    next.meta.seeded = !!(raw.meta && raw.meta.seeded);
    next.meta.demoFocusRemoved = !!(raw.meta && raw.meta.demoFocusRemoved);
    next.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});

    if (Array.isArray(raw.coffees)) {
      next.coffees = raw.coffees.filter(function (c) {
        return c && typeof c.ts === 'number';
      });
    }

    if (Array.isArray(raw.sessions)) {
      next.sessions = raw.sessions.filter(function (s) {
        return s && typeof s.endTs === 'number';
      });
    }

    return next;
  }

  function save() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* 隐私模式等场景下退化为内存态，不影响本次使用 */
    }
    notify();
  }

  function notify() {
    listeners.forEach(function (fn) {
      try {
        fn(state);
      } catch (err) {
        console.error(err);
      }
    });
  }

  /* 首次进入时放两条示例咖啡，专注次数从 0 开始 */
  function seed() {
    if (state.meta.seeded) return;
    state.meta.seeded = true;
    state.meta.demoFocusRemoved = true;

    if (state.coffees.length || state.sessions.length) return;

    var dayStart = startOfDay(Date.now());
    var nowTs = Date.now();

    function ago(ms) {
      return Math.max(dayStart + 60000, nowTs - ms);
    }

    state.coffees.push({
      id: uid('cf_'),
      ts: ago(5 * 3600 * 1000),
      type: 'latte',
      name: '拿铁',
      ml: 240,
      mg: 63,
      note: ''
    });

    state.coffees.push({
      id: uid('cf_'),
      ts: ago(90 * 60 * 1000),
      type: 'americano',
      name: '美式',
      ml: 240,
      mg: 95,
      note: ''
    });

    save();
  }

  /* 旧版示例数据里带一条 25 分钟专注记录，升级时移除，让专注次数从 0 开始 */
  function migrateDemoSession() {
    if (!state.meta.seeded || state.meta.demoFocusRemoved) return;

    state.meta.demoFocusRemoved = true;
    state.sessions = state.sessions.filter(function (s) {
      return !(
        s.kind === 'focus' &&
        s.completed === true &&
        s.plannedMin === 25 &&
        s.actualMin === 25 &&
        s.label === '整理笔记' &&
        !s.coffeeId
      );
    });
    save();
  }

  function init() {
    if (state) return state;
    state = load();
    migrateDemoSession();
    seed();
    return state;
  }

  /* ---------- 查询 ---------- */

  function getState() {
    return state;
  }

  function getSettings() {
    return state.settings;
  }

  function getTodayCoffees() {
    return state.coffees
      .filter(function (c) {
        return isSameDay(c.ts, Date.now());
      })
      .sort(function (a, b) {
        return a.ts - b.ts;
      });
  }

  function getTodaySessions() {
    return state.sessions
      .filter(function (s) {
        return s.kind === 'focus' && isSameDay(s.endTs, Date.now());
      })
      .sort(function (a, b) {
        return a.endTs - b.endTs;
      });
  }

  function getRoundsToday() {
    return getTodaySessions().filter(function (s) {
      return s.completed;
    }).length;
  }

  function getCoffee(id) {
    return state.coffees.filter(function (c) {
      return c.id === id;
    })[0] || null;
  }

  /* ---------- 写入 ---------- */

  function updateSettings(patch) {
    var s = state.settings;
    var next = Object.assign({}, s, patch);

    next.focusMin = clampInt(next.focusMin, 1, 180, s.focusMin);
    next.shortBreakMin = clampInt(next.shortBreakMin, 1, 60, s.shortBreakMin);
    next.longBreakMin = clampInt(next.longBreakMin, 1, 60, s.longBreakMin);
    next.roundsPerLongBreak = clampInt(next.roundsPerLongBreak, 2, 12, s.roundsPerLongBreak);
    next.dailyGoalRounds = clampInt(next.dailyGoalRounds, 1, 24, s.dailyGoalRounds);
    next.dailyCaffeineLimit = clampInt(next.dailyCaffeineLimit, 50, 1200, s.dailyCaffeineLimit);

    next.soundOn = !!next.soundOn;
    next.notifyOn = !!next.notifyOn;
    if (['system', 'light', 'dark'].indexOf(next.theme) === -1) next.theme = 'system';

    state.settings = next;
    save();
    return next;
  }

  function addCoffee(data) {
    var item = {
      id: uid('cf_'),
      ts: typeof data.ts === 'number' ? data.ts : Date.now(),
      type: data.type || 'custom',
      name: data.name || '咖啡',
      ml: Math.max(0, Math.round(Number(data.ml) || 0)),
      mg: Math.max(0, Math.round(Number(data.mg) || 0)),
      note: String(data.note || '').slice(0, 100)
    };
    state.coffees.push(item);
    save();
    return item;
  }

  function updateCoffee(id, patch) {
    var item = getCoffee(id);
    if (!item) return null;

    if (typeof patch.ts === 'number') item.ts = patch.ts;
    if (typeof patch.name === 'string') item.name = patch.name.slice(0, 24) || '咖啡';
    if (patch.ml != null) item.ml = Math.max(0, Math.round(Number(patch.ml) || 0));
    if (patch.mg != null) item.mg = Math.max(0, Math.round(Number(patch.mg) || 0));
    if (typeof patch.note === 'string') item.note = patch.note.slice(0, 100);

    save();
    return item;
  }

  function deleteCoffee(id) {
    var before = state.coffees.length;
    state.coffees = state.coffees.filter(function (c) {
      return c.id !== id;
    });

    if (state.coffees.length !== before) {
      state.sessions.forEach(function (s) {
        if (s.coffeeId === id) s.coffeeId = null;
      });
      save();
      return true;
    }
    return false;
  }

  function clearTodayCoffees() {
    var removedIds = [];
    state.coffees = state.coffees.filter(function (c) {
      if (isSameDay(c.ts, Date.now())) {
        removedIds.push(c.id);
        return false;
      }
      return true;
    });

    if (!removedIds.length) return 0;

    state.sessions.forEach(function (s) {
      if (removedIds.indexOf(s.coffeeId) !== -1) s.coffeeId = null;
    });
    save();
    return removedIds.length;
  }

  function addSession(data) {
    var item = Object.assign(
      {
        id: uid('ss_'),
        startTs: Date.now(),
        endTs: Date.now(),
        plannedMin: 25,
        actualMin: 25,
        label: '',
        coffeeId: null,
        completed: true,
        kind: 'focus'
      },
      data
    );
    state.sessions.push(item);
    save();
    return item;
  }

  function clearAll() {
    state.coffees = [];
    state.sessions = [];
    state.meta.seeded = true;
    save();
  }

  /* ---------- 导入导出 ---------- */

  function exportJSON() {
    return JSON.stringify(
      {
        app: 'coffee-pomodoro',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: state.settings,
        coffees: state.coffees,
        sessions: state.sessions
      },
      null,
      2
    );
  }

  function importJSON(text) {
    var raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || (!Array.isArray(raw.coffees) && !Array.isArray(raw.sessions))) {
      throw new Error('文件格式不正确');
    }

    var next = createEmpty();
    next.meta.seeded = true;
    next.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
    next.coffees = (Array.isArray(raw.coffees) ? raw.coffees : []).filter(function (c) {
      return c && typeof c.ts === 'number';
    });
    next.sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(function (s) {
      return s && typeof s.endTs === 'number';
    });

    state = next;
    save();
    return state;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (item) {
        return item !== fn;
      });
    };
  }

  /* ---------- 导出 ---------- */

  global.Store = {
    init: init,
    getState: getState,
    getSettings: getSettings,
    updateSettings: updateSettings,
    subscribe: subscribe,

    addCoffee: addCoffee,
    updateCoffee: updateCoffee,
    deleteCoffee: deleteCoffee,
    getCoffee: getCoffee,
    getTodayCoffees: getTodayCoffees,

    addSession: addSession,
    getTodaySessions: getTodaySessions,
    getRoundsToday: getRoundsToday,

    clearAll: clearAll,
    clearTodayCoffees: clearTodayCoffees,
    exportJSON: exportJSON,
    importJSON: importJSON,

    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    startOfDay: startOfDay,
    isSameDay: isSameDay,
    dayKey: dayKey,
    formatTime: formatTime,
    formatDateLabel: formatDateLabel
  };
})(window);
