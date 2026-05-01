import { projects } from './projects-data.js';

/* ============================================================
   FRAME ANIMATOR — scroll-driven canvas animation
   ============================================================ */
class FrameAnimator {
  constructor() {
    this.canvas = document.getElementById('hero-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.frameCount = 276;
    this.frames = new Array(this.frameCount);
    this.loadedCount = 0;
    this.currentFrame = 0;
    this.targetFrame = 0;
    this.heroEl = document.getElementById('hero');
    this.isMobile = window.innerWidth < 768;
    this.step = this.isMobile ? 2 : 1;
    this._lastDrawn = -1;
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this.preload();
    this.bindScroll();
    this.tick();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawCurrent();
  }

  preload() {
    const loaderBar = document.getElementById('loader-bar');
    const loaderText = document.getElementById('loader-text');
    const loader = document.getElementById('loader');
    let idx = 0;
    const total = Math.ceil(this.frameCount / this.step);
    const next = () => {
      if (idx >= this.frameCount) {
        setTimeout(() => loader.classList.add('done'), 300);
        return;
      }
      const i = idx;
      idx += this.step;
      const img = new Image();
      img.src = `/frames/frame_${String(i + 1).padStart(4, '0')}.png`;
      img.onload = () => {
        this.frames[i] = img;
        this.loadedCount++;
        const pct = Math.min(100, Math.round((this.loadedCount / total) * 100));
        loaderBar.style.width = pct + '%';
        loaderText.textContent = `Loading frames… ${pct}%`;
        if (this.loadedCount === 1) this.drawFrame(0);
        next();
      };
      img.onerror = () => { idx += this.step; next(); };
    };
    for (let c = 0; c < 4; c++) next();
  }

  bindScroll() {
    window.addEventListener('scroll', () => {
      const rect = this.heroEl.getBoundingClientRect();
      const scrollable = this.heroEl.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      const progress = Math.max(0, Math.min(1, scrolled / scrollable));
      // Frame animation uses first 70% of hero scroll
      const frameProgress = Math.min(1, progress / 0.7);
      this.targetFrame = Math.round(frameProgress * (this.frameCount - 1));
    }, { passive: true });
  }

  tick() {
    this.currentFrame += (this.targetFrame - this.currentFrame) * 0.12;
    let idx = Math.round(this.currentFrame);
    if (this.step > 1) idx = Math.round(idx / this.step) * this.step;
    if (idx !== this._lastDrawn) this.drawFrame(idx);
    requestAnimationFrame(() => this.tick());
  }

  drawFrame(idx) {
    const img = this.frames[idx];
    if (!img) return;
    this._lastDrawn = idx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = this.canvas.width / dpr, ch = this.canvas.height / dpr;
    this.ctx.clearRect(0, 0, cw, ch);
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    this.ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
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

    // Hero text: visible 0-0.4, fades 0.4-0.6
    if (progress < 0.4) {
      heroContent.style.opacity = '1';
      heroContent.style.transform = 'none';
      heroContent.style.filter = 'none';
    } else if (progress < 0.6) {
      const fade = (progress - 0.4) / 0.2;
      heroContent.style.opacity = String(1 - fade);
      heroContent.style.transform = `translateY(${-fade * 40}px)`;
      heroContent.style.filter = `blur(${fade * 6}px)`;
    } else {
      heroContent.style.opacity = '0';
      heroContent.style.pointerEvents = 'none';
    }

    // Projects: hidden until 0.7, fades in 0.7-0.85
    if (progress < 0.68) {
      heroProjects.classList.remove('visible');
    } else {
      heroProjects.classList.add('visible');
      // Stagger card animations
      const cards = heroProjects.querySelectorAll('.hp-card');
      const cardProgress = Math.min(1, (progress - 0.68) / 0.15);
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
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
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
            const target = hero.offsetTop + hero.offsetHeight * 0.82;
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
        const target = hero.offsetTop + hero.offsetHeight * 0.82;
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
   SKILLS
   ============================================================ */
function initSkills() {
  const skills = [
    { name: 'Python', icon: 'Py' }, { name: 'JavaScript', icon: 'JS' },
    { name: 'C++', icon: 'C+' }, { name: 'Machine Learning', icon: 'ML' },
    { name: 'OpenCV', icon: 'CV' }, { name: 'IoT', icon: 'IoT' },
    { name: 'Node.js', icon: 'NJ' }, { name: 'SQL', icon: 'DB' },
    { name: 'Git', icon: 'Git' }, { name: 'Linux', icon: 'Lx' }
  ];
  const grid = document.getElementById('skills-grid');
  skills.forEach((s, i) => {
    const pill = document.createElement('div');
    pill.className = 'skill-pill reveal';
    pill.dataset.revealDelay = String(i * 60);
    pill.innerHTML = `<span class="skill-icon">${s.icon}</span><span>${s.name}</span>`;
    grid.appendChild(pill);
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
  setTimeout(() => initScrollReveal(), 1200);

  const hash = window.location.hash;
  if (hash.startsWith('#/project/')) {
    openProjectDetail(hash.split('/').pop());
  }
});
