import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { Profile } from '../../schema.js';
import { compact, dedupe, splitLocation } from '../normalize/helpers.js';

/**
 * Strategy of last resort: parse the rendered DOM.
 *
 * This runs only when a page came back with no embedded JSON at all — a
 * client-rendered shell, or a section LinkedIn no longer pre-fetches. It reuses
 * HTML the embedded strategy already downloaded, so it costs no extra requests.
 *
 * Two things make DOM parsing of LinkedIn go wrong, and both are handled here:
 *
 *  1. **Every visible string is rendered twice.** LinkedIn emits
 *     `<span aria-hidden="true">Google</span>` for sighted users and a
 *     `<span class="visually-hidden">Google</span>` twin for screen readers.
 *     Walking all text nodes therefore yields each value doubled, and any
 *     parser that reads fields by index (`values[0]`, `values[1]`) silently
 *     lands on the wrong ones. Selecting `[aria-hidden="true"]` exclusively is
 *     what makes the sequence match what a human sees.
 *  2. **Positions are not labelled.** An entry is an ordered pile of strings
 *     with no class that says "this one is the date range". So rather than
 *     trusting order, each line is *classified* — date ranges and durations
 *     have recognisable shapes, and what survives is the title and employer.
 *
 * Accuracy here is lower than the JSON strategies by construction. That is why
 * it is last, and why `meta.field_provenance` reports when it was used.
 */

const SECTION_ANCHORS = {
  experience: 'experience',
  education: 'education',
  skills: 'skills',
  certifications: 'licenses_and_certifications',
  languages: 'languages',
  projects: 'projects',
  honors: 'honors_and_awards',
  volunteering: 'volunteering_experience',
  publications: 'publications',
} as const;

const MONTHS =
  '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
const DATE_RANGE = new RegExp(`(?:${MONTHS}\\s+)?\\d{4}\\s*[-–—]\\s*(?:Present|(?:${MONTHS}\\s+)?\\d{4})`, 'i');
const DURATION = /\b\d+\s*(?:yr|year|mo|month)s?\b/i;
const EMPLOYMENT_TYPE =
  /\b(Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Apprenticeship|Seasonal|Permanent)\b/i;
const ENDORSEMENTS = /^\d[\d,]*\s+endorsement/i;

