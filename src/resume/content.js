/**
 * The résumé's content, in reading order, built from the site's own data.
 *
 * Pure (no DOM), so three things can share it: the résumé page
 * (src/resume/main.js) that lays it out, the generator that prints it
 * (scripts/gen-resume.mjs), and the build's staleness guard (vite.config.js),
 * which hashes exactly what the PDF prints and nothing else.
 *
 * Blanks ('TODO_') are left out here, so nothing downstream has to know
 * about them.
 */
import { profile } from '../data/profile.js';
import { experience } from '../data/experience.js';
import { skillGroups } from '../data/skills.js';
import { projects } from '../data/projects.js';
import { resume } from '../data/resume.js';

export const SITE = 'https://sheikahmedyaseen.com';

const blank = (v) => v == null || String(v).trim() === '' || String(v).includes('TODO_');
const shortTitle = (p) => p.title.split(':')[0];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

/** When a project ran: its months when known ("Nov 2026", "Jul 2026 - Nov 2026"), else its year. */
export function when(p) {
  if (p.period?.from) {
    const a = month(p.period.from);
    const b = p.period.to ? month(p.period.to) : 'Present';
    return a === b ? a : `${a} - ${b}`;
  }
  return String(p.year ?? '');
}

/**
 * Everything the résumé prints. `phone` exists only while it is printed:
 * scripts/gen-resume.mjs reads it from the git-ignored resume.local.json and
 * hands it to the page, so the PDF carries it and the site never does.
 */
export function resumeModel({ phone = null } = {}) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const site = SITE.replace(/^https:\/\//, '');
  const edu = experience.find((e) => e.kind === 'education');

  return {
    name: profile.name,
    role: profile.role,
    location: profile.location,
    contact: [
      { label: profile.email, href: `mailto:${profile.email}` },
      ...(phone ? [{ label: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` }] : []),
      { label: profile.linkedinLabel, href: profile.linkedin },
      { label: profile.githubLabel, href: profile.github },
      { label: site, href: `${SITE}/` },
    ],
    summary: resume.summary,
    skills: skillGroups.map((g) => ({ label: g.label, items: g.items.map((i) => i.name) })),
    // The work itself is told once, under Projects: a role lists the projects
    // it produced, and keeps only the points that belong to no project.
    experience: experience
      .filter((e) => e.kind === 'work')
      .map((e) => ({
        org: e.org,
        role: e.role,
        when: e.period,
        points: e.points.filter((pt) => !pt.project).map((pt) => pt.body),
        projects: e.points.filter((pt) => byId.has(pt.project)).map((pt) => shortTitle(byId.get(pt.project))),
      })),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      href: `${SITE}/project/${p.id}/`,
      when: when(p),
      meta: [p.kind, p.role].filter((x) => !blank(x)),
      stack: p.techStack.slice(0, 7),
      bullets: (resume.bullets[p.id] ?? [p.short]).filter((b) => !blank(b)),
    })),
    education: edu
      ? {
          school: edu.org,
          degree: edu.role,
          when: edu.period,
          cgpa: blank(resume.education.cgpa) ? null : resume.education.cgpa,
          coursework: blank(resume.education.coursework) ? null : resume.education.coursework,
        }
      : null,
    certifications: resume.certifications.filter((c) => !blank(c.name) && !blank(c.issuer) && !blank(c.year)),
    languages: profile.languages,
  };
}
