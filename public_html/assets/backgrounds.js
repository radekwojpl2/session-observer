'use strict';
/*
 * Animated page backgrounds for the Session Observer landing pages.
 * Usage: <script src="bg/backgrounds.js" data-bg="transit" defer></script>
 * Variants: transit, constellation, grid, events, aurora, off.
 * Pick one with the switcher (bottom left), the "b" key, or ?bg=<name> in the URL.
 */
(function () {
  var script = document.currentScript;
  var NAMES = ['transit', 'constellation', 'grid', 'events', 'aurora', 'off'];
  var LABELS = { transit: 'Transit lines', constellation: 'Constellation', grid: 'Context grid', events: 'Event rain', aurora: 'Aurora', off: 'Off' };
  var storeKey = 'so-bg:' + location.pathname.split('/').pop();
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var SPEED = 0.3;   // everything moves at 30% of its design speed
  var SOFT = 0.55;   // and at 55% of its design opacity

  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
  var ctx = canvas.getContext('2d');
  var pageBg = 'rgb(0,0,0)', W = 0, H = 0, DPR = 1, raf = 0, last = 0, current = null, dark = true, pal = null;
  var pointer = { x: -1e4, y: -1e4, moved: 0 };

  // ---------- palette ----------
  function luminance(rgb) {
    var m = rgb.match(/[\d.]+/g);
    if (!m) return 0;
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
  }
  function readTheme() {
    var bg = getComputedStyle(document.body).backgroundColor;
    var isDark = luminance(bg) < 0.5;
    pageBg = bg;
    if (pal && isDark === dark) return false;
    dark = isDark;
    // a light page needs more ink for the same thin marks
    pal = dark
      ? { base: '230,231,234', alpha: SOFT, colors: ['34,211,238', '167,139,250', '251,191,36', '251,146,60', '52,211,153', '96,165,250'] }
      : { base: '40,40,48', alpha: SOFT * 1.4, colors: ['8,145,178', '124,58,237', '202,138,4', '234,88,12', '22,163,74', '37,99,235'] };
    return true;
  }
  function rgba(c, a) { return 'rgba(' + c + ',' + (a * pal.alpha).toFixed(3) + ')'; }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------- variants ----------
  var variants = {};

  // Transit: route-map lines with stations; pulses travel along them, like turns through tools.
  variants.transit = {
    init: function () {
      var lanes = [], n = Math.max(5, Math.round(H / 110));
      for (var i = 0; i < n; i++) {
        var y = (i + 0.5) * (H / n) + rand(-20, 20), x = -60, pts = [[x, y]], c = pick(pal.colors);
        while (x < W + 60) {
          var run = rand(120, 320);
          x += run; pts.push([x, y]);
          if (Math.random() < 0.55) {
            var dy = pick([-1, 1]) * rand(30, 70);
            if (y + dy < 20 || y + dy > H - 20) dy = -dy;
            x += Math.abs(dy); y += dy; pts.push([x, y]);
          }
        }
        var segs = [], len = 0;
        for (var j = 1; j < pts.length; j++) {
          var l = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
          segs.push(l); len += l;
        }
        var stations = [];
        for (var d = rand(60, 160); d < len; d += rand(110, 260)) stations.push(d);
        lanes.push({ pts: pts, segs: segs, len: len, color: c, stations: stations, pulses: [] });
      }
      this.lanes = lanes;
    },
    at: function (lane, d) {
      var p = lane.pts;
      for (var i = 0; i < lane.segs.length; i++) {
        if (d <= lane.segs[i]) {
          var t = d / lane.segs[i];
          return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t];
        }
        d -= lane.segs[i];
      }
      return p[p.length - 1];
    },
    frame: function (dt) {
      var self = this;
      ctx.lineWidth = 2; ctx.lineJoin = 'round';
      this.lanes.forEach(function (lane) {
        ctx.strokeStyle = rgba(lane.color, dark ? 0.12 : 0.16);
        ctx.beginPath();
        lane.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.stroke();
        lane.stations.forEach(function (d) {
          var p = self.at(lane, d), lit = 0;
          lane.pulses.forEach(function (pu) { var k = 1 - Math.abs(pu.d - d) / 60; if (k > lit) lit = k; });
          ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 6.283);
          ctx.fillStyle = pageBg;
          ctx.fill();
          ctx.strokeStyle = rgba(lane.color, 0.22 + lit * 0.25); ctx.lineWidth = 1.6; ctx.stroke(); ctx.lineWidth = 2;
        });
        if (Math.random() < dt * 0.25 && lane.pulses.length < 2) lane.pulses.push({ d: 0, v: rand(90, 190) });
        lane.pulses = lane.pulses.filter(function (pu) {
          pu.d += pu.v * dt;
          if (pu.d > lane.len) return false;
          for (var k = 0; k < 10; k++) {
            var q = self.at(lane, Math.max(0, pu.d - k * 7));
            ctx.beginPath(); ctx.arc(q[0], q[1], 2.6 - k * 0.2, 0, 6.283);
            ctx.fillStyle = rgba(lane.color, 0.45 * (1 - k / 10)); ctx.fill();
          }
          return true;
        });
      });
    }
  };

  // Constellation: drifting nodes linked when close; nodes near the pointer brighten. Random "events" ripple out.
  variants.constellation = {
    init: function () {
      var n = Math.min(140, Math.round(W * H / 14000));
      this.nodes = [];
      for (var i = 0; i < n; i++) this.nodes.push({ x: rand(0, W), y: rand(0, H), vx: rand(-12, 12), vy: rand(-12, 12), c: pick(pal.colors), r: rand(1.2, 2.4), flash: 0 });
      this.rings = [];
    },
    frame: function (dt) {
      var nodes = this.nodes, R = 130;
      nodes.forEach(function (p) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20;
        if (p.y < -20) p.y = H + 20; if (p.y > H + 20) p.y = -20;
        p.flash = Math.max(0, p.flash - dt * 0.8);
      });
      if (Math.random() < dt * 0.4) {
        var f = pick(nodes); f.flash = 1;
        this.rings.push({ x: f.x, y: f.y, r: 0, c: f.c });
      }
      ctx.lineWidth = 1;
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < R * R) {
            var k = 1 - Math.sqrt(d2) / R, boost = Math.max(a.flash, b.flash);
            ctx.strokeStyle = boost > 0.05 ? rgba(a.c, k * (0.1 + boost * 0.2)) : rgba(pal.base, k * 0.16);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      nodes.forEach(function (p) {
        var near = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + p.flash * 2 + near * 1.5, 0, 6.283);
        ctx.fillStyle = rgba(p.c, 0.5 + p.flash * 0.3); ctx.fill();
      });
      this.rings = this.rings.filter(function (g) {
        g.r += dt * 70;
        var a = 1 - g.r / 90;
        if (a <= 0) return false;
        ctx.strokeStyle = rgba(g.c, a * 0.15); ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 6.283); ctx.stroke();
        return true;
      });
    }
  };

  // Context grid: a dot grid like the context-window view; ripples light cells, the pointer leaves a wake.
  variants.grid = {
    init: function () {
      this.gap = 26; this.cols = Math.ceil(W / this.gap) + 1; this.rows = Math.ceil(H / this.gap) + 1;
      this.tint = [];
      for (var i = 0; i < this.cols * this.rows; i++) this.tint.push(Math.random() < 0.06 ? pick(pal.colors) : null);
      this.waves = []; this.t = 0;
    },
    frame: function (dt) {
      this.t += dt;
      if (Math.random() < dt * 0.3) this.waves.push({ x: rand(0, W), y: rand(0, H), r: 0, c: pick(pal.colors) });
      if (false) { pointer.moved = 0; if (this.waves.length < 14) this.waves.push({ x: pointer.x, y: pointer.y, r: 0, c: pal.colors[0], small: true }); }
      this.waves = this.waves.filter(function (w) { w.r += dt * (w.small ? 140 : 110); return w.r < (w.small ? 160 : 520); });
      var g = this.gap, waves = this.waves, t = this.t;
      for (var cx = 0; cx < this.cols; cx++) {
        for (var cy = 0; cy < this.rows; cy++) {
          var x = cx * g, y = cy * g, lit = 0, col = null;
          for (var k = 0; k < waves.length; k++) {
            var w = waves[k], d = Math.abs(Math.hypot(x - w.x, y - w.y) - w.r);
            if (d < 26) {
              var e = (1 - d / 26) * (1 - w.r / (w.small ? 160 : 520));
              if (e > lit) { lit = e; col = w.c; }
            }
          }
          var tint = this.tint[cx * this.rows + cy];
          var breathe = tint ? 0.18 + 0.12 * Math.sin(t * 0.8 + cx * 0.4 + cy * 0.3) : 0;
          if (lit > 0.02) {
            ctx.fillStyle = rgba(col, 0.1 + lit * 0.35);
            ctx.fillRect(x - 2, y - 2, 4, 4);
          } else if (tint) {
            ctx.fillStyle = rgba(tint, breathe); ctx.fillRect(x - 2, y - 2, 4, 4);
          } else {
            ctx.fillStyle = rgba(pal.base, 0.07); ctx.fillRect(x - 1, y - 1, 2, 2);
          }
        }
      }
    }
  };

  // Event rain: sparse columns of hook event names drifting down, like a live log.
  variants.events = {
    words: ['Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write', 'Model', 'Skill', 'MCP', 'Task', 'Prompt', 'Agent', 'Stop', 'Notify', 'Compact', '✓', '×', '42ms', '5.3s', '1.2k tok'],
    init: function () {
      this.cols = []; var step = 120;
      for (var x = rand(10, 60); x < W; x += step + rand(-30, 30)) {
        this.cols.push({ x: x, y: rand(-H, 0), v: rand(22, 55), items: this.makeItems(), c: pick(pal.colors) });
      }
    },
    makeItems: function () {
      var a = [], n = 6 + ((Math.random() * 8) | 0);
      for (var i = 0; i < n; i++) a.push(pick(this.words));
      return a;
    },
    frame: function (dt) {
      var self = this;
      ctx.font = '12px "JetBrains Mono", "IBM Plex Mono", "Geist Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      this.cols.forEach(function (c) {
        c.y += c.v * dt;
        var lh = 22;
        if (c.y - c.items.length * lh > H) { c.y = rand(-200, -40); c.items = self.makeItems(); c.c = pick(pal.colors); c.v = rand(22, 55); }
        c.items.forEach(function (w, i) {
          var y = c.y - i * lh, head = i === 0;
          if (y < -20 || y > H + 20) return;
          var fade = 1 - i / c.items.length;
          var err = w === '×';
          ctx.fillStyle = head ? rgba(c.c, 0.35) : err ? rgba('248,113,113', 0.2 * fade) : rgba(pal.base, 0.16 * fade);
          ctx.fillText(w, c.x, y);
        });
      });
    }
  };

  // Aurora: slow, soft colour fields drifting on Lissajous paths.
  variants.aurora = {
    init: function () {
      this.blobs = [];
      for (var i = 0; i < 5; i++) this.blobs.push({ c: pal.colors[i % pal.colors.length], ax: rand(0.3, 0.45), ay: rand(0.25, 0.4), fx: rand(0.12, 0.28), fy: rand(0.12, 0.28), p: rand(0, 6.28), r: rand(0.35, 0.55) });
      this.t = rand(0, 100);
    },
    frame: function (dt) {
      this.t += dt;
      var t = this.t, m = Math.max(W, H);
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      this.blobs.forEach(function (b) {
        var x = W * (0.5 + b.ax * Math.sin(t * b.fx + b.p)), y = H * (0.5 + b.ay * Math.cos(t * b.fy * 1.3 + b.p));
        var r = m * b.r, g = ctx.createRadialGradient(x, y, 0, x, y, r);
        var a = dark ? 0.16 * SOFT * 1.4 : 0.14;
        g.addColorStop(0, dark ? 'rgba(' + b.c + ',' + a + ')' : 'rgba(' + b.c + ',' + a + ')');
        g.addColorStop(1, 'rgba(' + b.c + ',0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      });
      ctx.globalCompositeOperation = 'source-over';
      // faint scan lines give it texture
      ctx.fillStyle = rgba(pal.base, 0.018);
      for (var y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    }
  };

  variants.off = { init: function () {}, frame: function () {} };

  // ---------- loop ----------
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (current) variants[current].init();
    drawOnce();
  }
  function drawOnce() {
    ctx.clearRect(0, 0, W, H);
    if (current) variants[current].frame(reduced.matches ? 0 : 0.016);
  }
  function loop(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    ctx.clearRect(0, 0, W, H);
    variants[current].frame(dt * SPEED);
    raf = requestAnimationFrame(loop);
  }
  function start(name) {
    if (NAMES.indexOf(name) < 0) name = 'transit';
    cancelAnimationFrame(raf);
    current = name;
    canvas.style.display = name === 'off' ? 'none' : 'block';
    readTheme();
    variants[name].init();
    if (select) select.value = name;
    if (name === 'off') return;
    if (reduced.matches) {
      // a still frame: run the simulation forward a little so it isn't empty
      for (var i = 0; i < 120; i++) { ctx.clearRect(0, 0, W, H); variants[name].frame(0.03); }
      return;
    }
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function save(name) { try { localStorage.setItem(storeKey, name); } catch (err) { /* storage unavailable */ } }
  function saved() { try { return localStorage.getItem(storeKey); } catch (err) { return null; } }

  // ---------- switcher ----------
  var select = null;
  function buildSwitcher() {
    var box = document.createElement('label');
    box.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:60;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;' +
      'border-radius:999px;font:500 12px/1 system-ui,sans-serif;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer;';
    var txt = document.createElement('span'); txt.textContent = 'Background';
    select = document.createElement('select');
    select.setAttribute('aria-label', 'Background animation');
    select.style.cssText = 'font:inherit;border:0;background:transparent;color:inherit;cursor:pointer;outline-offset:2px;';
    NAMES.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = LABELS[n]; select.appendChild(o); });
    select.addEventListener('change', function () { save(select.value); start(select.value); });
    box.appendChild(txt); box.appendChild(select);
    document.body.appendChild(box);
    function paint() {
      box.style.background = dark ? 'rgba(20,22,26,.72)' : 'rgba(255,255,255,.8)';
      box.style.color = dark ? '#d4d4d8' : '#3f3f46';
      box.style.border = '1px solid ' + (dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.1)');
      Array.prototype.forEach.call(select.options, function (o) { o.style.background = dark ? '#16181c' : '#fff'; o.style.color = dark ? '#e4e4e7' : '#18181b'; });
    }
    paint();
    return paint;
  }

  function boot() {
    document.body.insertBefore(canvas, document.body.firstChild);
    readTheme();
    var paintSwitcher = buildSwitcher();
    var fromUrl = new URLSearchParams(location.search).get('bg');
    resize();
    start(fromUrl || saved() || (script && script.dataset.bg) || 'transit');
    addEventListener('resize', function () { clearTimeout(resize.t); resize.t = setTimeout(resize, 150); });
    addEventListener('pointermove', function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved++; }, { passive: true });
    addEventListener('keydown', function (e) {
      if (e.key !== 'b' || e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input,textarea,select'))) return;
      var next = NAMES[(NAMES.indexOf(current) + 1) % NAMES.length];
      save(next); start(next);
    });
    // follow theme toggles on pages that have them
    setInterval(function () { if (readTheme()) { paintSwitcher(); start(current); } }, 600);
    if (reduced.addEventListener) reduced.addEventListener('change', function () { start(current); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
