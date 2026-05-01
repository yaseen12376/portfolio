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
    this.running = true;

    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this.preload();
    this.bindScroll();
    this.tick();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
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

    const next = () => {
      if (idx >= this.frameCount) {
        setTimeout(() => loader.classList.add('done'), 300);
        return;
      }
      const i = idx;
      idx += this.step;
      const img = new Image();
      const num = String(i + 1).padStart(4, '0');
      img.src = `/frames/frame_${num}.jpg`;
      img.onload = () => {
        this.frames[i] = img;
        this.loadedCount++;
        const pct = Math.min(100, Math.round((this.loadedCount / (this.frameCount / this.step)) * 100));
        loaderBar.style.width = pct + '%';
        loaderText.textContent = `Loading frames… ${pct}%`;
        if (this.loadedCount === 1) this.drawFrame(0);
        next();
      };
      img.onerror = () => next();
    };

    // Start 4 parallel loading chains
    for (let c = 0; c < 4; c++) next();
  }

  bindScroll() {
    window.addEventListener('scroll', () => {
      const rect = this.heroEl.getBoundingClientRect();
      const scrollable = this.heroEl.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      const progress = Math.max(0, Math.min(1, scrolled / scrollable));
      this.targetFrame = Math.round(progress * (this.frameCount - 1));
    }, { passive: true });
  }

  tick() {
    if (!this.running) return;
    this.currentFrame += (this.targetFrame - this.currentFrame) * 0.12;
    let idx = Math.round(this.currentFrame);
    // snap to nearest loaded frame
    if (this.step > 1) idx = Math.round(idx / this.step) * this.step;
    if (idx !== this._lastDrawn) this.drawFrame(idx);
    requestAnimationFrame(() => this.tick());
  }

  drawFrame(idx) {
    const img = this.frames[idx];
    if (!img) return;
    this._lastDrawn = idx;
    const cw = this.canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
    const ch = this.canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
    this.ctx.clearRect(0, 0, cw, ch);
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    this.ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
  }

  drawCurrent() {
    let idx = Math.round(this.currentFrame);
    if (this.step > 1) idx = Math.round(idx / this.step) * this.step;
    this.drawFrame(idx);
  }
}

/* ============================================================
   HERO TEXT REVEAL
   ============================================================ */
function initHeroReveal() {
  const items = document.querySelectorAll('.reveal-hero');
  setTimeout(() => {
    items.forEach((el, i) => {
      const delay = parseInt(el.dataset.delay || 0) * 150 + 400;
      setTimeout(() => el.classList.add('visible'), delay);
    });
  }, 800);

  // Hide scroll hint after scrolling
  const hint = document.getElementById('hero-scroll-hint');
  let hidden = false;
  window.addEventListener('scroll', () => {
    if (!hidden && window.scrollY > 200) {
      hint.classList.add('hidden');
      hidden = true;
    }
  }, { passive: true });
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

  // Scroll class
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 100);
  }, { passive: true });

  // Mobile toggle
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', links.classList.contains('open'));
  });

  // Smooth scroll nav links
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.getAttribute('href').replace('#', '');
      // If on project detail, go back first
      if (!document.getElementById('project-detail').classList.contains('hidden')) {
        closeProjectDetail();
        setTimeout(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
        }, 400);
      } else {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }
      // Close mobile menu
      toggle.classList.remove('open');
      links.classList.remove('open');
    });
  });

  // Logo click
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
    { name: 'Python', icon: 'Py' },
    { name: 'JavaScript', icon: 'JS' },
    { name: 'C++', icon: 'C+' },
    { name: 'Machine Learning', icon: 'ML' },
    { name: 'OpenCV', icon: 'CV' },
    { name: 'IoT', icon: 'IoT' },
    { name: 'Node.js', icon: 'NJ' },
    { name: 'SQL', icon: 'DB' },
    { name: 'Git', icon: 'Git' },
    { name: 'Linux', icon: 'Lx' }
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
   PROJECTS GRID
   ============================================================ */