export function normalizeDom(html: string, publicIdentifier: string): Partial<Profile> {
  const $ = cheerio.load(html);
  const out: Partial<Profile> = {};

  const name = text($, $('h1').first());
  const headline = text($, $('div.text-body-medium.break-words').first());
  const locationRaw = text($, $('span.text-body-small.inline.t-black--light').first());

  if (name) {
    const [first = null, ...rest] = name.split(/\s+/);
    out.name = {
      first,
      last: rest.length > 0 ? rest.join(' ') : null,
      full: name,
      pronouns: null,
    };
  }

  if (headline) out.headline = headline;

  if (locationRaw) {
    const { city, country } = splitLocation(locationRaw);
    out.location = { raw: locationRaw, city, country, country_code: null };
  }

  const about = sectionOf($, 'about');
  if (about) {
    const aboutText = text($, about.find('.inline-show-more-text span[aria-hidden="true"]').first());
    if (aboutText) out.about = aboutText;
  }

  const avatar = $('img.pv-top-card-profile-picture__image--show, img.pv-top-card-profile-picture__image').first().attr('src');
  const banner = $('img.profile-background-image__image').first().attr('src');
  if (avatar || banner) {
    out.images = {
      avatar: avatar ? [{ url: avatar, width: null, height: null }] : [],
      banner: banner ? [{ url: banner, width: null, height: null }] : [],
    };
  }

  const experience = entriesOf($, 'experience').map((lines) => {
    const dates = lines.find((line) => DATE_RANGE.test(line)) ?? null;
    const rest = lines.filter((line) => line !== dates);
    const employmentLine = rest.find((line) => EMPLOYMENT_TYPE.test(line)) ?? null;
    const facts = rest.filter((line) => !DURATION.test(line));

    const title = facts[0] ?? null;
    const companyLine = facts[1] ?? null;
    const company = companyLine ? (companyLine.split('·')[0]?.trim() ?? null) : null;

    return {
      title,
      company: { name: company, urn: null, public_identifier: null, logo: [] },
      employment_type: employmentLine
        ? (EMPLOYMENT_TYPE.exec(employmentLine)?.[1] ?? null)
        : null,
      // The location line sits after the dates and carries no digits.
      location: facts.slice(2).find((line) => line.includes(',') && !/\d{4}/.test(line)) ?? null,
      description: facts.length > 3 ? (facts[facts.length - 1] ?? null) : null,
      start: null,
      end: null,
      duration: rest.find((line) => DURATION.test(line)) ?? null,
      is_current: dates ? /Present/i.test(dates) : false,
      skills: [],
    };
  });
  if (experience.length > 0) {
    out.experience = dedupe(compact(experience, ['title']), (row) =>
      [row.title, row.company.name].join('|'),
    );
  }

  const education = entriesOf($, 'education').map((lines) => {
    const dates = lines.find((line) => DATE_RANGE.test(line) || /^\d{4}$/.test(line)) ?? null;
    const facts = lines.filter((line) => line !== dates);
    const degreeLine = facts[1] ?? null;
    const [degree = null, field = null] = degreeLine
      ? degreeLine.split(',').map((part) => part.trim())
      : [];

    return {
      school: facts[0] ?? null,
      school_urn: null,
      degree,
      field_of_study: field,
      grade: null,
      description: null,
      activities: null,
      start: null,
      end: null,
      logo: [],
    };
  });
  if (education.length > 0) {
    out.education = dedupe(compact(education, ['school']), (row) => String(row.school));
  }

  const skills = entriesOf($, 'skills')
    .map((lines) => lines.find((line) => !ENDORSEMENTS.test(line)) ?? null)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ name, endorsement_count: null }));
  if (skills.length > 0) out.skills = dedupe(skills, (row) => row.name.toLowerCase());

  const certifications = entriesOf($, 'certifications').map((lines) => ({
    name: lines[0] ?? null,
    authority: lines[1] ?? null,
    license_number:
      lines.find((line) => /Credential ID/i.test(line))?.replace(/^.*Credential ID\s*/i, '') ?? null,
    url: null,
    start: null,
    end: null,
  }));
  if (certifications.length > 0) out.certifications = compact(certifications, ['name']);

  const languages = entriesOf($, 'languages').map((lines) => ({
    name: lines[0] ?? '',
    proficiency: lines[1] ?? null,
  }));
  const usableLanguages = languages.filter((row) => row.name.length > 0);
  if (usableLanguages.length > 0) out.languages = usableLanguages;

  const projects = entriesOf($, 'projects').map((lines) => ({
    name: lines[0] ?? null,
    description: lines.length > 2 ? (lines[lines.length - 1] ?? null) : null,
    url: null,
    start: null,
    end: null,
  }));
  if (projects.length > 0) out.projects = compact(projects, ['name']);

  const honors = entriesOf($, 'honors').map((lines) => ({
    title: lines[0] ?? null,
    issuer: lines[1] ?? null,
    description: lines.length > 2 ? (lines[lines.length - 1] ?? null) : null,
    date: null,
  }));
  if (honors.length > 0) out.honors = compact(honors, ['title']);

  const volunteering = entriesOf($, 'volunteering').map((lines) => ({
    role: lines[0] ?? null,
    organization: lines[1] ?? null,
    cause: null,
    description: lines.length > 3 ? (lines[lines.length - 1] ?? null) : null,
    start: null,
    end: null,
  }));
  if (volunteering.length > 0) out.volunteering = compact(volunteering, ['role', 'organization']);

  const publications = entriesOf($, 'publications').map((lines) => ({
    name: lines[0] ?? null,
    publisher: lines[1] ?? null,
    description: lines.length > 2 ? (lines[lines.length - 1] ?? null) : null,
    url: null,
    date: null,
  }));
  if (publications.length > 0) out.publications = compact(publications, ['name']);

  if (Object.keys(out).length > 0) out.public_identifier = publicIdentifier;
  return out;
}

