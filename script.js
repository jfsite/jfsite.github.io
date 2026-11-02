/* ==========================================================================
   数控技术教学主页 — 交互脚本
   只做四件事：移动端导航开合、页头滚动阴影、区块入场动画、导航项高亮。
   全部使用原生 API，无依赖、无构建，直接由浏览器执行。
   ========================================================================== */
(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     1. 页脚年份：避免每年手动改版权年份
     ------------------------------------------------------------------ */
  function initYear() {
    var yearEl = document.getElementById('year');
    if (!yearEl) return;
    yearEl.textContent = String(new Date().getFullYear());
  }

  /* ------------------------------------------------------------------
     2. 移动端导航
        要点：按钮 aria-expanded 与面板 data-open 必须同步，
        否则读屏软件读到的状态与视觉状态会不一致。
     ------------------------------------------------------------------ */
  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var panel = document.getElementById('site-nav');
    if (!toggle || !panel) return;

    var mq = window.matchMedia('(max-width: 760px)');

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
      if (open) {
        panel.setAttribute('data-open', 'true');
      } else {
        panel.removeAttribute('data-open');
      }
    }

    function isOpen() {
      return toggle.getAttribute('aria-expanded') === 'true';
    }

    toggle.addEventListener('click', function () {
      setOpen(!isOpen());
    });

    // 点击面板内任意链接后收起（移动端常见预期）
    panel.addEventListener('click', function (event) {
      var target = event.target;
      if (target instanceof Element && target.closest('a') && mq.matches) {
        setOpen(false);
      }
    });

    // Esc 关闭并把焦点交还按钮，保证键盘用户不会"丢失焦点"
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });

    // 点击面板外部关闭
    document.addEventListener('click', function (event) {
      if (!isOpen() || !mq.matches) return;
      var target = event.target;
      if (target instanceof Node && !panel.contains(target) && !toggle.contains(target)) {
        setOpen(false);
      }
    });

    // 视口拉宽到桌面时，清掉移动端状态，避免残留的 open 属性
    mq.addEventListener('change', function (event) {
      if (!event.matches) setOpen(false);
    });
  }

  /* ------------------------------------------------------------------
     3. 页头滚动阴影：只在滚动后加边框与投影，首屏保持干净
     ------------------------------------------------------------------ */
  function initHeaderShadow() {
    var header = document.getElementById('site-header');
    if (!header) return;

    var ticking = false;

    function update() {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    }

    window.addEventListener(
      'scroll',
      function () {
        // requestAnimationFrame 节流，避免滚动时每帧触发样式计算
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(update);
        }
      },
      { passive: true }
    );

    update();
  }

  /* ------------------------------------------------------------------
     4. 区块入场动画
        用 IntersectionObserver 替代滚动位置计算，滚动开销接近零。
        用户开启"减少动态效果"时直接跳过，内容保持可见。
     ------------------------------------------------------------------ */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (items.length === 0) return;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) {
        el.classList.add('is-visible');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target); // 只播一次，避免来回滚动重复闪烁
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    items.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ------------------------------------------------------------------
     5. 导航项高亮
        用 rootMargin 把观察区域压缩到视口中部一条窄带，
        哪个区块进入这条带，就点亮对应导航项。
     ------------------------------------------------------------------ */
  function initNavHighlight() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
    if (links.length === 0) return;

    var sections = links
      .map(function (link) {
        var id = link.getAttribute('href');
        if (!id || id.charAt(0) !== '#') return null;
        return document.querySelector(id);
      })
      .filter(function (section) {
        return section !== null;
      });

    if (sections.length === 0 || !('IntersectionObserver' in window)) return;

    function activate(id) {
      links.forEach(function (link) {
        link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
      });
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) activate(entry.target.id);
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );

    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  /* ------------------------------------------------------------------
     启动
     ------------------------------------------------------------------ */
  function init() {
    initYear();
    initNav();
    initHeaderShadow();
    initReveal();
    initNavHighlight();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
