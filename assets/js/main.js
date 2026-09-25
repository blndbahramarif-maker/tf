/* Pampered Pets — page behaviour (header, menu, section tracking, reveals). */
(function () {
  'use strict';

  var header = document.getElementById('header');
  var toggle = document.getElementById('navToggle');
  var hero = document.getElementById('home');
  var dots = document.querySelector('.scroll-dots');
  var mobileBar = document.querySelector('.mobile-bar');
  var sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
  var lightSections = ['parlour', 'services', 'visit'];

  // Show the hero text even if the 3D scene is slow or blocked.
  setTimeout(function () { hero.classList.add('is-shown'); }, 2600);

  /* Mobile menu */
  function closeMenu() {
    document.body.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
  }
  toggle.addEventListener('click', function () {
    var open = document.body.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  document.querySelectorAll('.mobile-nav a').forEach(function (a) { a.addEventListener('click', closeMenu); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  /* Header style + active section, based on what sits under the header. */
  function update() {
    var probe = header.offsetHeight + 1;
    var current = sections[0];
    sections.forEach(function (s) { if (s.getBoundingClientRect().top <= probe) current = s; });
    var id = current.id;
    var light = lightSections.indexOf(id) !== -1;

    header.classList.toggle('is-scrolled', window.scrollY > 20);
    header.classList.toggle('is-light', light && window.scrollY > 20);

    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-nav') === id);
    });

    // Dots sit mid-screen, so colour them by the section in the middle.
    var mid = window.innerHeight / 2;
    var midSection = sections[0];
    sections.forEach(function (s) { if (s.getBoundingClientRect().top <= mid) midSection = s; });
    if (dots) {
      dots.classList.toggle('is-light', lightSections.indexOf(midSection.id) !== -1);
      dots.querySelectorAll('[data-dot]').forEach(function (a) {
        a.classList.toggle('is-active', a.getAttribute('data-dot') === midSection.id);
      });
    }

    if (mobileBar) mobileBar.classList.toggle('is-visible', window.scrollY > window.innerHeight * 0.6);
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; update(); }); }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();

  /* Reveal on scroll, staggered within each section. */
  var reveals = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window) {
    sections.forEach(function (s) {
      s.querySelectorAll('[data-reveal]').forEach(function (el, i) {
        el.style.setProperty('--rd', Math.min(i * 0.08, 0.6) + 's');
      });
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
