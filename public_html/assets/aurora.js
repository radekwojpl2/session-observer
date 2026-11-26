'use strict';
/*
 * Aurora background for the Session Observer landing page.
 * Soft colour fields drift slowly behind the page. Colours follow the page's light or dark theme.
 * Shows a still frame when the visitor prefers reduced motion; pauses while the tab is hidden.
 */
(function () {
  var SPEED = 0.3;   // fraction of the design speed: one loop takes about 1.5 to 3 minutes
  var DARK = { base: '230,231,234', ink: 0.55, alpha: 0.123, blend: 'lighter',
    colors: ['34,211,238', '167,139,250', '251,191,36', '251,146,60', '52,211,153'] };
  var LIGHT = { base: '40,40,48', ink: 0.77, alpha: 0.14, blend: 'source-over',
    colors: ['8,145,178', '124,58,237', '202,138,4', '234,88,12', '22,163,74'] };

  var reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, pal = null, blobs = [], t = 0, last = 0, raf = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function isDarkPage() {
    var m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
    if (!m) return true;
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.5;
  }

  function seed() {
    blobs = [];
    for (var i = 0; i < 5; i++) {
      blobs.push({ c: pal.colors[i], ax: rand(0.3, 0.45), ay: rand(0.25, 0.4),
        fx: rand(0.12, 0.28), fy: rand(0.12, 0.28), p: rand(0, 6.28), r: rand(0.35, 0.55) });
    }
    t = rand(0, 100);
  }

  function draw() {
    var m = Math.max(W, H);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = pal.blend;
    blobs.forEach(function (b) {
      var x = W * (0.5 + b.ax * Math.sin(t * b.fx + b.p));
      var y = H * (0.5 + b.ay * Math.cos(t * b.fy * 1.3 + b.p));
      var g = ctx.createRadialGradient(x, y, 0, x, y, m * b.r);
      g.addColorStop(0, 'rgba(' + b.c + ',' + pal.alpha + ')');
      g.addColorStop(1, 'rgba(' + b.c + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'source-over';
    // faint scan lines give it texture
    ctx.fillStyle = 'rgba(' + pal.base + ',' + (0.018 * pal.ink).toFixed(4) + ')';
    for (var y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }

  function loop(ts) {
    t += Math.min(0.05, (ts - last) / 1000 || 0.016) * SPEED;
    last = ts;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    cancelAnimationFrame(raf);
    draw();
    if (reduced.matches) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function boot() {
    document.body.insertBefore(canvas, document.body.firstChild);
    pal = isDarkPage() ? DARK : LIGHT;
    seed();
    resize();
    start();
    var timer = 0;
    addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(resize, 150); });
    // follow the page's theme toggle
    setInterval(function () {
      var next = isDarkPage() ? DARK : LIGHT;
      if (next !== pal) { pal = next; seed(); start(); }
    }, 600);
    if (reduced.addEventListener) reduced.addEventListener('change', start);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
