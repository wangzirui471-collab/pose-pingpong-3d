/* 体感乒乓 · 感知台原始帧解析
 *
 * 输入来自红外感知台 outputs/local_<pid>/latest_keypoints.json：
 *   {stale, people:[{id, pose33|pose17, range33|range17}], hands21:[...]}
 *
 * 关键坑（已在 FPS 项目踩过，这里一次性避开）：
 *  - 33 点的置信度在第 4 位 a[3]，第 3 位是 z；17 点第 3 位才是置信度
 *  - hands21 的 points 是 21x[x,y,score]，第 3 位是**置信度不是深度**
 *  - 深度只存在 range17 / range33 里，元素可能是 dict{valid,meters,raw_value}
 *  - 只认深度最近的人，且用"最近参考"门限挡住后面的人
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var K = NS.constants;

  function rangeValue(item) {
    if (item === null || item === undefined) return null;
    if (typeof item === 'number') return item;
    if (typeof item === 'object') {
      if (item.valid === false) return null;
      if (item.meters !== undefined && item.meters !== null) return Number(item.meters);
      if (item.raw_value !== undefined && item.raw_value !== null) return Number(item.raw_value);
    }
    return null;
  }

  function median(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)];
  }

  function personDepth(person) {
    var ranges = person.range33 || person.range17 || person.range || [];
    var vals = [];
    for (var i = 0; i < ranges.length; i++) {
      var v = rangeValue(ranges[i]);
      if (v !== null && isFinite(v)) vals.push(v);
    }
    return median(vals);
  }

  function to17(person, mirror) {
    var p17 = person.pose17 || person.keypoints;
    var arr, idx, confAt;
    if (Array.isArray(p17) && p17.length >= 17 && p17.length < 33) {
      arr = p17; idx = null; confAt = 2;
    } else {
      arr = person.pose33 || p17;
      if (!Array.isArray(arr) || arr.length < 33) return null;
      idx = K.MAP33_TO17; confAt = 3;
    }
    var out = [];
    var n = idx ? idx.length : 17;
    for (var i = 0; i < n; i++) {
      var a = arr[idx ? idx[i] : i];
      if (!a) return null;
      var x = Number(a[0]), y = Number(a[1]);
      var c = a.length > confAt ? Number(a[confAt]) : 1.0;
      if (mirror) x = 1 - x;
      out.push([x, y, isFinite(c) ? c : 1.0]);
    }
    return out;
  }

  function toRanges(person, use33) {
    var r = (use33 ? person.range33 : person.range17) || person.range || [];
    var out = [];
    var map = use33 ? K.MAP33_TO17 : null;
    for (var i = 0; i < 17; i++) {
      var src = map ? map[i] : i;
      out.push(src < r.length ? rangeValue(r[src]) : null);
    }
    return out;
  }

  var nearRef = null, nearTs = 0;

  function pickNearest(people, now, opts) {
    opts = opts || {};
    var maxRatio = opts.maxRatio || 1.6;
    var ttl = opts.refTtl || 3.0;
    var best = null, bestD = null;
    for (var i = 0; i < people.length; i++) {
      var d = personDepth(people[i]);
      if (d === null) continue;
      if (bestD === null || d < bestD) { best = people[i]; bestD = d; }
    }
    if (bestD === null) return null;
    if (nearRef === null || now - nearTs > ttl) { nearRef = bestD; nearTs = now; }
    if (bestD > nearRef * maxRatio) return null;   // 只剩后面的人，保持上一帧
    if (bestD < nearRef) { nearRef = bestD; nearTs = now; }
    return best;
  }

  /* 解析成一帧统一的内部结构 */
  function parseFrame(raw, opts) {
    opts = opts || {};
    var now = opts.now || (Date.now() / 1000);
    if (!raw || raw.stale) return { ok: false, reason: 'stale', t: now };
    var people = raw.people || [];
    if (!people.length) return { ok: false, reason: 'no_people', t: now };

    var target = opts.personId !== undefined && opts.personId !== null
      ? people.filter(function (p) { return p.id === opts.personId; })[0]
      : pickNearest(people, now, opts);
    if (!target) return { ok: false, reason: 'no_target', t: now };

    var use33 = Array.isArray(target.pose33) && target.pose33.length >= 33;
    var pose = to17(target, !!(opts.mirror || opts.flipX));
    if (!pose) return { ok: false, reason: 'bad_pose', t: now };
    var ranges = toRanges(target, use33);

    var hands = {};
    var hs = raw.hands21 || [];
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (!h || !h.points || h.points.length < 21) continue;
      if (h.person_id !== undefined && h.person_id !== null && target.id !== undefined
          && h.person_id !== target.id) continue;
      var part = h.part;
      if (part !== 'left' && part !== 'right') continue;
      if (opts.mirror) part = part === 'left' ? 'right' : 'left';
      if (hands[part]) continue;
      var valid = Array.isArray(h.valid_indices)
        ? h.valid_indices.filter(function (x) { return Number.isInteger(x) && x >= 0 && x < 21; })
        : [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].slice();
      var pts = [];
      for (var j = 0; j < 21; j++) {
        var q = h.points[j] || [0, 0, 0];
        pts.push([Number(q[0]), Number(q[1]), q.length > 2 ? Number(q[2]) : 1]);
      }
      if (opts.mirror || opts.flipX) for (var m = 0; m < 21; m++) pts[m][0] = 1 - pts[m][0];
      hands[part] = {
        part: part, points: pts, valid: valid,
        state: h.state || 'observed',
        ageMs: h.age_ms || 0,
        quality: (h.state === 'observed') ? 1.0 : 0.6
      };
    }

    return {
      ok: true, t: now, reason: '',
      personId: target.id,
      depth: personDepth(target),
      pose17: pose,
      ranges: ranges,
      hands: hands,
      mirror: !!opts.mirror
    };
  }

  NS.frame = {
    parseFrame: parseFrame,
    to17: to17,
    toRanges: toRanges,
    personDepth: personDepth,
    pickNearest: pickNearest,
    rangeValue: rangeValue,
    resetNearest: function () { nearRef = null; nearTs = 0; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.frame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