/**
 * Parse the contact-info overlay. Served at its own URL
 * (`/in/<slug>/overlay/contact-info/`), so no browser interaction is needed to
 * open it — the modal markup is in the response body.
 */
export function normalizeContactDom(html: string): Partial<Profile>['contact_info'] {
  const $ = cheerio.load(html);
  const modal = $('section.pv-contact-info, .artdeco-modal__content, .pv-profile-section').first();
  const scope = modal.length > 0 ? modal : $('body');

  const emails: string[] = [];
  const phones: { number: string; type: string | null }[] = [];
  const websites: { url: string; label: string | null }[] = [];
  const twitter: string[] = [];

  scope.find('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) emails.push(href.replace(/^mailto:/, ''));
  });

  scope.find('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) phones.push({ number: href.replace(/^tel:/, ''), type: null });
  });

  // Each entry is a labelled block: a heading naming the kind, then the value.
  scope.find('section.pv-contact-info__contact-type, li').each((_, el) => {
    const block = $(el);
    const label = text($, block.find('h3').first())?.toLowerCase() ?? '';
    const href = block.find('a[href]').first().attr('href');
    const value = text($, block.find('span, a').last());

    if (label.includes('phone') && value && !phones.some((p) => p.number === value)) {
      phones.push({ number: value, type: text($, block.find('.t-14.t-black--light').first()) });
    }
    if (label.includes('twitter') && (href || value)) {
      twitter.push((href ?? value ?? '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, ''));
    }
    if (label.includes('website') && href) {
      websites.push({ url: href, label: text($, block.find('.t-14.t-black--light').first()) });
    }
  });

  const hasAnything = emails.length || phones.length || websites.length || twitter.length;
  if (!hasAnything) return null;

  return {
    email: emails[0] ?? null,
    phones,
    websites: dedupe(websites, (row) => row.url),
    twitter: dedupe(twitter, (row) => row),
    instant_messengers: [],
    birthday: null,
    address: null,
    connected_at: null,
  };
}

/** The `<section>` wrapping a profile anchor such as `<div id="experience">`. */
function sectionOf($: CheerioAPI, anchor: string) {
  const node = $(`div#${anchor}`).first();
  if (node.length === 0) return null;
  const section = node.closest('section');
  return section.length > 0 ? section : null;
}

/**
 * One entry per list item, each reduced to its visible lines in document order
 * with consecutive repeats collapsed. Works for both the profile page and the
 * `/details/*` pages, whose markup differs only in the wrapper.
 */
function entriesOf($: CheerioAPI, key: keyof typeof SECTION_ANCHORS): string[][] {
  const section = sectionOf($, SECTION_ANCHORS[key]);
  // The `/details/*` pages have no anchor div — the list is the whole page.
  const scope = section ?? $('main');
  if (scope.length === 0) return [];

  const items = scope.find('li.artdeco-list__item, li.pvs-list__paged-list-item');
  const entries: string[][] = [];

  items.each((_, element) => {
    const lines = visibleLines($, element);
    if (lines.length > 0) entries.push(lines);
  });

  return entries;
}

function visibleLines($: CheerioAPI, element: Element): string[] {
  const lines: string[] = [];

  $(element)
    .find('span[aria-hidden="true"]')
    .each((_, span) => {
      const value = text($, $(span));
      // Nested spans repeat their parent's text; drop consecutive duplicates.
      if (value && value !== lines[lines.length - 1]) lines.push(value);
    });

  return lines;
}

function text($: CheerioAPI, node: cheerio.Cheerio<Element>): string | null {
  if (!node || node.length === 0) return null;
  const value = node.text().replace(/\s+/g, ' ').trim();
  return value.length > 0 ? value : null;
}
