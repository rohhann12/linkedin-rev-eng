/**
 * The playground page, inlined as a module rather than served from disk.
 *
 * Serverless bundlers and `npm ci --omit=dev` installs only ship files they can
 * see imported. A `public/` directory read at runtime is exactly the thing that
 * works locally and 404s in production, so the page lives in the module graph
 * where nothing can miss it.
 *
 * The embedded script uses string concatenation rather than template literals
 * on purpose: the whole document is itself a template literal, and a stray
 * backtick would terminate it.
 */
export const PLAYGROUND_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LinkedIn Profile API</title>
<style>
  :root {
    --paper:      #faf8f5;
    --card:       #ffffff;
    --ink:        #1c1a17;
    --ink-soft:   #57534e;
    --ink-faint:  #8b8580;
    --rule:       #e7e2da;
    --rule-soft:  #f0ece5;
    --accent:     #1a5c99;
    --accent-bg:  #eef4fa;
    --good:       #2f6f4f;
    --warn:       #9a5b12;
    --bad:        #a8402c;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper:      #16151a;
      --card:       #1d1c22;
      --ink:        #ece9e4;
      --ink-soft:   #a8a29a;
      --ink-faint:  #75706a;
      --rule:       #2f2d35;
      --rule-soft:  #26242b;
      --accent:     #6fa8dc;
      --accent-bg:  #1c2733;
      --good:       #63b58a;
      --warn:       #d9a441;
      --bad:        #d9705c;
    }
  }

  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 16px/1.6 var(--sans);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 960px; margin: 0 auto; padding: 56px 24px 96px; }

  /* ---------- masthead ---------- */
  header { border-bottom: 1px solid var(--rule); padding-bottom: 28px; margin-bottom: 32px; }
  h1 {
    font: 400 40px/1.1 var(--serif);
    letter-spacing: -0.015em;
    margin: 0 0 10px;
  }
  h1 em { font-style: italic; color: var(--accent); }
  .lede { margin: 0; color: var(--ink-soft); font-size: 16.5px; max-width: 62ch; }

  /* ---------- console ---------- */
  .console {
    background: var(--card);
    border: 1px solid var(--rule);
    border-radius: 12px;
    padding: 22px;
    margin-bottom: 28px;
  }
  label.field { display: block; }
  .label {
    font: 600 11px/1 var(--sans);
    letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-faint); margin-bottom: 8px;
  }
  input[type=text], input[type=password] {
    width: 100%; padding: 12px 14px;
    border: 1px solid var(--rule); border-radius: 8px;
    background: var(--paper); color: var(--ink);
    font: 14px var(--mono);
  }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .opts { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 16px; }
  .opt { display: flex; align-items: center; gap: 8px; font-size: 14.5px; color: var(--ink-soft); cursor: pointer; }
  .opt input { accent-color: var(--accent); width: 15px; height: 15px; }
  .actions { display: flex; gap: 14px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
  button.go {
    background: var(--ink); color: var(--paper); border: 0; border-radius: 8px;
    padding: 11px 26px; font: 600 14.5px var(--sans); cursor: pointer;
  }
  button.go:hover { opacity: .88; }
  button.go:disabled { opacity: .45; cursor: progress; }
  .timing { font: 12.5px var(--mono); color: var(--ink-faint); }

  /* ---------- run summary ---------- */
  .summary { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 22px; }
  .chip {
    font: 11.5px var(--mono); padding: 5px 11px; border-radius: 100px;
    border: 1px solid var(--rule); color: var(--ink-soft); background: var(--card);
  }
  .chip.good { color: var(--good); border-color: currentColor; }
  .chip.warn { color: var(--warn); border-color: currentColor; }
  .chip.bad  { color: var(--bad);  border-color: currentColor; }

  /* ---------- tabs ---------- */
  .tabs { display: flex; gap: 26px; border-bottom: 1px solid var(--rule); margin-bottom: 26px; }
  .tab {
    background: none; border: 0; padding: 0 0 11px; cursor: pointer;
    font: 600 13px var(--sans); letter-spacing: .05em; text-transform: uppercase;
    color: var(--ink-faint); border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tab[aria-selected=true] { color: var(--ink); border-bottom-color: var(--accent); }

  /* ---------- identity ---------- */
  .identity { display: flex; gap: 22px; align-items: flex-start; margin-bottom: 30px; }
  .avatar {
    width: 92px; height: 92px; border-radius: 50%; object-fit: cover;
    border: 1px solid var(--rule); flex: 0 0 auto; background: var(--rule-soft);
  }
  .avatar.blank { display: flex; align-items: center; justify-content: center;
                  font: 400 32px var(--serif); color: var(--ink-faint); }
  .who { min-width: 0; }
  .who h2 { font: 400 30px/1.15 var(--serif); margin: 2px 0 6px; letter-spacing: -0.01em; }
  .who .headline { color: var(--ink); font-size: 16px; margin: 0 0 8px; }
  .who .place { color: var(--ink-faint); font-size: 14px; margin: 0; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 11px; }
  .badge {
    font: 600 10.5px var(--sans); letter-spacing: .06em; text-transform: uppercase;
    padding: 4px 9px; border-radius: 4px; background: var(--accent-bg); color: var(--accent);
  }
  .stats { display: flex; gap: 20px; margin-top: 12px; font-size: 13.5px; color: var(--ink-soft); }
  .stats b { font-weight: 600; color: var(--ink); }

  /* ---------- sections ---------- */
  section.box {
    background: var(--card); border: 1px solid var(--rule);
    border-radius: 12px; padding: 24px 26px; margin-bottom: 18px;
  }
  section.box > h3 {
    font: 600 11.5px var(--sans); letter-spacing: .1em; text-transform: uppercase;
    color: var(--ink-faint); margin: 0 0 18px;
    display: flex; align-items: baseline; gap: 9px;
  }
  section.box > h3 .count {
    font: 11px var(--mono); color: var(--ink-faint);
    border: 1px solid var(--rule); border-radius: 100px; padding: 1px 7px;
  }
  .prose { font: 16px/1.7 var(--serif); color: var(--ink); white-space: pre-wrap; margin: 0; }

  .entry { display: flex; gap: 16px; padding: 16px 0; border-top: 1px solid var(--rule-soft); }
  .entry:first-of-type { border-top: 0; padding-top: 0; }
  .entry:last-child { padding-bottom: 0; }
  .logo {
    width: 42px; height: 42px; border-radius: 7px; object-fit: contain;
    border: 1px solid var(--rule-soft); background: var(--paper); flex: 0 0 auto;
  }
  .entry-body { min-width: 0; flex: 1; }
  .entry-title { font-weight: 600; font-size: 15.5px; margin: 0 0 3px; }
  .entry-sub { color: var(--ink-soft); font-size: 14.5px; margin: 0 0 3px; }
  .entry-meta { color: var(--ink-faint); font-size: 13px; margin: 0; font-variant-numeric: tabular-nums; }
  .entry-desc { margin: 9px 0 0; font: 14.5px/1.65 var(--sans); color: var(--ink-soft); white-space: pre-wrap; }
  .current { color: var(--good); font-weight: 600; }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .skill {
    font-size: 13.5px; padding: 6px 12px; border-radius: 100px;
    border: 1px solid var(--rule); color: var(--ink);
  }
  .skill span { color: var(--ink-faint); font: 11.5px var(--mono); margin-left: 5px; }

  .kv { display: grid; grid-template-columns: 150px 1fr; gap: 11px 20px; font-size: 14.5px; }
  .kv dt { color: var(--ink-faint); font-size: 12.5px; letter-spacing: .04em;
           text-transform: uppercase; font-weight: 600; padding-top: 2px; }
  .kv dd { margin: 0; word-break: break-word; }
  .kv a { color: var(--accent); }

  .post { padding: 16px 0; border-top: 1px solid var(--rule-soft); }
  .post:first-of-type { border-top: 0; padding-top: 0; }
  .post-head { display: flex; gap: 9px; align-items: baseline; flex-wrap: wrap; margin-bottom: 7px; }
  .post-author { font-weight: 600; font-size: 14.5px; }
  .post-when { font: 12px var(--mono); color: var(--ink-faint); }
  .repost { font: 600 10px var(--sans); letter-spacing: .07em; text-transform: uppercase;
            color: var(--warn); border: 1px solid currentColor; border-radius: 3px; padding: 1px 6px; }
  .post-text { margin: 0; font: 14.5px/1.65 var(--sans); color: var(--ink-soft); white-space: pre-wrap; }
  .engagement { display: flex; gap: 16px; margin-top: 9px; font: 12.5px var(--mono); color: var(--ink-faint); }

  .feature { display: block; padding: 13px 0; border-top: 1px solid var(--rule-soft); text-decoration: none; color: inherit; }
  .feature:first-of-type { border-top: 0; padding-top: 0; }
  .feature .t { font-weight: 600; font-size: 15px; color: var(--accent); }
  .feature .d { font-size: 14px; color: var(--ink-soft); margin-top: 3px; }

  pre {
    background: var(--card); border: 1px solid var(--rule); border-radius: 10px;
    padding: 20px; overflow-x: auto; font: 12.5px/1.6 var(--mono); margin: 0;
    max-height: 640px; color: var(--ink);
  }
  .empty { color: var(--ink-faint); font-size: 14.5px; font-style: italic; }
  .note { color: var(--ink-soft); font-size: 14px; margin: 0 0 10px; }
  .note code, .prov code { font: 12.5px var(--mono); color: var(--accent); }
  .prov { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 7px; font-size: 13px; }
  .prov div { display: flex; justify-content: space-between; gap: 10px;
              border-bottom: 1px dotted var(--rule); padding-bottom: 4px; }
  .prov b { font-weight: 600; color: var(--ink-faint); font: 11.5px var(--mono); }

  @media (max-width: 640px) {
    h1 { font-size: 31px; }
    .identity { flex-direction: column; gap: 16px; }
    .kv { grid-template-columns: 1fr; gap: 3px 0; }
    .kv dd { margin-bottom: 10px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>LinkedIn Profile <em>API</em></h1>
    <p class="lede">A profile URL in, structured JSON out. Extraction runs as a chain of
      strategies against LinkedIn's internal endpoints — each tier's contribution is
      attributed back to it.</p>
  </header>

  <div class="console">
    <label class="field">
      <span class="label">Profile URL</span>
      <input id="url" type="text" value="https://www.linkedin.com/in/williamhgates/"
             placeholder="https://www.linkedin.com/in/…" spellcheck="false" />
    </label>
    <div class="opts">
      <label class="opt"><input type="checkbox" id="deep" /> Deep — full section lists</label>
      <label class="opt"><input type="checkbox" id="contact" /> Contact info</label>
      <label class="opt"><input type="checkbox" id="activity" /> Activity</label>
      <label class="opt"><input type="checkbox" id="refresh" /> Bypass cache</label>
    </div>
    <label class="field" style="margin-top:16px">
      <span class="label">API key <span style="text-transform:none;letter-spacing:0">— only if this deployment sets API_KEYS</span></span>
      <input id="key" type="password" placeholder="x-api-key" />
    </label>
    <div class="actions">
      <button class="go" id="go">Resolve</button>
      <span class="timing" id="timing"></span>
    </div>
  </div>

  <div id="result" hidden>
    <div class="summary" id="summary"></div>
    <div class="tabs" role="tablist">
      <button class="tab" id="tab-profile" role="tab" aria-selected="true">Profile</button>
      <button class="tab" id="tab-json" role="tab" aria-selected="false">JSON</button>
    </div>
    <div id="view-profile"></div>
    <div id="view-json" hidden><pre id="json"></pre></div>
  </div>
</div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  /* LinkedIn stores no day on a position, so never render one. */
  function fmtDate(d) {
    if (!d || (!d.year && !d.month)) return null;
    if (d.month && d.year) return MONTHS[d.month - 1] + ' ' + d.year;
    return String(d.year || '');
  }

  function fmtRange(start, end, isCurrent) {
    var a = fmtDate(start);
    var b = fmtDate(end);
    if (!a && !b) return isCurrent ? 'Present' : null;
    if (a && !b) return a + ' — ' + (isCurrent ? '<span class="current">Present</span>' : 'Present');
    if (!a && b) return 'until ' + b;
    return a + ' — ' + b;
  }

  function firstImage(list) {
    return list && list.length ? list[0].url : null;
  }

  function box(title, count, inner) {
    if (!inner) return '';
    var badge = count != null ? '<span class="count">' + count + '</span>' : '';
    return '<section class="box"><h3>' + esc(title) + badge + '</h3>' + inner + '</section>';
  }

  /* ---------- section renderers ---------- */

  function renderIdentity(p) {
    var avatar = firstImage(p.images && p.images.avatar);
    var initial = (p.name && p.name.full ? p.name.full.trim()[0] : '?') || '?';
    var img = avatar
      ? '<img class="avatar" src="' + esc(avatar) + '" alt="" />'
      : '<div class="avatar blank">' + esc(initial) + '</div>';

    var badges = [];
    if (p.open_to_work) badges.push('Open to work');
    if (p.hiring) badges.push('Hiring');
    if (p.premium) badges.push('Premium');
    if (p.influencer) badges.push('Influencer');
    if (p.verified) badges.push('Verified');

    var stats = [];
    if (p.connections != null) stats.push('<b>' + p.connections + '</b> connections');
    if (p.followers != null) stats.push('<b>' + p.followers + '</b> followers');

    return '<div class="identity">' + img + '<div class="who">' +
      '<h2>' + esc((p.name && p.name.full) || p.public_identifier) + '</h2>' +
      (p.headline ? '<p class="headline">' + esc(p.headline) + '</p>' : '') +
      (p.location && p.location.raw ? '<p class="place">' + esc(p.location.raw) + '</p>' : '') +
      (badges.length ? '<div class="badges">' + badges.map(function (b) {
        return '<span class="badge">' + esc(b) + '</span>'; }).join('') + '</div>' : '') +
      (stats.length ? '<div class="stats">' + stats.join('') + '</div>' : '') +
      '</div></div>';
  }

  function renderExperience(rows) {
    if (!rows || !rows.length) return '';
    return rows.map(function (r) {
      var logo = firstImage(r.company && r.company.logo);
      var when = fmtRange(r.start, r.end, r.is_current);
      var meta = [when, r.duration, r.location].filter(Boolean).join(' &middot; ');
      var sub = [r.company && r.company.name, r.employment_type].filter(Boolean).join(' &middot; ');
      return '<div class="entry">' +
        (logo ? '<img class="logo" src="' + esc(logo) + '" alt="" />' : '<div class="logo"></div>') +
        '<div class="entry-body">' +
          '<p class="entry-title">' + esc(r.title || '—') + '</p>' +
          (sub ? '<p class="entry-sub">' + sub + '</p>' : '') +
          (meta ? '<p class="entry-meta">' + meta + '</p>' : '') +
          (r.description ? '<p class="entry-desc">' + esc(r.description) + '</p>' : '') +
        '</div></div>';
    }).join('');
  }

  function renderEducation(rows) {
    if (!rows || !rows.length) return '';
    return rows.map(function (r) {
      var logo = firstImage(r.logo);
      var sub = [r.degree, r.field_of_study].filter(Boolean).join(', ');
      var meta = [fmtRange(r.start, r.end, false), r.grade ? 'Grade: ' + r.grade : null]
        .filter(Boolean).join(' &middot; ');
      return '<div class="entry">' +
        (logo ? '<img class="logo" src="' + esc(logo) + '" alt="" />' : '<div class="logo"></div>') +
        '<div class="entry-body">' +
          '<p class="entry-title">' + esc(r.school || '—') + '</p>' +
          (sub ? '<p class="entry-sub">' + esc(sub) + '</p>' : '') +
          (meta ? '<p class="entry-meta">' + meta + '</p>' : '') +
          (r.description ? '<p class="entry-desc">' + esc(r.description) + '</p>' : '') +
        '</div></div>';
    }).join('');
  }

  function renderSkills(rows) {
    if (!rows || !rows.length) return '';
    return '<div class="chips">' + rows.map(function (s) {
      var n = s.endorsement_count != null ? '<span>' + s.endorsement_count + '</span>' : '';
      return '<span class="skill">' + esc(s.name) + n + '</span>';
    }).join('') + '</div>';
  }

  function renderSimple(rows, titleKey, subKeys, dateKey) {
    if (!rows || !rows.length) return '';
    return rows.map(function (r) {
      var sub = subKeys.map(function (k) { return r[k]; }).filter(Boolean).join(' &middot; ');
      var when = dateKey === 'range'
        ? fmtRange(r.start, r.end, false)
        : fmtDate(r[dateKey]);
      return '<div class="entry"><div class="entry-body">' +
        '<p class="entry-title">' + esc(r[titleKey] || '—') + '</p>' +
        (sub ? '<p class="entry-sub">' + esc(sub) + '</p>' : '') +
        (when ? '<p class="entry-meta">' + when + '</p>' : '') +
        (r.description ? '<p class="entry-desc">' + esc(r.description) + '</p>' : '') +
        (r.url ? '<p class="entry-meta"><a href="' + esc(r.url) + '" target="_blank" rel="noreferrer">' + esc(r.url) + '</a></p>' : '') +
      '</div></div>';
    }).join('');
  }

  function renderLanguages(rows) {
    if (!rows || !rows.length) return '';
    return '<dl class="kv">' + rows.map(function (l) {
      return '<dt>' + esc(l.name) + '</dt><dd>' + esc(l.proficiency || '—') + '</dd>';
    }).join('') + '</dl>';
  }

  function renderFeatured(rows) {
    if (!rows || !rows.length) return '';
    return rows.map(function (f) {
      var open = f.url ? '<a class="feature" href="' + esc(f.url) + '" target="_blank" rel="noreferrer">' : '<div class="feature">';
      var close = f.url ? '</a>' : '</div>';
      return open + '<div class="t">' + esc(f.title || f.url || 'Untitled') + '</div>' +
        (f.description ? '<div class="d">' + esc(f.description) + '</div>' : '') + close;
    }).join('');
  }

  function renderActivity(rows) {
    if (!rows || !rows.length) return '';
    return rows.map(function (a) {
      var when = a.posted_at ? new Date(a.posted_at).toLocaleDateString(undefined,
        { year: 'numeric', month: 'short', day: 'numeric' }) : null;
      var counts = [];
      if (a.reactions != null) counts.push(a.reactions + ' reactions');
      if (a.comments != null) counts.push(a.comments + ' comments');
      if (a.shares != null) counts.push(a.shares + ' shares');
      return '<div class="post">' +
        '<div class="post-head">' +
          (a.author ? '<span class="post-author">' + esc(a.author) + '</span>' : '') +
          (a.is_repost ? '<span class="repost">repost</span>' : '') +
          (when ? '<span class="post-when">' + esc(when) + '</span>' : '') +
        '</div>' +
        (a.text ? '<p class="post-text">' + esc(a.text) + '</p>' : '<p class="empty">No text</p>') +
        (counts.length || a.url
          ? '<div class="engagement">' +
            counts.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') +
            (a.url ? '<a href="' + esc(a.url) + '" target="_blank" rel="noreferrer" style="color:var(--accent)">view</a>' : '') +
            '</div>'
          : '') +
      '</div>';
    }).join('');
  }

  function renderContact(c) {
    if (!c) return '';
    var rows = [];
    if (c.email) rows.push(['Email', '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>']);
    (c.phones || []).forEach(function (p) {
      rows.push([p.type || 'Phone', esc(p.number)]);
    });
    (c.websites || []).forEach(function (w) {
      rows.push([w.label || 'Website', '<a href="' + esc(w.url) + '" target="_blank" rel="noreferrer">' + esc(w.url) + '</a>']);
    });
    (c.twitter || []).forEach(function (t) { rows.push(['Twitter', esc(t)]); });
    if (c.birthday && c.birthday.month) {
      rows.push(['Birthday', esc(MONTHS[c.birthday.month - 1] + ' ' + (c.birthday.day || ''))]);
    }
    if (c.address) rows.push(['Address', esc(c.address)]);
    if (c.connected_at && c.connected_at.year) {
      rows.push(['Connected', esc(fmtDate(c.connected_at))]);
    }
    if (!rows.length) return '';
    return '<dl class="kv">' + rows.map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl>';
  }

  function renderProvenance(meta) {
    var prov = meta.field_provenance || {};
    var keys = Object.keys(prov);
    var inner = '';

    inner += '<p class="note">Each field is attributed to the strategy that produced it. ' +
      'Cache <code>' + esc(meta.cache) + '</code>' +
      (meta.partial ? ' &middot; <code>partial</code>' : '') + '.</p>';

    if (keys.length) {
      inner += '<div class="prov">' + keys.sort().map(function (k) {
        return '<div><span>' + esc(k) + '</span><b>' + esc(prov[k]) + '</b></div>';
      }).join('') + '</div>';
    }

    if (meta.warnings && meta.warnings.length) {
      inner += '<p class="note" style="margin-top:14px;color:var(--warn)">' +
        meta.warnings.map(esc).join('<br />') + '</p>';
    }
    return inner;
  }

  /* ---------- assembly ---------- */

  function renderProfile(body) {
    var p = body.profile;
    var html = renderIdentity(p);

    html += box('About', null, p.about ? '<p class="prose">' + esc(p.about) + '</p>' : '');
    html += box('Experience', (p.experience || []).length || null, renderExperience(p.experience));
    html += box('Education', (p.education || []).length || null, renderEducation(p.education));
    html += box('Skills', (p.skills || []).length || null, renderSkills(p.skills));
    html += box('Licenses & certifications', (p.certifications || []).length || null,
      renderSimple(p.certifications, 'name', ['authority', 'license_number'], 'range'));
    html += box('Languages', (p.languages || []).length || null, renderLanguages(p.languages));
    html += box('Projects', (p.projects || []).length || null,
      renderSimple(p.projects, 'name', [], 'range'));
    html += box('Honors & awards', (p.honors || []).length || null,
      renderSimple(p.honors, 'title', ['issuer'], 'date'));
    html += box('Volunteering', (p.volunteering || []).length || null,
      renderSimple(p.volunteering, 'role', ['organization', 'cause'], 'range'));
    html += box('Publications', (p.publications || []).length || null,
      renderSimple(p.publications, 'name', ['publisher'], 'date'));
    html += box('Featured', (p.featured || []).length || null, renderFeatured(p.featured));
    html += box('Activity', (p.activity || []).length || null, renderActivity(p.activity));
    html += box('Contact info', null, renderContact(p.contact_info));
    html += box('Provenance', null, renderProvenance(body.meta));

    return html;
  }

  function renderError(body, statusCode) {
    var e = (body && body.error) || {};
    return '<section class="box">' +
      '<h3>Request failed</h3>' +
      '<p class="entry-title" style="color:var(--bad)">' + esc(e.code || ('HTTP ' + statusCode)) + '</p>' +
      '<p class="note">' + esc(e.message || 'No message.') + '</p>' +
      (e.retryable ? '<p class="note"><em>Retryable.</em></p>' : '') +
      (e.details ? '<pre style="margin-top:12px">' + esc(JSON.stringify(e.details, null, 2)) + '</pre>' : '') +
    '</section>';
  }

  function renderSummary(body, statusCode) {
    var chips = [];
    chips.push(chip('HTTP ' + statusCode, statusCode === 200 ? 'good' : 'bad'));

    if (body && body.meta) {
      (body.meta.strategies || []).forEach(function (s) {
        var tone = s.status === 'ok' ? 'good' : s.status === 'error' ? 'bad' : '';
        chips.push(chip(s.name + ' · ' + s.status + ' · ' + s.duration_ms + 'ms', tone));
      });
      chips.push(chip('cache ' + body.meta.cache));
      if (body.meta.partial) chips.push(chip('partial', 'warn'));
    }
    if (body && body.error) chips.push(chip(body.error.code, 'bad'));
    return chips.join('');
  }

  function chip(text, tone) {
    return '<span class="' + (tone ? 'chip ' + tone : 'chip') + '">' + esc(text) + '</span>';
  }

  /* ---------- interaction ---------- */

  function selectTab(which) {
    var isProfile = which === 'profile';
    $('tab-profile').setAttribute('aria-selected', String(isProfile));
    $('tab-json').setAttribute('aria-selected', String(!isProfile));
    $('view-profile').hidden = !isProfile;
    $('view-json').hidden = isProfile;
  }

  async function run() {
    var button = $('go');
    button.disabled = true;
    $('timing').textContent = 'resolving…';

    var params = new URLSearchParams({ url: $('url').value.trim() });
    if ($('deep').checked) params.set('deep', 'true');
    if ($('refresh').checked) params.set('refresh', 'true');

    var includes = [];
    if ($('contact').checked) includes.push('contact');
    if ($('activity').checked) includes.push('activity');
    if (includes.length) params.set('include', includes.join(','));

    var headers = {};
    var key = $('key').value.trim();
    if (key) headers['x-api-key'] = key;

    var startedAt = performance.now();
    try {
      var response = await fetch('/v1/profile?' + params.toString(), { headers: headers });
      var body = await response.json();
      var elapsed = Math.round(performance.now() - startedAt);

      $('result').hidden = false;
      $('timing').textContent = elapsed + ' ms';
      $('summary').innerHTML = renderSummary(body, response.status);
      $('json').textContent = JSON.stringify(body, null, 2);
      $('view-profile').innerHTML = response.ok && body.profile
        ? renderProfile(body)
        : renderError(body, response.status);
      selectTab('profile');
    } catch (err) {
      $('result').hidden = false;
      $('summary').innerHTML = chip('network error', 'bad');
      $('view-profile').innerHTML = '<section class="box"><h3>Request failed</h3>' +
        '<p class="note">' + esc(String(err)) + '</p></section>';
      $('json').textContent = String(err);
      $('timing').textContent = '';
    } finally {
      button.disabled = false;
    }
  }

  $('go').addEventListener('click', run);
  $('url').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
  $('tab-profile').addEventListener('click', function () { selectTab('profile'); });
  $('tab-json').addEventListener('click', function () { selectTab('json'); });
})();
</script>
</body>
</html>`;
