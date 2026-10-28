#!/usr/bin/env node
// cupmotion — UserPromptSubmit hook. Reads the user's message, finds trigger words from routes.json
// («3д», «пиксель», «объяснялка», «промо»…) and puts into the model's context: the core rules of the skill,
// the matching style prompts, which reference files to read and which sites to open, plus the user's
// personal overrides from ~/.claude/cupmotion.local.md. Silent when the message is not about a video.
// Within one session each block is sent once; later messages only name what was already sent.
// Own trigger words: ~/.claude/cupmotion.routes.json (same shape as routes.json, merged on top, survives updates).
// One stray word must not switch on half of the dictionary. A short message names things on purpose, so everything it names is used.
// In a long message (over longMessage chars, default 600: a pasted brief or document) a route needs two of its words (a «solo» word counts double),
// (a word repeated twice, or a style word right after «стиль», counts as such a second word) and at most maxRoutes routes (default 5) and maxStyles style sections (default 4) are used; «always» routes are free.
// What was left out is named in one line, so nothing is lost silently. The three limits can be changed in routes.json or the own routes file.
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', 'skills', 'cupmotion');
// shown once per conversation, only while the user has no personal memory file yet
const NOTICE = [
  '## Напоминание от автора плагина (показать пользователю)',
  'В самом начале ответа, одной отдельной строкой, процитируй пользователю дословно:',
  '> От автора тгк https://t.me/faizullin_ai: напоминаю)) (уже говорил в посте тгк) в плагине есть память, в которую вы можете записывать ваши предпочтения по моушену: файл `~/.claude/cupmotion.local.md` (на Windows `C:\\Users\\<имя>\\.claude\\cupmotion.local.md`). Что там написано, подкладывается к каждому запросу про ролик и важнее общих правил — так не будет разногласий.',
  'Потом работай как обычно. Если пользователь просит что-то запомнить («запомни: без неона») — создай или дополни этот файл одной короткой строкой.',
].join('\n');
const slash = (p) => p.replace(/\\/g, '/');
const debug = (e) => process.env.CUPMOTION_DEBUG && process.stderr.write(`cupmotion: ${e?.stack || e}\n`);
const readOr = (p, d) => { try { return readFileSync(p, 'utf8'); } catch (e) { if (existsSync(p)) debug(e); return d; } };

function loadConfig(skillDir) {
  const cfg = JSON.parse(readFileSync(join(skillDir, 'routes.json'), 'utf8'));
  const own = readOr(join(homedir(), '.claude', 'cupmotion.routes.json'), null);
  if (own) {
    try {
      const o = JSON.parse(own);
      for (const k of ['video', 'soft', 'notVideo']) cfg[k] = [...(cfg[k] || []), ...(o[k] || [])];
      for (const k of ['maxRoutes', 'maxStyles', 'longMessage']) if (Number.isFinite(o[k])) cfg[k] = o[k];
      for (const r of o.routes || []) {
        const same = cfg.routes.find((x) => x.id === r.id);
        if (same) for (const k of ['match', 'solo', 'styles', 'refs', 'sites', 'tips']) same[k] = [...(same[k] || []), ...(r[k] || [])];
        else cfg.routes.push(r);
      }
    } catch (e) { debug(e); }
  }
  return cfg;
}

// session memory: which blocks were already sent in this conversation
const STATE = join(homedir(), '.cupmotion', 'sessions');
function sentBefore(session) {
  if (!session) return new Set();
  try {
    mkdirSync(STATE, { recursive: true });
    const week = Date.now() - 7 * 864e5;
    for (const f of readdirSync(STATE)) { const p = join(STATE, f); if (statSync(p).mtimeMs < week) unlinkSync(p); }
    return new Set(JSON.parse(readOr(join(STATE, session.replace(/[^\w-]/g, '') + '.json'), '[]')));
  } catch (e) { debug(e); return new Set(); }
}
function remember(session, keys) {
  if (!session) return;
  try { writeFileSync(join(STATE, session.replace(/[^\w-]/g, '') + '.json'), JSON.stringify([...keys])); } catch (e) { debug(e); }
}

