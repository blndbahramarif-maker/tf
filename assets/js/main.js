/* HAVEN Real Estate — interactions */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------- intro ---------- */
  (function intro() {
    var el = $('#intro');
    if (!el) return;
    var hide = function () {
      el.classList.add('is-gone');
      document.body.classList.remove('is-locked');
      window.setTimeout(function () { el.remove(); }, 800);
    };
    document.body.classList.add('is-locked');
    var wait = reduced ? 200 : 1700;
    var fired = false;
    var go = function () { if (!fired) { fired = true; hide(); } };
    window.setTimeout(go, wait);
    window.setTimeout(go, 4000); // hard ceiling if assets stall
  })();

  /* ---------- split headline ---------- */
  $$('[data-split]').forEach(function (el) {
    var words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach(function (w, i) {
      var outer = document.createElement('span');
      outer.className = 'word';
      var inner = document.createElement('span');
      inner.textContent = w;
      inner.style.transitionDelay = (0.06 * i + 0.25) + 's';
      outer.appendChild(inner);
      el.appendChild(outer);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
    window.setTimeout(function () { el.classList.add('is-in'); }, reduced ? 0 : 1750);
  });

  /* ---------- reveal on scroll ---------- */
  (function reveal() {
    var items = $$('.reveal');
    if (!('IntersectionObserver' in window) || reduced) {
      items.forEach(function (i) { i.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var siblings = $$('.reveal', e.target.parentNode);
        var idx = Math.max(0, siblings.indexOf(e.target));
        e.target.style.transitionDelay = Math.min(idx * 0.08, 0.4) + 's';
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach(function (i) { io.observe(i); });
  })();

  /* ---------- sticky nav + hero parallax ---------- */
  (function scrollFx() {
    var nav = $('#nav');
    var para = $$('[data-parallax]');
    var ticking = false;
    var lastY = 0;
    var onScroll = function () {
      var y = window.pageYOffset;
      if (nav) {
        nav.classList.toggle('is-stuck', y > 40);
        if (Math.abs(y - lastY) > 6) {
          var menuOpen = document.body.classList.contains('is-locked');
          nav.classList.toggle('is-hidden', !menuOpen && y > 420 && y > lastY);
          lastY = y;
        }
      } else {
        lastY = y;
      }
      if (!reduced && window.innerWidth > 900) {
        para.forEach(function (el) {
          var rate = parseFloat(el.getAttribute('data-parallax')) || 0.1;
          el.style.transform = 'translate3d(0,' + (-y * rate).toFixed(2) + 'px,0)';
        });
      }
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();
  })();

  /* ---------- mobile menu ---------- */
  (function menu() {
    var burger = $('#burger');
    var panel  = $('#mobilemenu');
    if (!burger || !panel) return;
    var setOpen = function (open) {
      panel.hidden = !open;
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      document.body.classList.toggle('is-locked', open);
    };
    burger.addEventListener('click', function () { setOpen(panel.hidden); });
    $$('a', panel).forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) setOpen(false);
    });
  })();

  /* ---------- count-up stats ---------- */
  (function counters() {
    var nums = $$('[data-count]');
    if (!nums.length) return;
    if (!('IntersectionObserver' in window) || reduced) {
      nums.forEach(function (n) {
        n.textContent = Number(n.getAttribute('data-count')).toLocaleString() + (n.getAttribute('data-suffix') || '');
      });
      return;
    }
    var run = function (el) {
      var target = Number(el.getAttribute('data-count')) || 0;
      var suffix = el.getAttribute('data-suffix') || '';
      var start = null, dur = 1400;
      var step = function (ts) {
        if (start === null) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString() + suffix;
        if (p < 1) window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.5 });
    nums.forEach(function (n) { io.observe(n); });
  })();

  /* ---------- listings filter ---------- */
  (function filters() {
    var chips = $$('.chip');
    var cards = $$('.card');
    var empty = $('#noresults');
    if (!chips.length) return;
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var f = chip.getAttribute('data-filter');
        chips.forEach(function (c) {
          var on = c === chip;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-selected', String(on));
        });
        var shown = 0;
        cards.forEach(function (card) {
          var cats = (card.getAttribute('data-cat') || '').split(/\s+/);
          var match = f === 'all' || cats.indexOf(f) !== -1;
          card.classList.toggle('is-hidden', !match);
          if (match) shown++;
        });
        if (empty) empty.hidden = shown !== 0;
      });
    });
  })();

  /* ---------- services accordion ---------- */
  (function rows() {
    var all = $$('[data-row]');
    if (!all.length) return;
    var open = function (row) {
      all.forEach(function (r) { r.classList.toggle('is-open', r === row); });
    };
    all.forEach(function (row) {
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'button');
      row.addEventListener('mouseenter', function () { if (!reduced) open(row); });
      row.addEventListener('click', function () { open(row); });
      row.addEventListener('focus', function () { open(row); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(row); }
      });
    });
  })();

  /* ---------- testimonials ---------- */
  (function quotes() {
    var slides = $$('.quote');
    var prev = $('#qprev');
    var next = $('#qnext');
    if (slides.length < 2) return;
    var i = 0, timer = null;
    var show = function (n) {
      i = (n + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
    };
    var auto = function () {
      if (reduced) return;
      window.clearInterval(timer);
      timer = window.setInterval(function () { show(i + 1); }, 7000);
    };
    if (prev) prev.addEventListener('click', function () { show(i - 1); auto(); });
    if (next) next.addEventListener('click', function () { show(i + 1); auto(); });
    auto();
  })();

  /* ---------- newsletter ---------- */
  (function news() {
    var form = $('#newsform');
    var msg  = $('#newsmsg');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#email');
      var value = (input.value || '').trim();
      var ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
      if (!ok) {
        msg.textContent = 'Please enter a valid email address.';
        input.focus();
        return;
      }
      msg.textContent = 'Thanks — market notes land in your inbox every other Tuesday.';
      form.reset();
    });
  })();
})();
