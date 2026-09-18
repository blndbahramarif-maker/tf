/* =============================================================
   Mobile Mechanic — Rochester, Kent
   Small, dependency-free script:
   1. Sticky header state
   2. Mobile menu
   3. Active navigation link on scroll
   4. Scroll reveal animations
   5. Quote form (opens the visitor's email app — see README)
   6. Mobile action bar spacing
   ============================================================= */
(function () {
  'use strict';

  var PHONE = '07767547383';
  var WHATSAPP = 'https://wa.me/447767547383';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 1. Sticky header ------------------------------------------------- */
  var header = document.getElementById('header');
  var onScroll = function () {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
  };
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
  var revealItems = document.querySelectorAll('[data-reveal]');

  if (reduceMotion || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(revealItems, function (el) {
      el.classList.add('is-visible');
    });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    Array.prototype.forEach.call(revealItems, function (el) {
      revealObserver.observe(el);
    });

    /* Safety net: reveal anything already on screen that the observer
       missed (fast scrolling, an anchor jump, a restored scroll position).
       Only what is in view, so sections further down still animate in. */
    var revealInView = function () {
      Array.prototype.forEach.call(revealItems, function (el) {
        var box = el.getBoundingClientRect();
        if (box.top < window.innerHeight * 0.95 && box.bottom > 0) {
          el.classList.add('is-visible');
        }
      });
    };
    window.addEventListener('load', revealInView);
    window.setTimeout(revealInView, 1200);
  }

  /* 5. Quote form ----------------------------------------------------- */
  /* There is no backend on this site. The form collects the details and
     hands them to the visitor's own messaging app, pre-addressed to the
     business. See README.md to connect a form service instead.        */
  var form = document.getElementById('quoteForm');
  var status = document.getElementById('formStatus');

  function showStatus(message) {
    if (!status) return;
    status.innerHTML = message;
    status.hidden = false;
  }

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var data = {
        name: form.name.value.trim(),
        phone: form.phone.value.trim(),
        vehicle: form.vehicle.value.trim(),
        problem: form.problem.value.trim(),
        datetime: form.datetime.value.trim()
      };

      var missing = [];
      if (!data.name) missing.push('name');
      if (!data.phone) missing.push('phone number');
      if (!data.problem) missing.push('description of the problem');

      if (missing.length) {
        showStatus('Please add your ' + missing.join(', ') + ' so I can get back to you.');
        var firstInvalid = !data.name ? form.name : (!data.phone ? form.phone : form.problem);
        firstInvalid.focus();
        return;
      }

      var lines = [
        'Quote request from the Mobile Mechanic website',
        'Name: ' + data.name,
        'Phone: ' + data.phone,
        'Vehicle: ' + (data.vehicle || 'Not provided'),
        'Preferred date/time: ' + (data.datetime || 'Not provided'),
        'Problem: ' + data.problem
      ];

      /* Opens WhatsApp with the details filled in, ready to send. */
      window.open(WHATSAPP + '?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');

      showStatus(
        'WhatsApp should now open with your details ready to send. ' +
        'If nothing happens, please call <a href="tel:' + PHONE + '" style="color:#fff">' + PHONE + '</a>.'
      );
    });
  }

  /* 6. Keep the mobile action bar clear of page content ---------------- */
  var actionBar = document.getElementById('actionBar');

  function padForActionBar() {
    if (!actionBar) return;
    var visible = window.getComputedStyle(actionBar).display !== 'none';
    document.body.style.paddingBottom = visible ? actionBar.offsetHeight + 'px' : '';
  }

  window.addEventListener('resize', padForActionBar);
  window.addEventListener('load', padForActionBar);
  padForActionBar();
})();
