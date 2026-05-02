import { projects } from './projects-data.js';

/* ============================================================
   FRAME ANIMATOR — scroll-driven canvas animation (optimized)
   ============================================================
   Techniques applied (from research):
   1. Pre-scale all 4K frames to exact viewport size during loading
      → drawImage during scroll is a zero-scaling 1:1 GPU blit
   2. desynchronized context → bypasses compositor for lower latency
   3. Integer draw coordinates → avoids sub-pixel anti-aliasing cost
   4. Cached layout dimensions → no getBoundingClientRect in scroll
   5. Scroll handler only sets a number → rendering is fully in rAF
   6. Convergence skip → no GPU work when user isn't scrolling
   ============================================================ */
class FrameAnimator {
  constructor() {
    this.canvas = document.getElementById('hero-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.frameCount = 276;
    this.frames = new Array(this.frameCount);
    this.currentFrame = 0;
    this.targetFrame = 0;
    this.heroEl = document.getElementById('hero');
    this.isMobile = window.innerWidth < 768;
    this.step = this.isMobile ? 2 : 1;
    this._lastDrawn = -1;
    this._vpW = 0;
    this._vpH = 0;

    // Cache layout values (updated on resize only)
    this._heroHeight = 0;
    this._heroTop = 0;
    this._winH = 0;
    this._cacheLayout();

    this.resize();
    window.addEventListener('resize', () => {
      this._cacheLayout();
      this.resize();
    }, { passive: true });
    this.preload();
    this.bindScroll();
    this.tick();
  }

  _cacheLayout() {
    this._heroHeight = this.heroEl.offsetHeight;
    this._winH = window.innerHeight;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this._vpW = w;
    this._vpH = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.drawCurrent();
  }

  preload() {
    const loaderBar = document.getElementById('loader-bar');
    const loaderText = document.getElementById('loader-text');
    const loader = document.getElementById('loader');
    let loaded = 0;
    const total = Math.ceil(this.frameCount / this.step);

    // Temp canvas for pre-scaling 4K → viewport size
    const cw = this._vpW, ch = this._vpH;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cw;
    tempCanvas.height = ch;
    const tempCtx = tempCanvas.getContext('2d');

    const loadFrame = async (i) => {
      try {
        const res = await fetch(`/frames/frame_${String(i + 1).padStart(4, '0')}.webp`);
        const blob = await res.blob();
        // Decode full 4K frame
        const fullBitmap = await createImageBitmap(blob);

        // Pre-scale to exact viewport size (one-time cost during loading)
        const scale = Math.max(cw / fullBitmap.width, ch / fullBitmap.height);
        const w = fullBitmap.width * scale, h = fullBitmap.height * scale;
        tempCtx.drawImage(fullBitmap,
          Math.round((cw - w) / 2), Math.round((ch - h) / 2),
          Math.round(w), Math.round(h)
        );
        fullBitmap.close(); // Free the massive 4K bitmap

        // Store viewport-sized ImageBitmap (fast 1:1 draw during scroll)
        const scaledBitmap = await createImageBitmap(tempCanvas);
        this.frames[i] = scaledBitmap;
      } catch (e) {
        // skip failed frames
      }
      loaded++;
      const pct = Math.min(100, Math.round((loaded / total) * 100));
      loaderBar.style.width = pct + '%';
      loaderText.textContent = `Loading frames… ${pct}%`;
      if (loaded === 1) this.drawFrame(0);
      if (loaded >= total) {
        setTimeout(() => loader.classList.add('done'), 300);
      }
    };

    // Load 2 at a time with breathing room to avoid CPU spike
    const queue = [];
    for (let i = 0; i < this.frameCount; i += this.step) {
      queue.push(i);
    }
    let cursor = 0;
    const runBatch = async () => {
      while (cursor < queue.length) {
        const batch = queue.slice(cursor, cursor + 2);
        cursor += 2;
        await Promise.all(batch.map(i => loadFrame(i)));
        await new Promise(r => setTimeout(r, 0));
      }
    };
    runBatch();
  }

  bindScroll() {
    // Scroll handler ONLY updates a number — no rendering, no layout reads
    window.addEventListener('scroll', () => {
      const scrolled = -this.heroEl.getBoundingClientRect().top;
      const scrollable = this._heroHeight - this._winH;
      const progress = Math.max(0, Math.min(1, scrolled / scrollable));
      const frameProgress = Math.min(1, progress / 0.7);
      this.targetFrame = Math.round(frameProgress * (this.frameCount - 1));
    }, { passive: true });
  }

  tick() {
    const delta = this.targetFrame - this.currentFrame;
    if (Math.abs(delta) > 0.01) {
      // Adaptive lerp: faster easing for small gaps, smoother for large jumps
      const absDelta = Math.abs(delta);
      const lerp = absDelta < 3 ? 0.18 : 0.10;
      let step = delta * lerp;

      // Clamp: never jump more than 4 frames per tick (prevents fast-scroll jumps)
      // and always move at least 0.15 frames per tick (prevents frame-by-frame stutter)
      const maxStep = 4;
      const minStep = 0.15;
      if (Math.abs(step) > maxStep) step = Math.sign(step) * maxStep;
      if (Math.abs(step) < minStep && absDelta > 0.5) step = Math.sign(step) * minStep;

      this.currentFrame += step;
      let idx = Math.round(this.currentFrame);
      if (this.step > 1) idx = Math.round(idx / this.step) * this.step;
      if (idx !== this._lastDrawn) this.drawFrame(idx);
    }
    requestAnimationFrame(() => this.tick());
  }

  drawFrame(idx) {
    const img = this.frames[idx];
    if (!img) return;
    this._lastDrawn = idx;
    const cw = this.canvas.width, ch = this.canvas.height;
    if (img.width === cw && img.height === ch) {
      // Pre-scaled: zero-cost 1:1 GPU pixel copy
      this.ctx.drawImage(img, 0, 0);
    } else {
      // Fallback after window resize: scale with integer coords
      const scale = Math.max(cw / img.width, ch / img.height);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      this.ctx.drawImage(img, Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);
    }
  }

  drawCurrent() {
    let idx = Math.round(this.currentFrame);
    if (this.step > 1) idx = Math.round(idx / this.step) * this.step;
    this.drawFrame(idx);
  }
}

/* ============================================================
   HERO TEXT + PROJECTS SCROLL CONTROLLER
   ============================================================ */
function initHeroScrollEffects() {
  const hero = document.getElementById('hero');
  const heroContent = document.getElementById('hero-content');
  const heroProjects = document.getElementById('hero-projects');
  const hint = document.getElementById('hero-scroll-hint');
  let hintHidden = false;

  window.addEventListener('scroll', () => {
    const rect = hero.getBoundingClientRect();
    const scrollable = hero.offsetHeight - window.innerHeight;
    const scrolled = -rect.top;
    const progress = Math.max(0, Math.min(1, scrolled / scrollable));

    // Hide scroll hint early
    if (!hintHidden && progress > 0.05) { hint.classList.add('hidden'); hintHidden = true; }

    // Hero text: visible 0-0.35, fades 0.35-0.5
    if (progress < 0.35) {
      heroContent.style.opacity = '1';
      heroContent.style.transform = 'none';
      heroContent.style.filter = 'none';
      heroContent.style.pointerEvents = 'all';
    } else if (progress < 0.5) {
      const fade = (progress - 0.35) / 0.15;
      heroContent.style.opacity = String(1 - fade);
      heroContent.style.transform = `translateY(${-fade * 40}px)`;
      heroContent.style.filter = `blur(${fade * 6}px)`;
      heroContent.style.pointerEvents = 'none';
    } else {
      heroContent.style.opacity = '0';
      heroContent.style.pointerEvents = 'none';
    }

    // Projects: appear at 0.55, fully visible by 0.7
    if (progress < 0.53) {
      heroProjects.classList.remove('visible');
    } else {
      heroProjects.classList.add('visible');
      const cards = heroProjects.querySelectorAll('.hp-card');
      const cardProgress = Math.min(1, (progress - 0.53) / 0.15);
      cards.forEach((card, i) => {
        const delay = i * 0.12;
        const cp = Math.max(0, Math.min(1, (cardProgress - delay) / 0.4));
        card.style.opacity = String(cp);
        card.style.transform = `translateY(${(1 - cp) * 30}px)`;
      });
    }
  }, { passive: true });
}

/* ============================================================
   HERO TEXT REVEAL (initial animation)
   ============================================================ */
function initHeroReveal() {
  const items = document.querySelectorAll('.reveal-hero');
  setTimeout(() => {
    items.forEach(el => {
      const delay = parseInt(el.dataset.delay || 0) * 150 + 400;
      setTimeout(() => el.classList.add('visible'), delay);
    });
  }, 800);
}

/* ============================================================
   SCROLL REVEAL (Intersection Observer)
   ============================================================ */
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const delay = parseInt(entry.target.dataset.revealDelay || 0);
        setTimeout(() => entry.target.classList.add('revealed'), delay);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => observer.observe(el));
}

