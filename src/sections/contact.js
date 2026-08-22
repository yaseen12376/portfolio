/**
 * Contact section.
 *
 * The form posts to a real endpoint when VITE_CONTACT_ENDPOINT is configured;
 * without one it degrades to opening the user's mail client rather than the
 * previous behaviour, which faked a success message after a 1.2s timeout and
 * silently discarded the message.
 */
import { gsap, EASE, DUR, revealChars, revealBatch } from '../core/motion.js';
import { profile } from '../data/profile.js';

let split = null;

export function initContact({ reduced }) {
  const section = document.querySelector('#contact');
  if (!section) return;

  if (!reduced) {
    split?.revert();
    const heading = section.querySelector('.contact-shout');
    if (heading) split = revealChars(heading, { stagger: 0.018 });
  }

  revealBatch('#contact .contact-link', { stagger: 0.08 });
  revealBatch('#contact .form-group, #contact #form-submit', { stagger: 0.07, y: 26 });

  initForm(section);
}

function initForm(section) {
  const form = section.querySelector('#contact-form');
  const feedback = section.querySelector('#form-feedback');
  const submit = section.querySelector('#form-submit');
  if (!form) return;

  const endpoint = import.meta.env?.VITE_CONTACT_ENDPOINT;
  if (endpoint) form.setAttribute('action', endpoint);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const say = (msg, ok = true) => {
      feedback.innerHTML = ok ? `<span class="form-success-check">✓</span> ${msg}` : msg;
      feedback.classList.toggle('is-error', !ok);
      gsap.fromTo(feedback, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: DUR.fast });
    };

    submit.disabled = true;
    submit.textContent = 'Sending…';

    try {
      if (endpoint) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new FormData(form),
        });
        if (!res.ok) throw new Error(res.statusText);
        say('Message sent. I’ll get back to you shortly.');
        form.reset();
      } else {
        // No backend configured — hand off to the mail client so the message
        // actually reaches a human instead of vanishing.
        const subject = encodeURIComponent(`Portfolio enquiry from ${data.name || 'someone'}`);
        const body = encodeURIComponent(`${data.message || ''}\n\n— ${data.name || ''} (${data.email || ''})`);
        window.location.href = `mailto:${profile.email}?subject=${subject}&body=${body}`;
        say('Opening your mail app…');
      }
    } catch {
      say(
        `Could not send. Email me directly at <a href="mailto:${profile.email}">${profile.email}</a>.`,
        false
      );
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send Message';
      gsap.fromTo(submit, { scale: 0.98 }, { scale: 1, duration: DUR.fast, ease: EASE.spring });
    }
  });
}
