/* ============================================================
   番茄钟状态机
   用时间戳差值计时，切到后台或系统休眠后恢复依然准确
   ============================================================ */
(function (global) {
  'use strict';

  var S = {
    mode: 'idle', // idle | focus | short | long
    running: false,
    paused: false,
    minutes: 25,
    totalMs: 0,
    remainingMs: 0,
    endAt: 0,
    startedAt: 0,
    label: '',
    coffeeId: null
  };

  var ticker = null;
  var listeners = [];
  var finishListeners = [];

  function snapshot() {
    return {
      mode: S.mode,
      running: S.running,
      paused: S.paused,
      minutes: S.minutes,
      totalMs: S.totalMs,
      remainingMs: S.remainingMs,
      label: S.label,
      coffeeId: S.coffeeId,
      startedAt: S.startedAt
    };
  }

  function emit() {
    var snap = snapshot();
    listeners.forEach(function (fn) {
      try {
        fn(snap);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      if (!S.running || S.paused) return;

      var remaining = Math.max(0, S.endAt - Date.now());
      if (remaining <= 0) {
        S.remainingMs = 0;
        finish();
        return;
      }

      S.remainingMs = remaining;
      emit();
    }, 250);
  }

  function stopTicker() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function reset() {
    S.mode = 'idle';
    S.running = false;
    S.paused = false;
    S.totalMs = 0;
    S.remainingMs = 0;
    S.endAt = 0;
    S.startedAt = 0;
    S.label = '';
    S.coffeeId = null;
  }

  function finish() {
    var done = {
      mode: S.mode,
      minutes: S.minutes,
      label: S.label,
      coffeeId: S.coffeeId,
      startedAt: S.startedAt,
      endedAt: Date.now()
    };

    stopTicker();
    reset();
    emit();

    finishListeners.forEach(function (fn) {
      try {
        fn(done);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function start(kind, minutes, options) {
    if (S.mode !== 'idle') return false;

    options = options || {};
    var mins = Math.max(1, Math.round(Number(minutes) || 25));

    S.mode = kind;
    S.minutes = mins;
    S.totalMs = mins * 60000;
    S.remainingMs = S.totalMs;
    S.startedAt = Date.now();
    S.endAt = S.startedAt + S.totalMs;
    S.running = true;
    S.paused = false;
    S.label = String(options.label || '').slice(0, 16);
    S.coffeeId = options.coffeeId || null;

    startTicker();
    emit();
    return true;
  }

  function pause() {
    if (!S.running || S.paused) return;
    S.remainingMs = Math.max(0, S.endAt - Date.now());
    S.paused = true;
    S.running = false;
    stopTicker();
    emit();
  }

  function resume() {
    if (S.mode === 'idle' || !S.paused) return;
    S.endAt = Date.now() + S.remainingMs;
    S.paused = false;
    S.running = true;
    startTicker();
    emit();
  }

  /* 放弃当前一轮（专注或休息），回到 idle；返回放弃前的快照 */
  function cancel() {
    if (S.mode === 'idle') return null;
    var cancelled = snapshot();
    stopTicker();
    reset();
    emit();
    return cancelled;
  }

  function subscribe(fn) {
    listeners.push(fn);
  }

  function onFinish(fn) {
    finishListeners.push(fn);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (S.running && !S.paused) {
        S.remainingMs = Math.max(0, S.endAt - Date.now());
        if (S.remainingMs <= 0) finish();
        else emit();
      }
    });
  }

  global.Timer = {
    start: start,
    pause: pause,
    resume: resume,
    cancel: cancel,
    getState: snapshot,
    subscribe: subscribe,
    onFinish: onFinish
  };
})(window);
