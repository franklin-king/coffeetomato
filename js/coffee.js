/* ============================================================
   咖啡因模型：饮品预设、含量估算、残留推算
   ============================================================ */
(function (global) {
  'use strict';

  var HALF_LIFE_HOURS = 5;

  var TYPES = [
    { key: 'americano', name: '美式', ml: 240, mg: 95, color: '#6f4e37' },
    { key: 'latte', name: '拿铁', ml: 240, mg: 63, color: '#c9a37a' },
    { key: 'espresso', name: '浓缩', ml: 30, mg: 63, color: '#4a2c1a' },
    { key: 'pourover', name: '手冲', ml: 240, mg: 95, color: '#b06b35' },
    { key: 'cappuccino', name: '卡布奇诺', ml: 180, mg: 63, color: '#d9b48f' },
    { key: 'instant', name: '速溶', ml: 200, mg: 60, color: '#8b7355' },
    { key: 'coldbrew', name: '冷萃', ml: 300, mg: 150, color: '#7a5c3e' },
    { key: 'decaf', name: '低因', ml: 240, mg: 10, color: '#9aa08c' },
    { key: 'custom', name: '自定义', ml: 240, mg: 60, color: '#c68a4e' }
  ];

  var QUICK_KEYS = ['americano', 'latte', 'espresso', 'pourover'];

  var map = {};
  TYPES.forEach(function (t) {
    map[t.key] = t;
  });

  function getType(key) {
    return map[key] || map.custom;
  }

  function getQuickTypes() {
    return QUICK_KEYS.map(function (key) {
      return map[key];
    });
  }

  /* 按容量线性换算咖啡因，结果取整 */
  function estimateMg(key, ml) {
    var base = getType(key);
    var volume = Number(ml);
    if (!volume || volume <= 0) return base.mg;
    return Math.round((base.mg * volume) / base.ml);
  }

  function totalMg(coffees) {
    return (coffees || []).reduce(function (sum, c) {
      return sum + (Number(c.mg) || 0);
    }, 0);
  }

  /* 体内残留估算：mg * 0.5^(经过小时 / 半衰期) */
  function remainingMg(coffees, atTs) {
    var now = atTs || Date.now();
    return (coffees || []).reduce(function (sum, c) {
      var hours = Math.max(0, (now - c.ts) / 3600000);
      return sum + (Number(c.mg) || 0) * Math.pow(0.5, hours / HALF_LIFE_HOURS);
    }, 0);
  }

  global.Coffee = {
    TYPES: TYPES,
    HALF_LIFE_HOURS: HALF_LIFE_HOURS,
    getType: getType,
    getQuickTypes: getQuickTypes,
    estimateMg: estimateMg,
    totalMg: totalMg,
    remainingMg: remainingMg
  };
})(window);
