/* ============================================================
   渲染层：今日视图、计时器、统计、设置、Toast、弹窗
   ============================================================ */
(function (global) {
  'use strict';

  var RING_C = 2 * Math.PI * 130;
  var WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatMs(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return pad(m) + ':' + pad(s);
  }

  function init() {
    els.topCups = $('topCups');
    els.topMg = $('topMg');
    els.summary = $('summary');
    els.quickChips = $('quickChips');
    els.timeline = $('timeline');
    els.timelineMeta = $('timelineMeta');
    els.roundDots = $('roundDots');
    els.roundText = $('roundText');
    els.ring = $('ringProgress');
    els.timerTime = $('timerTime');
    els.timerPhase = $('timerPhase');
    els.timerCaption = $('timerCaption');
    els.timerCard = document.querySelector('.timer-card');
    els.prepFields = $('prepFields');
    els.btnPrimary = $('btnPrimary');
    els.btnSecondary = $('btnSecondary');
    els.weekChart = $('weekChart');
    els.todayChart = $('todayChart');
    els.historyList = $('historyList');
    els.residueNote = $('residueNote');
    els.toastHost = $('toastHost');
    els.modalBackdrop = $('modalBackdrop');
    els.modal = $('modal');
    els.stats = $('view-stats');
  }

  /* ---------- 今日 ---------- */

  function renderTopbar() {
    var coffees = Store.getTodayCoffees();
    els.topCups.textContent = coffees.length + ' 杯';
    els.topMg.textContent = Coffee.totalMg(coffees) + ' mg';
  }

  function renderSummary() {
    var coffees = Store.getTodayCoffees();
    var total = Coffee.totalMg(coffees);
    var limit = Store.getSettings().dailyCaffeineLimit;
    var rounds = Store.getRoundsToday();
    var goal = Store.getSettings().dailyGoalRounds;
    var over = total > limit;

    els.summary.innerHTML =
      '<div class="stat">' +
      '<div class="stat-value">' + coffees.length + '<span class="stat-unit">杯</span></div>' +
      '<div class="stat-label">今日咖啡</div>' +
      '</div>' +
      '<div class="stat">' +
      '<div class="stat-value' + (over ? ' is-warn' : '') + '">' + total + '<span class="stat-unit">mg</span></div>' +
      '<div class="stat-label">咖啡因' + (over ? ' · 已超上限' : '') + '</div>' +
      '</div>' +
      '<div class="stat">' +
      '<div class="stat-value">' + rounds + '<span class="stat-unit">/ ' + goal + ' 轮</span></div>' +
      '<div class="stat-label">专注</div>' +
      '</div>';
  }

  function renderChips() {
    var quick = Coffee.getQuickTypes()
      .map(function (t) {
        return (
          '<button class="chip" data-type="' + t.key + '" aria-label="记录一杯' + esc(t.name) + '，约 ' + t.mg + ' 毫克咖啡因">' +
          '<span class="chip-dot" style="background:' + t.color + '"></span>' +
          '<span class="chip-name">' + esc(t.name) + '</span>' +
          '<span class="chip-mg">' + t.mg + 'mg</span>' +
          '</button>'
        );
      })
      .join('');

    els.quickChips.innerHTML =
      quick +
      '<button class="chip is-custom" data-type="__custom" aria-label="自定义记录一杯咖啡">' +
      '<span class="chip-name">+ 自定义</span>' +
      '</button>';
  }

  function renderTimeline() {
    var items = [];

    Store.getTodayCoffees().forEach(function (c) {
      items.push({ kind: 'coffee', ts: c.ts, data: c });
    });

    Store.getTodaySessions().forEach(function (s) {
      items.push({ kind: 'focus', ts: s.endTs, data: s });
    });

    items.sort(function (a, b) {
      return b.ts - a.ts;
    });

    els.timelineMeta.textContent = items.length ? '共 ' + items.length + ' 条' : '';

    if (!items.length) {
      els.timeline.innerHTML = '<div class="empty">今天还没有咖啡，来一杯？</div>';
      return;
    }

    els.timeline.innerHTML = items
      .map(function (item) {
        var time = Store.formatTime(item.ts);

        if (item.kind === 'coffee') {
          var c = item.data;
          var color = Coffee.getType(c.type).color;
          return (
            '<div class="tl-item" role="button" tabindex="0" data-coffee-id="' + esc(c.id) + '" aria-label="编辑记录：' + esc(c.name) + ' ' + time + '">' +
            '<div class="tl-rail"><span class="tl-dot" style="border-color:' + color + '"></span></div>' +
            '<div class="tl-body">' +
            '<div class="tl-line"><span class="tl-title">' + esc(c.name) + '</span>' +
            '<span class="tl-tag">' + (c.ml ? c.ml + 'ml · ' : '') + (c.mg || 0) + 'mg</span></div>' +
            (c.note ? '<div class="tl-note">' + esc(c.note) + '</div>' : '') +
            '</div>' +
            '<span class="tl-time">' + time + '</span>' +
            '</div>'
          );
        }

        var s = item.data;
        var aborted = s.completed === false;
        var mins = aborted ? s.plannedMin || 0 : s.actualMin || 0;
        return (
          '<div class="tl-item is-static' + (aborted ? ' is-aborted' : '') + '">' +
          '<div class="tl-rail"><span class="tl-dot is-focus' + (aborted ? ' is-aborted' : '') + '"></span></div>' +
          '<div class="tl-body">' +
          '<div class="tl-line"><span class="tl-title">专注 ' + mins + ' 分钟</span>' +
          (s.label ? '<span class="tl-tag">' + esc(s.label) + '</span>' : '') +
          (aborted ? '<span class="tl-tag is-aborted">已放弃 · 不计入时长</span>' : '') + '</div>' +
          '</div>' +
          '<span class="tl-time">' + time + '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderRounds() {
    var rounds = Store.getRoundsToday();
    var goal = Store.getSettings().dailyGoalRounds;
    var count = Math.max(goal, rounds);
    var html = '';

    for (var i = 0; i < count; i++) {
      html += '<span class="round-dot' + (i < rounds ? ' is-done' : '') + '"></span>';
    }

    els.roundDots.innerHTML = html;
    els.roundText.textContent = '今日 ' + rounds + ' / ' + goal + ' 轮';
  }

  function renderToday() {
    renderTopbar();
    renderSummary();
    renderTimeline();
    renderRounds();
  }

  /* ---------- 计时器 ---------- */

  function renderTimer(snap) {
    var card = els.timerCard;
    var idle = snap.mode === 'idle';
    var ratio = idle || !snap.totalMs ? 1 : snap.remainingMs / snap.totalMs;

    card.dataset.mode = snap.mode;
    card.classList.toggle('is-paused', !!snap.paused);

    els.ring.style.strokeDashoffset = (RING_C * (1 - ratio)).toFixed(2);

    els.timerTime.textContent = idle
      ? formatMs(Store.getSettings().focusMin * 60000)
      : formatMs(snap.remainingMs);

    if (idle) {
      els.timerPhase.textContent = '准备开始';
      els.timerCaption.textContent = '专注一件事';
    } else if (snap.paused) {
      els.timerPhase.textContent = '已暂停';
      els.timerCaption.textContent = snap.mode === 'focus' ? snap.label || '专注一件事' : '休息中';
    } else if (snap.mode === 'focus') {
      els.timerPhase.textContent = '专注中';
      els.timerCaption.textContent = snap.label || '专注一件事';
    } else {
      els.timerPhase.textContent = snap.mode === 'long' ? '长休息' : '短休息';
      els.timerCaption.textContent = snap.mode === 'long' ? '好好休息一会' : '起来走两步';
    }

    if (idle) {
      els.btnPrimary.textContent = '开始专注';
      els.btnSecondary.classList.add('is-hidden');
    } else if (snap.mode === 'focus') {
      els.btnPrimary.textContent = snap.paused ? '继续' : '暂停';
      els.btnSecondary.textContent = '放弃';
      els.btnSecondary.classList.remove('is-hidden');
    } else {
      els.btnPrimary.textContent = snap.paused ? '继续' : '暂停';
      els.btnSecondary.textContent = '跳过休息';
      els.btnSecondary.classList.remove('is-hidden');
    }

    els.prepFields.classList.toggle('is-hidden', !idle);

    if (idle) document.title = '咖啡番茄钟';
    else if (snap.mode === 'focus') document.title = formatMs(snap.remainingMs) + ' · 专注中';
    else document.title = formatMs(snap.remainingMs) + ' · 休息';
  }

  /* ---------- 统计 ---------- */

  function renderStats(metric) {
    els.weekChart.innerHTML = Stats.renderWeekChart(metric);
    els.todayChart.innerHTML = Stats.renderTodayChart();
    els.historyList.innerHTML = Stats.renderHistory();

    var coffees = Store.getTodayCoffees();
    var total = Coffee.totalMg(coffees);
    var remaining = Math.round(Coffee.remainingMg(coffees));
    var limit = Store.getSettings().dailyCaffeineLimit;

    var note = '今日已摄入 <strong>' + total + 'mg</strong>，按 5 小时半衰期估算，此刻体内残留约 <strong>' + remaining + 'mg</strong>。';
    if (total > limit) note += ' 已超过你设定的每日上限 ' + limit + 'mg，下一杯可以考虑低因或水。';
    els.residueNote.innerHTML = note;
  }

  /* ---------- 设置 ---------- */

  function renderSettings(s) {
    $('setFocus').value = s.focusMin;
    $('setShortBreak').value = s.shortBreakMin;
    $('setLongBreak').value = s.longBreakMin;
    $('setRoundsPerLong').value = s.roundsPerLongBreak;
    $('setDailyGoal').value = s.dailyGoalRounds;
    $('setLimit').value = s.dailyCaffeineLimit;
    $('setTheme').value = s.theme;
    $('setSound').setAttribute('aria-checked', s.soundOn ? 'true' : 'false');
    $('setNotify').setAttribute('aria-checked', s.notifyOn ? 'true' : 'false');
  }

  /* ---------- Toast ---------- */

  function toast(message, options) {
    options = options || {};
    var host = els.toastHost;

    while (host.children.length >= 3) {
      host.removeChild(host.firstChild);
    }

    var el = document.createElement('div');
    el.className = 'toast';

    var text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);

    var timer = null;
    var dismissed = false;

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(timer);
      el.classList.add('is-out');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    }

    if (options.actionLabel) {
      var btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = options.actionLabel;
      btn.addEventListener('click', function () {
        dismiss();
        if (options.onAction) options.onAction();
      });
      el.appendChild(btn);
    }

    host.appendChild(el);
    timer = setTimeout(dismiss, options.duration || 3500);
  }

  /* ---------- 弹窗 ---------- */

  function closeModal() {
    els.modalBackdrop.classList.add('is-hidden');
    els.modal.innerHTML = '';
    document.removeEventListener('keydown', onEsc);
  }

  function onEsc(e) {
    if (e.key === 'Escape') closeModal();
  }

  function openModal(config) {
    var actions = config.actions || [];

    els.modal.innerHTML =
      '<h3 class="modal-title" id="modalTitle">' + esc(config.title || '') + '</h3>' +
      '<div class="modal-body">' + (config.bodyHTML || '') + '</div>' +
      '<div class="modal-actions"></div>';

    var actionHost = els.modal.querySelector('.modal-actions');

    actions.forEach(function (action) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (action.className || 'btn-ghost');
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        var result = action.onClick ? action.onClick(els.modal) : true;
        if (result !== false) closeModal();
      });
      actionHost.appendChild(btn);
    });

    els.modalBackdrop.classList.remove('is-hidden');
    document.addEventListener('keydown', onEsc);

    var firstInput = els.modal.querySelector('input, select, textarea');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 50);

    return els.modal;
  }

  global.UI = {
    init: init,
    renderToday: renderToday,
    renderChips: renderChips,
    renderTimer: renderTimer,
    renderStats: renderStats,
    renderSettings: renderSettings,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    formatMs: formatMs,
    esc: esc
  };
})(window);
