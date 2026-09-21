/* =============================================================
   RDF Mobile Mechanic
   1. Sticky header state
   2. Mobile menu
   3. Active link in the navigation and the section rail
   4. Reveal on scroll (a short fade and rise, nothing more)
   5. Quote form -> pre-written WhatsApp message
   6. Current year in the footer
   ============================================================= */
(function () {
  'use strict';

  var PHONE = '07706 696124';
  var WHATSAPP_NUMBER = '447706696124';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  /* 3. Active link --------------------------------------------------- */
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll('#primary-links a[href^="#"], .rail a[href^="#"]')
  );
  var sections = navLinks
    .map(function (link) { return document.querySelector(link.getAttribute('href')); })
    .filter(function (section, index, all) { return section && all.indexOf(section) === index; });

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

  /* 4. Reveal on scroll ---------------------------------------------- */
  var revealables = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealables.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry, index) {
        if (!entry.isIntersecting) return;
        var delay = Math.min(index, 5) * 60;
        setTimeout(function () { entry.target.classList.add('is-visible'); }, delay);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.1 });

    revealables.forEach(function (el) { revealObserver.observe(el); });
  }

  /* 5. Quote form ----------------------------------------------------- */
  /* No server behind this site: the form builds a tidy WhatsApp message
     and opens WhatsApp with it ready to send. */
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
    if (input.type === 'tel' && value && value.replace(/[^0-9]/g, '').length < 10) {
      setError(input, 'Please enter a full phone number.');
      return false;
    }
    setError(input, '');
    return true;
  }

  if (form) {
    var inputs = Array.prototype.slice.call(form.querySelectorAll('input, select, textarea'));

    inputs.forEach(function (input) {
      input.addEventListener('blur', function () { validate(input); });
      input.addEventListener('input', function () {
        var wrap = fieldWrap(input);
        if (wrap && wrap.classList.contains('is-invalid')) validate(input);
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

      window.open(
        'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(lines.join('\n')),
        '_blank',
        'noopener'
      );

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
})();
