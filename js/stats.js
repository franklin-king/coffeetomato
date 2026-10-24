/* ============================================================
   统计图表：近 7 天柱状图、今日累积曲线、历史列表
   纯手写 SVG，不依赖第三方图表库
   ============================================================ */
(function (global) {
  'use strict';

  var WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function r1(n) {
    return Math.round(n * 10) / 10;
  }

  function niceMax(value, fallback) {
    if (!value || value <= 0) return fallback;
    var mag = Math.pow(10, Math.floor(Math.log10(value)));
    var n = value / mag;
    var step;
    if (n <= 1) step = 1;
    else if (n <= 2) step = 2;
    else if (n <= 2.5) step = 2.5;
    else if (n <= 5) step = 5;
    else step = 10;
    return step * mag;
  }

  /* 近 7 天按日聚合 */
  function aggregateDays() {
    var state = Store.getState();
    var todayStart = Store.startOfDay(Date.now());
    var days = [];

    for (var i = 6; i >= 0; i--) {
      var start = todayStart - i * 86400000;
      var end = start + 86400000;

      var coffees = state.coffees.filter(function (c) {
        return c.ts >= start && c.ts < end;
      });

      var sessions = state.sessions.filter(function (s) {
        return s.kind === 'focus' && s.completed && s.endTs >= start && s.endTs < end;
      });

      days.push({
        start: start,
        label: i === 0 ? '今天' : WEEKDAY[new Date(start).getDay()],
        caffeine: Coffee.totalMg(coffees),
        focusMin: sessions.reduce(function (sum, s) {
          return sum + (Number(s.actualMin) || 0);
        }, 0),
        isToday: i === 0
      });
    }

    return days;
  }

  /* ---------- 近 7 天柱状图 ---------- */

  function renderWeekChart(metric) {
    var days = aggregateDays();
    var isFocus = metric === 'focus';
    var values = days.map(function (d) {
      return isFocus ? d.focusMin : d.caffeine;
    });
    var max = niceMax(Math.max.apply(null, values), isFocus ? 60 : 200);

    var W = 640;
    var H = 220;
    var padL = 46;
    var padR = 12;
    var padT = 18;
    var padB = 32;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var slot = plotW / 7;
    var barW = Math.min(26, slot * 0.44);

    var out = [];
    out.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="近 7 天' + (isFocus ? '专注分钟' : '咖啡因') + '">');

    /* 横向网格 + 刻度 */
    for (var g = 0; g <= 4; g++) {
      var y = padT + (plotH * g) / 4;
      var val = Math.round(max - (max * g) / 4);
      out.push('<line class="grid" x1="' + padL + '" y1="' + r1(y) + '" x2="' + (W - padR) + '" y2="' + r1(y) + '"/>');
      out.push('<text x="' + (padL - 8) + '" y="' + r1(y + 4) + '" text-anchor="end">' + val + '</text>');
    }

    /* 柱子 */
    days.forEach(function (d, idx) {
      var v = isFocus ? d.focusMin : d.caffeine;
      var cx = padL + slot * idx + slot / 2;
      var h = max > 0 ? (plotH * v) / max : 0;
      var y = padT + plotH - h;

      var cls = isFocus ? 'bar bar-focus' : 'bar';
      if (d.isToday) cls += ' is-today';

      /* 零值也给一条浅浅的底线，避免空荡 */
      if (v <= 0) {
        out.push(
          '<rect x="' + r1(cx - barW / 2) + '" y="' + r1(padT + plotH - 2) + '" width="' + r1(barW) +
            '" height="2" rx="1" fill="var(--line-strong)"/>'
        );
      } else {
        out.push(
          '<rect class="' + cls + '" x="' + r1(cx - barW / 2) + '" y="' + r1(y) + '" width="' + r1(barW) +
            '" height="' + r1(Math.max(3, h)) + '" rx="5"><title>' + esc(d.label) + '：' + v +
            (isFocus ? ' 分钟' : ' mg') + '</title></rect>'
        );
        out.push(
          '<text x="' + r1(cx) + '" y="' + r1(y - 7) + '" text-anchor="middle">' + v + '</text>'
        );
      }

      out.push(
        '<text x="' + r1(cx) + '" y="' + (H - 9) + '" text-anchor="middle"' +
          (d.isToday ? ' style="fill:var(--text)"' : '') + '>' + esc(d.label) + '</text>'
      );
    });

    out.push('</svg>');
    return out.join('');
  }

  /* ---------- 今日累积曲线 ---------- */

  function renderTodayChart() {
    var coffees = Store.getTodayCoffees();
    var total = Coffee.totalMg(coffees);

    var W = 640;
    var H = 200;
    var padL = 46;
    var padR = 14;
    var padT = 16;
    var padB = 30;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var max = niceMax(total * 1.15, 200);

    function xAt(hour) {
      return padL + (plotW * Math.min(24, Math.max(0, hour))) / 24;
    }

    function yAt(value) {
      return padT + plotH - (plotH * Math.min(max, Math.max(0, value))) / max;
    }

    var out = [];
    out.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="今日咖啡因累积曲线">');

    for (var g = 0; g <= 4; g++) {
      var y = padT + (plotH * g) / 4;
      var val = Math.round(max - (max * g) / 4);
      out.push('<line class="grid" x1="' + padL + '" y1="' + r1(y) + '" x2="' + (W - padR) + '" y2="' + r1(y) + '"/>');
      out.push('<text x="' + (padL - 8) + '" y="' + r1(y + 4) + '" text-anchor="end">' + val + '</text>');
    }

    [0, 6, 12, 18, 24].forEach(function (h) {
      out.push('<text x="' + r1(xAt(h)) + '" y="' + (H - 9) + '" text-anchor="middle">' + h + ':00</text>');
    });

    if (!coffees.length) {
      out.push(
        '<text x="' + r1(padL + plotW / 2) + '" y="' + r1(padT + plotH / 2 + 4) +
          '" text-anchor="middle" style="fill:var(--muted)">今天还没有咖啡</text>'
      );
      out.push('</svg>');
      return out.join('');
    }

    var now = new Date();
    var nowHour = now.getHours() + now.getMinutes() / 60;
    var acc = 0;
    var d = 'M ' + r1(xAt(0)) + ' ' + r1(yAt(0));

    coffees.forEach(function (c) {
      var date = new Date(c.ts);
      var hour = date.getHours() + date.getMinutes() / 60;
      d += ' H ' + r1(xAt(hour));
      acc += Number(c.mg) || 0;
      d += ' V ' + r1(yAt(acc));
    });

    d += ' H ' + r1(xAt(nowHour));

    var area = d + ' V ' + r1(yAt(0)) + ' H ' + r1(xAt(0)) + ' Z';

    out.push('<path class="area" d="' + area + '"/>');
    out.push('<path class="line" d="' + d + '"/>');

    var running = 0;
    coffees.forEach(function (c) {
      var date = new Date(c.ts);
      var hour = date.getHours() + date.getMinutes() / 60;
      running += Number(c.mg) || 0;
      out.push(
        '<circle cx="' + r1(xAt(hour)) + '" cy="' + r1(yAt(running)) + '" r="3.5" fill="var(--surface)" stroke="var(--caramel)" stroke-width="2"><title>' +
          esc(c.name) + ' ' + running + 'mg</title></circle>'
      );
    });

    out.push('</svg>');
    return out.join('');
  }

  /* ---------- 历史列表 ---------- */

  function renderHistory() {
    var state = Store.getState();
    var groups = {};

    function bucket(ts) {
      var key = Store.dayKey(ts);
      if (!groups[key]) {
        groups[key] = { ts: Store.startOfDay(ts), key: key, coffees: [], rounds: 0, focusMin: 0 };
      }
      return groups[key];
    }

    state.coffees.forEach(function (c) {
      bucket(c.ts).coffees.push(c);
    });

    state.sessions.forEach(function (s) {
      if (s.kind !== 'focus' || !s.completed) return;
      var g = bucket(s.endTs);
      g.rounds += 1;
      g.focusMin += Number(s.actualMin) || 0;
    });

    var keys = Object.keys(groups).sort(function (a, b) {
      return groups[b].ts - groups[a].ts;
    });

    if (!keys.length) {
      return '<p class="card-desc">还没有记录，先从今天的一杯咖啡开始。</p>';
    }

    return keys
      .slice(0, 30)
      .map(function (key) {
        var g = groups[key];
        var mg = Coffee.totalMg(g.coffees);
        var items = g.coffees
          .slice()
          .sort(function (a, b) {
            return b.ts - a.ts;
          })
          .map(function (c) {
            return (
              '<div class="history-item"><span>' + esc(c.name) + ' · ' + Store.formatTime(c.ts) +
              '</span><span class="h-mg">' + (Number(c.mg) || 0) + ' mg</span></div>'
            );
          })
          .join('');

        return (
          '<div class="history-day">' +
          '<div class="history-head"><span>' + Store.formatDateLabel(g.ts) + '</span>' +
          '<span class="h-meta">' + g.coffees.length + ' 杯 · ' + mg + 'mg · ' + g.rounds + ' 轮 · ' + g.focusMin + ' 分钟</span></div>' +
          (items || '<div class="history-item"><span>无咖啡记录</span></div>') +
          '</div>'
        );
      })
      .join('');
  }

  global.Stats = {
    aggregateDays: aggregateDays,
    renderWeekChart: renderWeekChart,
    renderTodayChart: renderTodayChart,
    renderHistory: renderHistory
  };
})(window);
