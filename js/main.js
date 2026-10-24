/* ============================================================
   交互编排：路由、记录、计时流程、提醒、设置、数据管理
   ============================================================ */
(function (global) {
  'use strict';

  var currentView = 'today';
  var metric = 'caffeine';
  var audioCtx = null;
  var lastDayKey = '';
  var PENDING_ID = '__pending__';
  var pendingCoffee = null;

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------- 主题 ---------- */

  var darkQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme(theme) {
    var dark = theme === 'dark' || (theme === 'system' && darkQuery && darkQuery.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  /* ---------- 声音与通知 ---------- */

  function unlockAudio() {
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (err) {
      /* 无音频环境时忽略 */
    }
  }

  function playChime() {
    if (!Store.getSettings().soundOn) return;
    try {
      unlockAudio();
      if (!audioCtx) return;
      var t0 = audioCtx.currentTime;
      [880, 1174.66].forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var start = t0 + i * 0.18;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.55);
      });
    } catch (err) {
      /* 忽略音频异常 */
    }
  }

  function notify(title, body) {
    if (!Store.getSettings().notifyOn) return;
    if (!('Notification' in global)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body: body, silent: true, tag: 'coffee-pomodoro' });
    } catch (err) {
      /* 部分浏览器在非安全上下文会抛错 */
    }
  }

  function ensureNotify() {
    if (!Store.getSettings().notifyOn) return;
    if (!('Notification' in global)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  /* ---------- 路由 ---------- */

  function switchView(name) {
    currentView = name;

    document.querySelectorAll('.tab').forEach(function (tab) {
      var active = tab.dataset.view === name;
      tab.classList.toggle('is-active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });

    document.querySelectorAll('.view').forEach(function (view) {
      view.classList.toggle('is-active', view.id === 'view-' + name);
    });

    if (name === 'stats') UI.renderStats(metric);
    if (name === 'settings') UI.renderSettings(Store.getSettings());
  }

  /* ---------- 今日渲染联动 ---------- */

  function renderPairOptions(preferId) {
    var select = $('pairCoffee');
    if (!select) return;

    var selected = select.value;
    var list = Store.getTodayCoffees().slice().sort(function (a, b) {
      return b.ts - a.ts;
    });

    select.innerHTML = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = '不喝咖啡';
    select.appendChild(none);

    if (pendingCoffee) {
      var pending = document.createElement('option');
      pending.value = PENDING_ID;
      pending.textContent = pendingCoffee.name + ' ' + (pendingCoffee.ml || 0) + 'ml · 待开始记录';
      select.appendChild(pending);
    }

    list.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = Store.formatTime(c.ts) + ' · ' + c.name + (c.ml ? ' ' + c.ml + 'ml' : '');
      select.appendChild(opt);
    });

    var has = function (id) {
      return list.some(function (c) {
        return c.id === id;
      });
    };
    var prefer = preferId === PENDING_ID && pendingCoffee ? PENDING_ID : preferId && has(preferId) ? preferId : '';
    var keep = selected === PENDING_ID && pendingCoffee ? PENDING_ID : has(selected) ? selected : '';
    select.value = prefer || keep;
  }

  function renderAll() {
    UI.renderToday();
    renderPairOptions();
    if (currentView === 'stats') UI.renderStats(metric);
  }

  /* ---------- 记录咖啡 ---------- */

  function recordCoffee(typeKey) {
    var type = Coffee.getType(typeKey);
    var item = Store.addCoffee({
      type: type.key,
      name: type.name,
      ml: type.ml,
      mg: type.mg
    });

    var total = Coffee.totalMg(Store.getTodayCoffees());
    var over = total > Store.getSettings().dailyCaffeineLimit;
    var msg = type.name + ' ' + type.ml + 'ml · ' + type.mg + 'mg 已记录';
    if (over) msg += '，今日已超过设定上限';

    renderPairOptions(item.id);

    UI.toast(msg, {
      actionLabel: '撤销',
      duration: 5000,
      onAction: function () {
        Store.deleteCoffee(item.id);
        UI.toast('已撤销');
      }
    });
  }

  function chooseCoffee(typeKey) {
    var type = Coffee.getType(typeKey);

    // 计时进行中无法开始下一轮，直接记录；空闲时先记为待搭配，开始专注才写入
    if (Timer.getState().mode !== 'idle') {
      recordCoffee(typeKey);
      return;
    }

    pendingCoffee = { type: type.key, name: type.name, ml: type.ml, mg: type.mg };
    renderPairOptions(PENDING_ID);
    UI.toast('已选择 ' + type.name + '，开始专注时记录');
  }

  function combineToday(timeStr) {
    var parts = String(timeStr || '').split(':');
    var d = new Date();
    d.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0);
    return d.getTime();
  }

  function openCoffeeEditor(coffee) {
    var editing = !!coffee;
    var deferring = !editing && Timer.getState().mode === 'idle';
    var current = coffee
      ? { type: coffee.type, name: coffee.name, ml: coffee.ml, mg: coffee.mg, note: coffee.note || '', ts: coffee.ts }
      : { type: 'americano', name: '美式', ml: 240, mg: 95, note: '', ts: Date.now() };

    var typeButtons = Coffee.TYPES.map(function (t) {
      var active = t.key === current.type ? ' is-active' : '';
      return '<button type="button" class="type-btn' + active + '" data-key="' + t.key + '">' + UI.esc(t.name) + '</button>';
    }).join('');

    var bodyHTML =
      '<div class="modal-field"><span class="modal-label">类型</span><div class="type-grid">' + typeButtons + '</div></div>' +
      '<div class="modal-field"><label class="modal-label" for="mName">名称</label>' +
      '<input class="modal-input" id="mName" type="text" maxlength="24" value="' + UI.esc(current.name) + '"></div>' +
      '<div class="modal-row">' +
      '<div class="modal-field"><label class="modal-label" for="mMl">容量（ml）</label>' +
      '<input class="modal-input" id="mMl" type="number" min="0" max="2000" step="10" value="' + current.ml + '"></div>' +
      '<div class="modal-field"><label class="modal-label" for="mMg">咖啡因（mg）</label>' +
      '<input class="modal-input" id="mMg" type="number" min="0" max="1000" step="1" value="' + current.mg + '"></div>' +
      '</div>' +
      '<div class="modal-field"><label class="modal-label" for="mTime">时间</label>' +
      '<input class="modal-input" id="mTime" type="time" value="' + Store.formatTime(current.ts) + '"></div>' +
      '<div class="modal-field"><label class="modal-label" for="mNote">备注</label>' +
      '<input class="modal-input" id="mNote" type="text" maxlength="100" placeholder="可选，比如：手冲埃塞" value="' + UI.esc(current.note) + '"></div>' +
      '<p class="modal-hint">咖啡因数值为估算，可手动修改。</p>';

    var actions = [];
    if (editing) {
      actions.push({
        label: '删除',
        className: 'btn-quiet modal-delete',
        onClick: function (modal) {
          Store.deleteCoffee(coffee.id);
          UI.toast('记录已删除');
          return true;
        }
      });
    }
    actions.push({ label: '取消', className: 'btn-ghost' });
    actions.push({
      label: editing ? '保存' : deferring ? '选择' : '记录',
      className: 'btn-primary',
      onClick: function (modal) {
        var name = modal.querySelector('#mName').value.trim() || '咖啡';
        var ml = Number(modal.querySelector('#mMl').value) || 0;
        var mg = Number(modal.querySelector('#mMg').value) || 0;
        var note = modal.querySelector('#mNote').value.trim();
        var ts = combineToday(modal.querySelector('#mTime').value);

        if (editing) {
          Store.updateCoffee(coffee.id, { name: name, ml: ml, mg: mg, note: note, ts: ts });
          UI.toast('记录已更新');
        } else if (deferring) {
          pendingCoffee = {
            type: current.type,
            name: name,
            ml: ml,
            mg: mg,
            note: note,
            ts: ts
          };
          renderPairOptions(PENDING_ID);
          UI.toast('已选择 ' + name + '，开始专注时记录');
        } else {
          var item = Store.addCoffee({ type: current.type, name: name, ml: ml, mg: mg, note: note, ts: ts });
          renderPairOptions(item.id);
          var total = Coffee.totalMg(Store.getTodayCoffees());
          var over = total > Store.getSettings().dailyCaffeineLimit;
          UI.toast(name + ' · ' + mg + 'mg 已记录' + (over ? '，今日已超过设定上限' : ''), {
            actionLabel: '撤销',
            duration: 5000,
            onAction: function () {
              Store.deleteCoffee(item.id);
              UI.toast('已撤销');
            }
          });
        }
        return true;
      }
    });

    var modal = UI.openModal({
      title: editing ? '编辑记录' : deferring ? '自定义咖啡' : '记录一杯咖啡',
      bodyHTML: bodyHTML,
      actions: actions
    });

    var nameInput = modal.querySelector('#mName');
    var mlInput = modal.querySelector('#mMl');
    var mgInput = modal.querySelector('#mMg');

    modal.querySelector('.type-grid').addEventListener('click', function (e) {
      var btn = e.target.closest('.type-btn');
      if (!btn) return;

      var type = Coffee.getType(btn.dataset.key);
      current.type = type.key;

      modal.querySelectorAll('.type-btn').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
      });

      if (type.key !== 'custom') {
        nameInput.value = type.name;
        mlInput.value = type.ml;
        mgInput.value = type.mg;
      }
    });

    mlInput.addEventListener('input', function () {
      if (current.type === 'custom') return;
      var volume = Number(mlInput.value);
      if (!volume || volume <= 0) return;
      mgInput.value = Coffee.estimateMg(current.type, volume);
    });
  }

  /* ---------- 计时 ---------- */

  function startFocus() {
    var settings = Store.getSettings();
    var label = $('focusLabel').value.trim();
    var select = $('pairCoffee');
    var choice = select.value;
    var coffeeId = null;
    var recorded = null;

    if (choice === PENDING_ID && pendingCoffee) {
      var payload = {
        type: pendingCoffee.type,
        name: pendingCoffee.name,
        ml: pendingCoffee.ml,
        mg: pendingCoffee.mg
      };
      if (pendingCoffee.ts) payload.ts = pendingCoffee.ts;
      if (pendingCoffee.note) payload.note = pendingCoffee.note;

      recorded = Store.addCoffee(payload);
      coffeeId = recorded.id;
    } else if (choice) {
      coffeeId = choice;
      if (!Store.getCoffee(coffeeId)) coffeeId = null;
    }

    unlockAudio();
    ensureNotify();

    var ok = Timer.start('focus', settings.focusMin, { label: label, coffeeId: coffeeId });
    if (ok) {
      $('focusLabel').value = '';
      pendingCoffee = null;
      select.value = '';
      renderPairOptions();
      if (recorded) {
        UI.toast(recorded.name + ' ' + recorded.ml + 'ml · ' + recorded.mg + 'mg 已记录');
      }
    }
  }

  function onPrimary() {
    var snap = Timer.getState();

    if (snap.mode === 'idle') {
      startFocus();
      return;
    }

    if (snap.paused) Timer.resume();
    else Timer.pause();
  }

  function onSecondary() {
    var snap = Timer.getState();

    if (snap.mode === 'focus') {
      var elapsedMin = Math.max(0, Math.round((snap.totalMs - snap.remainingMs) / 60000));
      var elapsedText = elapsedMin > 0 ? '已经过去的 ' + elapsedMin + ' 分钟也' : '已经过去的时间也';
      UI.openModal({
        title: '放弃这一轮？',
        bodyHTML: '<p class="modal-message">放弃后，本轮专注不会计入今日轮次，' + elapsedText +
          '不会计入专注时长。</p>',
        actions: [
          { label: '继续专注', className: 'btn-ghost' },
          {
            label: '放弃',
            className: 'btn-danger',
            onClick: function () {
              var cancelled = Timer.cancel();
              if (cancelled && cancelled.mode === 'focus') {
                Store.addSession({
                  startTs: cancelled.startedAt,
                  endTs: Date.now(),
                  plannedMin: cancelled.minutes,
                  actualMin: 0,
                  label: cancelled.label,
                  coffeeId: null,
                  completed: false,
                  kind: 'focus'
                });
              }
              UI.toast('已放弃本轮，不计入专注时长');
            }
          }
        ]
      });
      return;
    }

    if (snap.mode === 'short' || snap.mode === 'long') {
      Timer.cancel();
      UI.toast('已跳过休息');
    }
  }

  function handleFinish(done) {
    if (done.mode === 'focus') {
      Store.addSession({
        startTs: done.startedAt,
        endTs: done.endedAt,
        plannedMin: done.minutes,
        actualMin: done.minutes,
        label: done.label,
        coffeeId: done.coffeeId,
        completed: true,
        kind: 'focus'
      });

      playChime();
      notify('专注完成', '这一轮结束了，起来走两步。');
      UI.toast('这一轮结束了，休息一下');

      var settings = Store.getSettings();
      var rounds = Store.getRoundsToday();
      var isLong = rounds > 0 && rounds % settings.roundsPerLongBreak === 0;
      var minutes = isLong ? settings.longBreakMin : settings.shortBreakMin;

      Timer.start(isLong ? 'long' : 'short', minutes, {});
      return;
    }

    playChime();
    notify('休息结束', '准备好了就回来。');
    UI.toast('休息结束，随时可以开始下一轮');
  }

  /* ---------- 设置 ---------- */

  function bindNumber(id, key) {
    var input = $(id);
    input.addEventListener('change', function () {
      var patch = {};
      patch[key] = input.value;
      var settings = Store.updateSettings(patch);
      UI.renderSettings(settings);
      if (Timer.getState().mode === 'idle') UI.renderTimer(Timer.getState());
    });
  }

  function bindSettings() {
    bindNumber('setFocus', 'focusMin');
    bindNumber('setShortBreak', 'shortBreakMin');
    bindNumber('setLongBreak', 'longBreakMin');
    bindNumber('setRoundsPerLong', 'roundsPerLongBreak');
    bindNumber('setDailyGoal', 'dailyGoalRounds');
    bindNumber('setLimit', 'dailyCaffeineLimit');

    $('setSound').addEventListener('click', function () {
      var next = this.getAttribute('aria-checked') !== 'true';
      this.setAttribute('aria-checked', next ? 'true' : 'false');
      Store.updateSettings({ soundOn: next });
      if (next) playChime();
    });

    $('setNotify').addEventListener('click', function () {
      var next = this.getAttribute('aria-checked') !== 'true';
      this.setAttribute('aria-checked', next ? 'true' : 'false');
      Store.updateSettings({ notifyOn: next });

      if (!next) return;
      if (!('Notification' in global)) {
        UI.toast('当前浏览器不支持系统通知');
        return;
      }
      if (Notification.permission === 'granted') {
        UI.toast('通知已开启');
      } else if (Notification.permission === 'denied') {
        UI.toast('通知被浏览器拒绝，请在站点设置中开启');
      } else {
        Notification.requestPermission().then(function (p) {
          UI.toast(p === 'granted' ? '通知已开启' : '未开启通知，将使用页面提示');
        });
      }
    });

    $('setTheme').addEventListener('change', function () {
      var theme = this.value;
      Store.updateSettings({ theme: theme });
      applyTheme(theme);
    });

    $('btnExport').addEventListener('click', function () {
      var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'coffee-pomodoro-' + Store.dayKey(Date.now()) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      UI.toast('已导出备份');
    });

    $('btnImport').addEventListener('click', function () {
      $('fileImport').click();
    });

    $('fileImport').addEventListener('change', function () {
      var file = this.files && this.files[0];
      var input = this;
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function () {
        try {
          Store.importJSON(String(reader.result));
          UI.renderToday();
          UI.renderSettings(Store.getSettings());
          UI.renderStats(metric);
          UI.renderTimer(Timer.getState());
          UI.toast('数据已导入');
        } catch (err) {
          UI.toast('导入失败：' + (err.message || '文件无法解析'));
        }
        input.value = '';
      };
      reader.readAsText(file);
    });

    $('btnClear').addEventListener('click', function () {
      UI.openModal({
        title: '清空全部数据',
        bodyHTML: '<p class="modal-message">所有咖啡记录与专注记录将被删除，且无法撤销。建议先导出备份。</p>',
        actions: [
          { label: '取消', className: 'btn-ghost' },
          {
            label: '清空',
            className: 'btn-danger',
            onClick: function () {
              Store.clearAll();
              UI.toast('数据已清空');
            }
          }
        ]
      });
    });
  }

  /* ---------- 事件 ---------- */

  function bindEvents() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchView(tab.dataset.view);
      });
    });

    $('quickChips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;

      if (chip.dataset.type === '__custom') openCoffeeEditor(null);
      else chooseCoffee(chip.dataset.type);
    });

    $('pairCoffee').addEventListener('change', function () {
      if (this.value !== PENDING_ID) {
        pendingCoffee = null;
        renderPairOptions(this.value);
      }
    });

    $('btnCustomCoffee').addEventListener('click', function () {
      openCoffeeEditor(null);
    });

    $('btnResetCoffee').addEventListener('click', function () {
      var coffees = Store.getTodayCoffees();
      if (!coffees.length) {
        UI.toast('今天还没有咖啡记录');
        return;
      }

      var total = Coffee.totalMg(coffees);
      UI.openModal({
        title: '重置今日咖啡？',
        bodyHTML: '<p class="modal-message">将删除今天记录的 ' + coffees.length + ' 杯咖啡（共 ' + total +
          ' mg 咖啡因），杯数与咖啡因会归零。专注记录不受影响。</p>',
        actions: [
          { label: '取消', className: 'btn-ghost' },
          {
            label: '重置',
            className: 'btn-danger',
            onClick: function () {
              Store.clearTodayCoffees();
              UI.toast('已重置今日咖啡');
            }
          }
        ]
      });
    });

    $('timeline').addEventListener('click', function (e) {
      var item = e.target.closest('[data-coffee-id]');
      if (!item) return;
      var coffee = Store.getCoffee(item.dataset.coffeeId);
      if (coffee) openCoffeeEditor(coffee);
    });

    $('timeline').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var item = e.target.closest('[data-coffee-id]');
      if (!item) return;
      e.preventDefault();
      var coffee = Store.getCoffee(item.dataset.coffeeId);
      if (coffee) openCoffeeEditor(coffee);
    });

    $('btnPrimary').addEventListener('click', onPrimary);
    $('btnSecondary').addEventListener('click', onSecondary);

    $('statMetric').addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      metric = btn.dataset.metric === 'focus' ? 'focus' : 'caffeine';
      this.querySelectorAll('.seg-btn').forEach(function (b) {
        var active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      UI.renderStats(metric);
    });

    $('modalBackdrop').addEventListener('click', function (e) {
      if (e.target === this) UI.closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input, textarea, select')) return;
      if (!$('modalBackdrop').classList.contains('is-hidden')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        onPrimary();
        return;
      }

      if (e.key === 'Escape') {
        if (Timer.getState().mode === 'focus') onSecondary();
        return;
      }

      if (e.key === 'c' || e.key === 'C') {
        chooseCoffee('americano');
      }
    });

    if (darkQuery) {
      var onSchemeChange = function () {
        applyTheme(Store.getSettings().theme);
      };
      if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSchemeChange);
      else if (darkQuery.addListener) darkQuery.addListener(onSchemeChange);
    }
  }

  /* ---------- 跨天刷新 ---------- */

  function watchDayChange() {
    lastDayKey = Store.dayKey(Date.now());
    setInterval(function () {
      var key = Store.dayKey(Date.now());
      if (key !== lastDayKey) {
        lastDayKey = key;
        renderAll();
        if (Timer.getState().mode === 'idle') UI.renderTimer(Timer.getState());
      }
    }, 60000);
  }

  /* ---------- 启动 ---------- */

  function boot() {
    Store.init();
    UI.init();

    var settings = Store.getSettings();
    applyTheme(settings.theme);

    UI.renderToday();
    UI.renderChips();
    UI.renderSettings(settings);
    UI.renderStats(metric);
    UI.renderTimer(Timer.getState());
    renderPairOptions();

    bindEvents();
    bindSettings();

    Store.subscribe(renderAll);
    Timer.subscribe(UI.renderTimer);
    Timer.onFinish(handleFinish);

    watchDayChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