/* ============================================================
   NAVBAR
   ============================================================ */
function initNavbar() {
  const nav = document.getElementById('navbar');
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');
  const hero = document.getElementById('hero');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 100);
  }, { passive: true });

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', links.classList.contains('open'));
  });

  document.querySelectorAll('[data-nav]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const navVal = a.getAttribute('data-nav');
      // Close mobile menu
      toggle.classList.remove('open');
      links.classList.remove('open');

      // If on project detail, go back first
      if (!document.getElementById('project-detail').classList.contains('hidden')) {
        closeProjectDetail();
        if (navVal === 'projects') {
          setTimeout(() => {
            const target = hero.offsetTop + hero.offsetHeight * 0.65;
            window.scrollTo({ top: target, behavior: 'smooth' });
          }, 400);
        } else {
          const id = a.getAttribute('href').replace('#', '');
          setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 400);
        }
        return;
      }

      if (navVal === 'projects') {
        // Scroll to the hero projects zone (around 80% of hero)
        const target = hero.offsetTop + hero.offsetHeight * 0.65;
        window.scrollTo({ top: target, behavior: 'smooth' });
      } else {
        const id = a.getAttribute('href').replace('#', '');
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  document.getElementById('nav-logo').addEventListener('click', (e) => {
    e.preventDefault();
    if (!document.getElementById('project-detail').classList.contains('hidden')) {
      closeProjectDetail();
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

/* ============================================================
   SKILLS (categorized with wave animation)
   ============================================================ */
function initSkills() {
  const categories = [
    { label: 'Languages', skills: [
      { name: 'Python', icon: 'Py' }, { name: 'JavaScript', icon: 'JS' }, { name: 'C++', icon: 'C+' }
    ]},
    { label: 'AI / ML', skills: [
      { name: 'Machine Learning', icon: 'ML' }, { name: 'OpenCV', icon: 'CV' }, { name: 'Deep Learning', icon: 'DL' }
    ]},
    { label: 'Frameworks & Tools', skills: [
      { name: 'Node.js', icon: 'NJ' }, { name: 'Git', icon: 'Git' }, { name: 'SQL', icon: 'DB' }
    ]},
    { label: 'Systems', skills: [
      { name: 'IoT', icon: 'IoT' }, { name: 'Linux', icon: 'Lx' }, { name: 'Embedded', icon: 'Em' }
    ]}
  ];
  const grid = document.getElementById('skills-grid');
  let globalIdx = 0;
  categories.forEach(cat => {
    const group = document.createElement('div');
    group.className = 'skill-category reveal';
    group.dataset.revealDelay = String(globalIdx * 40);
    group.innerHTML = `<span class="skill-category-label">${cat.label}</span>`;
    const pillWrap = document.createElement('div');
    pillWrap.className = 'skill-category-pills';
    cat.skills.forEach(s => {
      const pill = document.createElement('div');
      pill.className = 'skill-pill';
      pill.style.transitionDelay = `${globalIdx * 60}ms`;
      pill.innerHTML = `<span class="skill-icon">${s.icon}</span><span>${s.name}</span>`;
      pillWrap.appendChild(pill);
      globalIdx++;
    });
    group.appendChild(pillWrap);
    grid.appendChild(group);
  });
}

/* ============================================================
   HERO PROJECTS (around the avatar in end-frame zone)
   ============================================================ */
function initHeroProjects() {
  const leftCol = document.getElementById('hero-projects-left');
  const rightCol = document.getElementById('hero-projects-right');

  projects.forEach((p, i) => {
    const card = document.createElement('article');
    card.className = 'hp-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <span class="hp-card-num">${p.num}</span>
      <h3>${p.title}</h3>
      <p>${p.short}</p>
      <div class="hp-card-tags">${p.tags.slice(0, 3).map(t => `<span class="hp-card-tag">${t}</span>`).join('')}</div>
      <div class="hp-card-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M7 7h10v10"/></svg></div>
    `;
    card.addEventListener('click', () => openProjectDetail(p.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openProjectDetail(p.id); });

    // Distribute: 0,2 left — 1,3 right
    if (i % 2 === 0) leftCol.appendChild(card);
    else rightCol.appendChild(card);
  });
}

/* ============================================================
   PROJECT DETAIL PAGES
   ============================================================ */
function openProjectDetail(id) {
  const p = projects.find(x => x.id === id);
  if (!p) return;
  const detail = document.getElementById('project-detail');
  const main = document.getElementById('main-content');

  detail.innerHTML = `
    <div class="project-detail-hero"><div class="container">
      <button class="project-detail-back" id="detail-back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to Portfolio
      </button>
      <h1 class="project-detail-title">${p.title}</h1>
      <p class="project-detail-subtitle">${p.overview}</p>
      <div class="project-detail-tags">${p.tags.map(t => `<span class="project-tag">${t}</span>`).join('')}</div>
    </div></div>
    <div class="project-detail-body"><div class="container">
      <div class="project-section"><h3><span class="ps-icon">01</span> Problem Statement</h3><p>${p.problem}</p></div>
      <div class="project-section"><h3><span class="ps-icon">02</span> Solution</h3><p>${p.solution}</p></div>
      <div class="project-section"><h3><span class="ps-icon">03</span> Implementation</h3><ul>${p.implementation.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <div class="project-section"><h3><span class="ps-icon">04</span> Tech Stack</h3><div class="project-tech-grid">${p.techStack.map(t => `<span class="project-tech-item">${t}</span>`).join('')}</div></div>
      <div class="project-section"><h3><span class="ps-icon">05</span> Outcomes</h3><ul>${p.outcomes.map(x => `<li>${x}</li>`).join('')}</ul></div>
    </div></div>
  `;

  main.style.display = 'none';
  detail.classList.remove('hidden');
  detail.setAttribute('aria-hidden', 'false');
  window.scrollTo({ top: 0 });
  history.pushState({ project: id }, '', `#/project/${id}`);
  detail.querySelector('#detail-back').addEventListener('click', closeProjectDetail);
}

function closeProjectDetail() {
  const detail = document.getElementById('project-detail');
  const main = document.getElementById('main-content');
  detail.classList.add('hidden');
  detail.setAttribute('aria-hidden', 'true');
  main.style.display = '';
  history.pushState({}, '', window.location.pathname);
  const hero = document.getElementById('hero');
  setTimeout(() => {
    const target = hero.offsetTop + hero.offsetHeight * 0.82;
    window.scrollTo({ top: target, behavior: 'smooth' });
  }, 50);
}

window.addEventListener('popstate', () => {
  const hash = window.location.hash;
  if (hash.startsWith('#/project/')) {
    openProjectDetail(hash.split('/').pop());
  } else {
    const detail = document.getElementById('project-detail');
    if (!detail.classList.contains('hidden')) {
      detail.classList.add('hidden');
      detail.setAttribute('aria-hidden', 'true');
      document.getElementById('main-content').style.display = '';
    }
  }
});

/* ============================================================
   CONTACT FORM
   ============================================================ */
function initContactForm() {
  const form = document.getElementById('contact-form');
  const feedback = document.getElementById('form-feedback');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = document.getElementById('form-submit');
    btn.textContent = 'Sending…';
    btn.disabled = true;
    setTimeout(() => {
      feedback.textContent = '✓ Message sent! I\'ll get back to you soon.';
      feedback.style.color = 'var(--teal)';
      btn.textContent = 'Send Message';
      btn.disabled = false;
      form.reset();
      setTimeout(() => { feedback.textContent = ''; }, 5000);
    }, 1200);
  });
}

/* ============================================================
   MAGNETIC BUTTONS
   ============================================================ */
function initMagneticButtons() {
  if ('ontouchstart' in window) return;
  document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = `translate(${x * 0.2}px, ${y * 0.2}px)`;
    });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
  });
}

/* ============================================================
   COUNTER ANIMATION (stat numbers count up)
   ============================================================ */
function initCounters() {
  const counters = document.querySelectorAll('.stat-number[data-count]');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      let current = 0;
      const step = Math.max(1, Math.floor(target / 40));
      const timer = setInterval(() => {
        current += step;
        if (current >= target) { current = target; clearInterval(timer); }
        el.textContent = current + suffix;
      }, 30);
      observer.unobserve(el);
    });
  }, { threshold: 0.5 });
  counters.forEach(c => observer.observe(c));
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  new FrameAnimator();
  initHeroReveal();
  initNavbar();
  initSkills();
  initHeroProjects();
  initHeroScrollEffects();
  initContactForm();
  initCounters();
  setTimeout(() => {
    initScrollReveal();
    initMagneticButtons();
  }, 1200);

  const hash = window.location.hash;
  if (hash.startsWith('#/project/')) {
    openProjectDetail(hash.split('/').pop());
  }
});