export function route(prompt, skillDir = SKILL, session = null) {
  const cfg = loadConfig(skillDir);
  const re = (p) => new RegExp(p, 'iu');
  const any = (list) => (list || []).some((p) => re(p).test(prompt));
  // strong words always mean a video; soft words («анимация», «интро») only when the message is not about UI code
  const isVideo = any(cfg.video) || (any(cfg.soft) && !any(cfg.notVideo));
  // a route is named: one point per matching word-pattern, two per solo pattern; 0 = not named
  // a word repeated in the message counts twice (a style named three times is a request, not a stray mention)
  const count = (list) => (list || []).reduce((n, p) => n + Math.min(2, (prompt.match(new RegExp(p, 'giu')) || []).length), 0);
  // a style word shortly after «стиль» / «style» is a declaration («Стиль: рисованный»), not a stray mention: one more point
  const declared = (r) => (r.styles || []).length > 0 && (r.match || []).some((p) => new RegExp(`(?:стил\\p{L}{0,8}|style)[^.!?]{0,30}?(?:${p})`, 'iu').test(prompt));
  const score = (r) => (isVideo ? count(r.match) + (declared(r) ? 1 : 0) : 0) + 2 * count(r.solo);
  const firstAt = (r) => Math.min(...[...(r.match || []), ...(r.solo || [])].map((p) => { const i = prompt.search(re(p)); return i < 0 ? Infinity : i; }));
  const named = cfg.routes.filter((r) => score(r) > 0);
  if (!isVideo && !named.length) return null;
  // A short message names things on purpose: everything named is used. A long one (a pasted brief or document) mentions many things in passing:
  // there a route needs two of its words (a single stray word switches nothing on) and the limits below apply.
  const long = prompt.length > (cfg.longMessage ?? 600), need = long ? 2 : 1;
  const maxRoutes = long ? cfg.maxRoutes ?? 5 : Infinity, maxStyles = long ? cfg.maxStyles ?? 4 : Infinity;
  const chosen = new Set(named.filter((r) => r.always)), dropped = [];
  let nRoutes = 0, nStyles = 0, droppedStyle = false;
  const optional = named.filter((r) => !r.always);
  optional.filter((r) => score(r) < need).forEach((r) => { dropped.push(r.label); if ((r.styles || []).length) droppedStyle = true; });
  const ranked = optional.filter((r) => score(r) >= need).map((r) => ({ r, s: score(r), at: firstAt(r), i: cfg.routes.indexOf(r) })).sort((a, b) => b.s - a.s || a.at - b.at || a.i - b.i);
  for (const { r } of ranked) {
    const ns = (r.styles || []).length; // style sections this route brings (the 3d route brings two)
    if (nRoutes >= maxRoutes || (ns && nStyles > 0 && nStyles + ns > maxStyles)) { dropped.push(r.label); if (ns) droppedStyle = true; continue; }
    chosen.add(r); nRoutes++; nStyles += ns;
  }
  const hits = cfg.routes.filter((r) => chosen.has(r));

  const seen = sentBefore(session), now = new Set(seen);
  const once = (key) => (now.has(key) ? false : (now.add(key), true));
  const out = [
    'cupmotion: сообщение похоже на просьбу о ролике / моушене (если нет — игнорируй этот блок).',
    `Папка скилла: ${slash(skillDir)}`,
  ];
  if (once('core')) {
    const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    const block = (name) => (skillMd.match(new RegExp(`<!-- ${name}:start -->([\\s\\S]*?)<!-- ${name}:end -->`)) || [, ''])[1].trim();
    const core = block('core'), work = block('work');
    if (!core) debug('SKILL.md: нет блока <!-- core:start --> … <!-- core:end -->');
    // core + order of work are sent here, so the skill itself is not needed (loading it would repeat them)
    out.push('Правила и порядок работы ниже — скилл cupmotion вызывать не нужно.', '', core, '', work);
  } else out.push('Ядро правил cupmotion уже было выше в этом разговоре. Если его не видно (контекст сжат) — вызови скилл (Skill: cupmotion:cupmotion).');

  if (hits.length) {
    const styles = {};
    for (const block of readOr(join(skillDir, 'references', 'styles.md'), '').split(/\n(?=## )/)) {
      const m = block.match(/^## (.+?)\s*\{#([\w.-]+)\}\s*\n([\s\S]*)$/);
      if (m) styles[m[2]] = { title: m[1].trim(), text: m[3].trim() };
    }
    const already = [], refs = []; let sitesNote = false;
    out.push('', `## Сработали триггеры: ${hits.map((h) => h.label).join(', ')}`);
    if (dropped.length) {
      const noStyle = !hits.some((h) => (h.styles || []).length);
      out.push(`Не подложено (сообщение длинное: слов маршрута в нём мало или сработал лимит): ${dropped.join(', ')}. Если слово стоит в самой просьбе пользователя (а не во вставленном тексте) — возьми маршрут из routes.json.`
        + (droppedStyle && noStyle ? ' Стиль мог быть назван мимоходом: если нет — выбери его по «Карте стилей» в конце references/styles.md.' : ''));
    }
    for (const h of hits) {
      const part = [];
      for (const k of h.styles || []) if (styles[k]) {
        if (once('style:' + k)) part.push(`Стиль «${styles[k].title}» — применить:`, styles[k].text);
        else already.push(`стиль «${styles[k].title}»`);
      }
      for (const f of h.refs || []) if (!refs.includes(f)) refs.push(f);
      for (const s of h.sites || []) if (once('site:' + s.url)) {
        if (!sitesNote) { part.push('Сайты для сверки идеи (открывать по правилу «Референсы из сети», не обязательно):'); sitesNote = true; }
        part.push(`- Сайт: ${s.name} — ${s.url}${s.note ? ` (${s.note})` : ''}`);
      }
      for (const t of h.tips || []) if (once('tip:' + t)) part.push(`- Совет: ${t}`);
      if (part.length) out.push('', `### ${h.label}`, ...part);
    }
    // no style named in the message: point at the style map instead of leaving the look to chance
    if (!droppedStyle && !hits.some((h) => (h.styles || []).length) && once('style-map'))
      out.push('', 'Стиль не назван. Выбери его по «Карте стилей: тема → стиль» в конце references/styles.md (по теме, площадке и описанию вроде «как у эппл»),'
        + ' прочитай раздел выбранного стиля и строку звука в references/sound-styles.md (только нужный раздел через offset/limit или Grep, не весь файл); назови выбор одной строкой в отчёте.');
    const newRefs = refs.filter((f) => once('ref:' + f));
    if (newRefs.length) out.push('', 'Прочитать: ' + newRefs.map((f) => slash(join(skillDir, 'references', f))).join(', '));
    const oldRefs = refs.filter((f) => !newRefs.includes(f));
    if (oldRefs.length) already.push(...oldRefs);
    if (already.length) out.push('', `Уже было выше в разговоре: ${already.join(', ')}.`);
  }
  if (once('local')) {
    const local = readOr(join(homedir(), '.claude', 'cupmotion.local.md'), '').trim();
    if (local) out.push('', '## Личные настройки пользователя (важнее общих правил скилла)', local);
    else out.push('', NOTICE);
  }
  remember(session, now);
  return out.join('\n');
}

// run as a hook: JSON on stdin, JSON on stdout; never block the prompt
const self = (p) => { try { return slash(realpathSync(p)).toLowerCase(); } catch { return slash(p || '').toLowerCase(); } };
if (process.argv[1] && self(process.argv[1]) === self(fileURLToPath(import.meta.url))) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw || '{}');
      const ctx = route(String(input.prompt || ''), SKILL, input.session_id || null);
      if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx } }));
    } catch (e) { debug(e); }
  });
}