function initProjects() {
  const grid = document.getElementById('projects-grid');

  projects.forEach((p, i) => {
    const card = document.createElement('article');
    card.className = 'project-card reveal';
    card.dataset.revealDelay = String(i * 120);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <span class="project-num">${p.num}</span>
      <h3>${p.title}</h3>
      <p>${p.short}</p>
      <div class="project-tags">${p.tags.map(t => `<span class="project-tag">${t}</span>`).join('')}</div>
      <div class="project-card-arrow">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M7 7h10v10"/></svg>
      </div>
    `;
    card.addEventListener('click', () => openProjectDetail(p.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openProjectDetail(p.id); });
    grid.appendChild(card);
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
    <div class="project-detail-hero">
      <div class="container">
        <button class="project-detail-back" id="detail-back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back to Portfolio
        </button>
        <h1 class="project-detail-title">${p.title}</h1>
        <p class="project-detail-subtitle">${p.overview}</p>
        <div class="project-detail-tags">${p.tags.map(t => `<span class="project-tag">${t}</span>`).join('')}</div>
      </div>
    </div>
    <div class="project-detail-body">
      <div class="container">
        <div class="project-section">
          <h3><span class="ps-icon">01</span> Problem Statement</h3>
          <p>${p.problem}</p>
        </div>
        <div class="project-section">
          <h3><span class="ps-icon">02</span> Solution</h3>
          <p>${p.solution}</p>
        </div>
        <div class="project-section">
          <h3><span class="ps-icon">03</span> Implementation</h3>
          <ul>${p.implementation.map(item => `<li>${item}</li>`).join('')}</ul>
        </div>
        <div class="project-section">
          <h3><span class="ps-icon">04</span> Tech Stack</h3>
          <div class="project-tech-grid">${p.techStack.map(t => `<span class="project-tech-item">${t}</span>`).join('')}</div>
        </div>
        <div class="project-section">
          <h3><span class="ps-icon">05</span> Outcomes & Impact</h3>
          <ul>${p.outcomes.map(item => `<li>${item}</li>`).join('')}</ul>
        </div>
      </div>
    </div>
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

  // Scroll to projects section
  setTimeout(() => {
    document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' });
  }, 50);
}

// Handle browser back button
window.addEventListener('popstate', () => {
  const hash = window.location.hash;
  if (hash.startsWith('#/project/')) {
    const id = hash.split('/').pop();
    openProjectDetail(id);
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
   HERO CONTENT PARALLAX ON SCROLL
   ============================================================ */
function initHeroParallax() {
  const content = document.getElementById('hero-content');
  const hero = document.getElementById('hero');

  window.addEventListener('scroll', () => {
    const rect = hero.getBoundingClientRect();
    const scrollable = hero.offsetHeight - window.innerHeight;
    const scrolled = -rect.top;
    const progress = Math.max(0, Math.min(1, scrolled / scrollable));

    // Fade out and move content as user scrolls through hero
    if (progress < 0.5) {
      const p = progress * 2; // 0-1 over first half
      content.style.opacity = 1 - p * 0.8;
      content.style.transform = `translateY(${-p * 60}px) scale(${1 - p * 0.05})`;
      content.style.filter = `blur(${p * 4}px)`;
    } else {
      content.style.opacity = 0.2;
      content.style.filter = 'blur(4px)';
    }
  }, { passive: true });
}

/* ============================================================
   INIT — on load, check hash for project detail
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  new FrameAnimator();
  initHeroReveal();
  initNavbar();
  initSkills();
  initProjects();
  initContactForm();
  initHeroParallax();

  // Delay scroll reveal to after loader
  setTimeout(() => initScrollReveal(), 1200);

  // Check if URL has a project hash
  const hash = window.location.hash;
  if (hash.startsWith('#/project/')) {
    const id = hash.split('/').pop();
    openProjectDetail(id);
  }
});
