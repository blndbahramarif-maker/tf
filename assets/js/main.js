/* =============================================================
   RDF Mobile Mechanic — bringing the workshop to you
   Small, dependency-free script:
   1. Sticky header state
   2. Mobile menu
   3. Active navigation link while scrolling
   4. Scroll reveal animations
   5. Quote form -> pre-written WhatsApp message
   6. Current year in the footer
   7. Reading-progress bar
   8. Pointer-driven 3D tilt on cards and photographs
   9. Scroll parallax for the hero scene and the ghost words
   10. Stat counters
   ============================================================= */
(function () {
  'use strict';

  var PHONE = '07706 696124';
  var WHATSAPP_NUMBER = '447706696124';

  /* 1. Sticky header ------------------------------------------------- */
  var header = document.getElementById('header');
  function onScroll() {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* 2. Mobile menu --------------------------------------------------- */
  var toggle = document.getElementById('navToggle');
  var mobileNav = document.getElementById('mobileNav');

  function closeMenu() {
    if (!toggle || !mobileNav) return;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    mobileNav.classList.remove('is-open');
  }

  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
      mobileNav.classList.toggle('is-open', !open);
    });

    mobileNav.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= 860) closeMenu();
    });
  }

  /* 3. Active navigation link ---------------------------------------- */
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll('#primary-links a[href^="#"]')
  );
  var sections = navLinks
    .map(function (link) { return document.querySelector(link.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var navObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (link) {
          link.classList.toggle(
            'is-active',
            link.getAttribute('href') === '#' + entry.target.id
          );
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sections.forEach(function (section) { navObserver.observe(section); });
  }

  /* 4. Scroll reveal -------------------------------------------------- */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealables = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealables.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry, index) {
        if (!entry.isIntersecting) return;
        var delay = Math.min(index, 4) * 80;
        setTimeout(function () { entry.target.classList.add('is-visible'); }, delay);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    revealables.forEach(function (el) { revealObserver.observe(el); });
  }

  /* 5. Quote form ----------------------------------------------------- */
  /* There is no server behind this site, so the form does not send
     anything by itself. It builds a tidy WhatsApp message from the
     answers and opens WhatsApp with it ready to send. */
  var form = document.getElementById('quoteForm');
  var status = document.getElementById('formStatus');

  function fieldWrap(input) { return input.closest('.field'); }

  function setError(input, message) {
    var wrap = fieldWrap(input);
    var slot = form.querySelector('[data-error-for="' + input.id + '"]');
    if (wrap) wrap.classList.toggle('is-invalid', Boolean(message));
    if (slot) slot.textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function validate(input) {
    var value = (input.value || '').trim();

    if (input.hasAttribute('required') && !value) {
      setError(input, 'Please fill this in.');
      return false;
    }
    if (input.type === 'tel' && value) {
      var digits = value.replace(/[^0-9]/g, '');
      if (digits.length < 10) {
        setError(input, 'Please enter a full phone number.');
        return false;
      }
    }
    setError(input, '');
    return true;
  }

  if (form) {
    var inputs = Array.prototype.slice.call(
      form.querySelectorAll('input, select, textarea')
    );

    inputs.forEach(function (input) {
      input.addEventListener('blur', function () { validate(input); });
      input.addEventListener('input', function () {
        if (fieldWrap(input) && fieldWrap(input).classList.contains('is-invalid')) validate(input);
      });
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var valid = true;
      var firstBad = null;
      inputs.forEach(function (input) {
        if (!validate(input)) {
          valid = false;
          if (!firstBad) firstBad = input;
        }
      });

      if (!valid) {
        if (status) {
          status.textContent = 'Please check the highlighted fields, or simply call ' + PHONE + '.';
          status.classList.add('is-visible');
        }
        if (firstBad) firstBad.focus();
        return;
      }

      var get = function (id) {
        var el = document.getElementById(id);
        return el ? (el.value || '').trim() : '';
      };

      var lines = [
        'Quote request from the RDF website',
        '',
        'Name: ' + get('name'),
        'Phone: ' + get('phone'),
        'Vehicle: ' + (get('vehicle') || 'not given'),
        'Registration: ' + (get('reg') || 'not given'),
        'Service: ' + get('service'),
        'Area: ' + (get('postcode') || 'not given'),
        '',
        'Details: ' + get('details')
      ];

      var url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(lines.join('\n'));
      window.open(url, '_blank', 'noopener');

      if (status) {
        status.textContent =
          'WhatsApp is opening with your details ready to send. If nothing happens, call ' + PHONE + '.';
        status.classList.add('is-visible');
      }
    });
  }

  /* 6. Footer year ----------------------------------------------------- */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* 7. Reading-progress bar --------------------------------------------- */
  var progress = document.getElementById('scrollProgress');

  /* 8. 3D tilt ----------------------------------------------------------- */
  /* Pointer-driven only: a finger cannot hover, and a tilt that fires on
     touch just makes the page feel loose. */
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var tiltables = Array.prototype.slice.call(document.querySelectorAll('[data-tilt]'));

  if (finePointer && !reduceMotion) {
    tiltables.forEach(function (card) {
      var max = parseFloat(card.getAttribute('data-tilt-max')) || 8;
      var restX = 0;
      var restY = 0;
      var frame = null;

      /* The hero photograph sits at an angle to begin with — tilt from there. */
      if (card.classList.contains('hero__frame')) {
        restX = 2.5;
        restY = -7;
      }

      var sheen = document.createElement('span');
      sheen.className = 'tilt-sheen';
      card.appendChild(sheen);

      card.addEventListener('pointermove', function (event) {
        if (frame) return;
        frame = requestAnimationFrame(function () {
          frame = null;
          var box = card.getBoundingClientRect();
          var px = (event.clientX - box.left) / box.width;
          var py = (event.clientY - box.top) / box.height;
          card.style.setProperty('--ry', (restY + (px - 0.5) * max * 2).toFixed(2) + 'deg');
          card.style.setProperty('--rx', (restX - (py - 0.5) * max * 2).toFixed(2) + 'deg');
          card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
          card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
          card.classList.add('is-tilting');
        });
      });

      card.addEventListener('pointerleave', function () {
        card.classList.remove('is-tilting');
        card.style.setProperty('--rx', restX + 'deg');
        card.style.setProperty('--ry', restY + 'deg');
      });
    });
  }

  /* 9. Parallax ---------------------------------------------------------- */
  var layers = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));
  var ticking = false;

  function paint() {
    ticking = false;

    if (progress) {
      var scrollable = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
      progress.style.setProperty('--progress', Math.min(1, Math.max(0, ratio)).toFixed(4));
    }

    if (reduceMotion) return;

    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var depth = parseFloat(layer.getAttribute('data-parallax')) || 0.08;
      var box = layer.getBoundingClientRect();
      var offset = (box.top + box.height / 2 - window.innerHeight / 2) * -depth;
      var centred = layer.classList.contains('ghost') ? ' translateY(-50%)' : '';
      layer.style.transform = 'translate3d(0, ' + offset.toFixed(1) + 'px, 0)' + centred;
    }
  }

  function requestPaint() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(paint);
    }
  }

  window.addEventListener('scroll', requestPaint, { passive: true });
  window.addEventListener('resize', requestPaint);
  requestPaint();

  /* 10. Stat counters ----------------------------------------------------- */
  var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count-to]'));

  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count-to')) || 0;
    var suffix = el.getAttribute('data-count-suffix') || '';
    var duration = 1300;
    var started = null;

    function step(now) {
      if (started === null) started = now;
      var t = Math.min(1, (now - started) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  if (counters.length && !reduceMotion && 'IntersectionObserver' in window) {
    var countObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countUp(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.6 });

    counters.forEach(function (el) { countObserver.observe(el); });
  }
})();
