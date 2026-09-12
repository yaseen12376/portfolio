/**
 * Contact: copy-to-clipboard email, and a validated form.
 *
 * The form posts to a real endpoint when VITE_CONTACT_ENDPOINT is configured;
 * without one it hands off to the visitor's mail client rather than faking a
 * success message and discarding what they wrote.
 */
import { gsap, revealOnScroll } from '../core/motion.js';
import { profile } from '../data/profile.js';
import { esc, icons } from '../core/util.js';

export function initContact() {
  const section = document.querySelector('#contact');
  if (!section) return;
  revealOnScroll('#contact .contact-copy, #contact .form-shell');
  initCopy(section);
  initForm(section);
}

function initCopy(section) {
  const btn = section.querySelector('#copy-email');
  if (!btn) return;
  let timer;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(profile.email);
    } catch {
      // Clipboard blocked (insecure context, permissions): select the address
      // so a manual copy is one keystroke away.
      const link = section.querySelector('.email-link');
      const range = document.createRange();
      range.selectNodeContents(link);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    btn.classList.add('is-done');
    btn.innerHTML = icons.check;
    btn.setAttribute('aria-label', 'Email address copied');
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.classList.remove('is-done');
      btn.innerHTML = icons.copy;
      btn.setAttribute('aria-label', 'Copy email address');
    }, 2200);
  });
}

const RULES = {
  name: (v) => (v.trim() ? '' : 'Please add your name.'),
  email: (v) =>
    !v.trim() ? 'Please add your email.' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'That email address looks incomplete.',
  message: (v) => (v.trim().length >= 10 ? '' : 'A sentence or two helps me reply properly.'),
};

function initForm(section) {
  const form = section.querySelector('#contact-form');
  const feedback = section.querySelector('#form-feedback');
  const submit = section.querySelector('#form-submit');
  const label = submit?.querySelector('.btn-label');
  if (!form) return;

  const endpoint = import.meta.env?.VITE_CONTACT_ENDPOINT;
  if (endpoint) form.setAttribute('action', endpoint);

  const check = (input) => {
    const msg = RULES[input.name]?.(input.value) ?? '';
    const field = input.closest('.field');
    field.classList.toggle('has-error', Boolean(msg));
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    field.querySelector('.field-error').textContent = msg;
    return !msg;
  };

  // Validate on blur once touched, and clear as soon as the value is fixed.
  form.querySelectorAll('input, textarea').forEach((input) => {
    input.addEventListener('blur', () => input.value && check(input));
    input.addEventListener('input', () => input.closest('.field').classList.contains('has-error') && check(input));
  });

  const say = (html, ok = true) => {
    feedback.innerHTML = html;
    feedback.classList.toggle('is-error', !ok);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = [...form.querySelectorAll('input, textarea')];
    const invalid = inputs.filter((i) => !check(i));
    if (invalid.length) {
      // A field that needs attention says so twice: in words, and by moving.
      invalid.forEach((input, i) =>
        gsap.fromTo(
          input.closest('.field'),
          { x: -7 },
          { x: 0, duration: 0.55, ease: 'elastic.out(1, 0.45)', delay: i * 0.04 }
        )
      );
      invalid[0].focus();
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    if (label) label.textContent = 'Sending';

    try {
      if (endpoint) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new FormData(form),
        });
        if (!res.ok) throw new Error(res.statusText);
        say('Message sent. I’ll get back to you within a couple of days.');
        form.reset();
        gsap.fromTo(submit, { scale: 0.96 }, { scale: 1, duration: 0.7, ease: 'back.out(2.2)' });
        gsap.fromTo(feedback, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.5 });
      } else {
        const subject = encodeURIComponent(`Portfolio enquiry from ${data.name}`);
        const body = encodeURIComponent(`${data.message}\n\nFrom: ${data.name} (${data.email})`);
        window.location.href = `mailto:${profile.email}?subject=${subject}&body=${body}`;
        say('Opening your mail app with the message filled in.');
      }
    } catch {
      say(
        `That didn’t send. Email me directly at <a href="mailto:${esc(profile.email)}">${esc(profile.email)}</a>.`,
        false
      );
    } finally {
      submit.disabled = false;
      if (label) label.textContent = 'Send message';
    }
  });
}
