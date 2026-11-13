// botpsy-test.mjs — tool-calling smoke test for the "botpsy" model on qvac serve.
// Sends 8 multilingual prompts with 5 fake tools and checks which tool (if any) the model picks.
// Usage: node botpsy-test.mjs   (env: URL, MODEL to override defaults)
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.URL || 'http://127.0.0.1:11434/v1/chat/completions';
const MODEL = process.env.MODEL || 'botpsy';
// The key is read from disk and only ever used in the Authorization header; never logged.
const KEY = readFileSync(join(homedir(), 'qvac-lab', 'api-key.txt'), 'utf8').trim();

// Five fake tools in OpenAI function-calling format.
const fn = (name, description, properties, required) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const tools = [
  fn('create_event', 'Create a calendar event.', {
    title: { type: 'string', description: 'Event title' },
    day: { type: 'string', description: 'Day of the event, e.g. Friday or 2026-11-13' },
    time: { type: 'string', description: 'Start time, 24h format HH:MM' },
  }, ['title', 'day', 'time']),
  fn('set_timer', 'Start a countdown timer.', {
    minutes: { type: 'number', description: 'Duration in minutes' },
    label: { type: 'string', description: 'Optional label' },
  }, ['minutes']),
  fn('get_weather', 'Get the current weather for a city.', {
    city: { type: 'string', description: 'City name' },
  }, ['city']),
  fn('set_light', 'Set the brightness of the lights in a room.', {
    room: { type: 'string', description: 'Room name' },
    brightness: { type: 'integer', minimum: 0, maximum: 100, description: 'Brightness 0-100' },
  }, ['room', 'brightness']),
  fn('send_message', 'Send a text message to a contact.', {
    contact: { type: 'string', description: 'Contact name' },
    text: { type: 'string', description: 'Message text' },
  }, ['contact', 'text']),
];

// Lenient helpers for argument checks.
const norm = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const has = (v, ...alts) => alts.some((a) => norm(v).includes(norm(a)));
const timeIs15 = (t) => /^(15[:.h]?0{0,2}|3\s*(pm|p\.m\.))$/i.test(String(t ?? '').trim()) || /15:00/.test(String(t));

// Each case: expected tool name (or null = no tool) and an args check.
const cases = [
  { lang: 'en', prompt: 'Add the dentist on Friday at 3 pm.', tool: 'create_event',
    check: (a) => has(a.day, 'friday') && timeIs15(a.time) },
  { lang: 'it', prompt: 'Aggiungi il dentista venerdì alle 15.', tool: 'create_event',
    check: (a) => has(a.day, 'venerdi', 'friday') && timeIs15(a.time) },
  { lang: 'it', prompt: 'Metti un timer di 10 minuti per la pasta.', tool: 'set_timer',
    check: (a) => Number(a.minutes) === 10 },
  { lang: 'it', prompt: 'Che tempo fa a Ginevra?', tool: 'get_weather',
    check: (a) => has(a.city, 'ginevra', 'geneva', 'geneve') },
  { lang: 'it', prompt: 'Abbassa la luce in salotto al 30 per cento.', tool: 'set_light',
    check: (a) => has(a.room, 'salotto', 'living') && Number(a.brightness) === 30 },
  { lang: 'fr', prompt: 'Envoie un message à Marie: je serai en retard.', tool: 'send_message',
    check: (a) => has(a.contact, 'marie') && has(a.text, 'retard', 'late') },
  { lang: 'it', prompt: 'Raccontami una barzelletta.', tool: null },
  { lang: 'it', prompt: 'Accendi la lavatrice.', tool: null },
];

async function runCase(c) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: c.prompt }],
    tools,
    stream: false,
    max_tokens: 2048,
    temperature: 0.3,
    top_p: 0.95,
    top_k: 20,
    presence_penalty: 1.5,
    // Thinking on: QVAC-style knob plus the llama.cpp-style template switch.
    reasoning_budget: -1,
    chat_template_kwargs: { enable_thinking: true },
  };
  const t0 = performance.now();
  let res, json, err;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try { json = JSON.parse(text); } catch { err = `HTTP ${res.status} non-JSON: ${text.slice(0, 80)}`; }
    if (!err && !res.ok) err = `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 80)}`;
  } catch (e) {
    err = String(e.message || e);
  }
  const ms = Math.round(performance.now() - t0);
  if (err) return { c, ms, err, pass: false };

  const choice = json.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  const calls = (msg.tool_calls ?? []).map((tc) => {
    let args = tc.function?.arguments;
    let parsed = {};
    if (typeof args === 'string') { try { parsed = JSON.parse(args); } catch { parsed = {}; } }
    else if (args && typeof args === 'object') { parsed = args; args = JSON.stringify(args); }
    return { name: tc.function?.name, raw: args ?? '', args: parsed };
  });

  let pass;
  if (c.tool === null) pass = calls.length === 0;
  else pass = calls.length >= 1 && calls[0].name === c.tool && !!c.check(calls[0].args);

  return {
    c, ms, pass,
    finish: choice.finish_reason ?? '-',
    calls,
    content: (msg.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    reasoning: typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0,
    usage: json.usage ? `${json.usage.prompt_tokens ?? '?'}/${json.usage.completion_tokens ?? '?'}` : '-',
  };
}

const rows = [];
for (const c of cases) rows.push(await runCase(c)); // sequential: one request at a time

// Compact table.
console.log(`model=${MODEL}  cases=${cases.length}  (usage = prompt/completion tokens)\n`);
rows.forEach((r, i) => {
  const exp = r.c.tool ?? 'none';
  const head = `#${i + 1} [${r.c.lang}] ${r.pass ? 'PASS' : 'FAIL'}  ${r.ms} ms  expect=${exp}`;
  if (r.err) { console.log(`${head}\n    ERROR ${r.err}`); return; }
  const got = r.calls.length ? r.calls.map((t) => `${t.name}(${t.raw})`).join('; ') : 'none';
  console.log(`${head}  finish=${r.finish}  reasoning=${r.reasoning ? 'yes' : 'no'}  usage=${r.usage}`);
  console.log(`    prompt : ${r.c.prompt}`);
  console.log(`    tools  : ${got}`);
  console.log(`    content: ${r.content || '(empty)'}`);
});
const passed = rows.filter((r) => r.pass).length;
console.log(`\nPASS ${passed}/${rows.length}`);
