import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { detectLang, translateTexts } from "../server/lib/translate.js";
import { NALPIA_NEWS } from "../server/lib/news-template.js";

const PW = "korrekt-pferd-batterie";

test("detectLang: recognises German and English, leaves names and short labels open", () => {
  assert.equal(detectLang("Bitte schick mir die Unterlagen bis Freitag, dann können wir starten."), "de");
  assert.equal(detectLang("Please send me the documents by Friday so we can start."), "en");
  assert.equal(detectLang("Nachfassen bei der Rhein Pensionskasse"), "de");
  assert.equal(detectLang("Follow up with the Rhein Pensionskasse"), "en");
  assert.equal(detectLang("Dr. Henrik Sommer"), null);
  assert.equal(detectLang("nalpia"), null);
});

test("translateTexts: template texts use their maintained translation, texts in the target language stay", async () => {
  const { deps } = setup();
  const post = NALPIA_NEWS[0]!;
  const out = await translateTexts(deps, [post.title.de, post.body.de, "Already in English, nothing to do here.", "Dr. Henrik Sommer"], "en");
  assert.equal(out[0], post.title.en);
  assert.equal(out[1], post.body.en);
  assert.equal(out[2], null);
  assert.equal(out[3], null);
  // the other way round
  const back = await translateTexts(deps, [post.title.en], "de");
  assert.equal(back[0], post.title.de);
});

test("translateTexts: cached translations are served from the database, without AI nothing else is invented", async () => {
  const { deps } = setup();
  const text = "Bitte schick das Term Sheet an die Kanzlei und plane einen Termin.";
  assert.deepEqual(await translateTexts(deps, [text], "en"), [null], "no AI key: original stays");
  const { sha256 } = await import("../server/lib/crypto.js");
  deps.db
    .prepare("INSERT INTO content_translations (src_hash, lang, text, created_at) VALUES (?, 'en', ?, ?)")
    .run(sha256(text).slice(0, 40), "Please send the term sheet to the law firm and schedule a meeting.", Date.now());
  assert.deepEqual(await translateTexts(deps, [text], "en"), ["Please send the term sheet to the law firm and schedule a meeting."]);
});

test("POST /api/translate: signed-in only, validated", async () => {
  const { deps, app } = setup();
  await addUser(deps, { email: "a@nalpia.com", password: PW });
  const anon = new Client(app);
  assert.equal((await anon.post("/api/translate", { lang: "en", texts: ["Hallo und willkommen"] })).status, 401);
  const c = new Client(app);
  await c.login("a@nalpia.com", PW);
  const post = NALPIA_NEWS[1]!;
  const r = await c.post("/api/translate", { lang: "en", texts: [post.title.de] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.translations, [post.title.en]);
  assert.equal((await c.post("/api/translate", { lang: "fr", texts: ["x"] })).status, 422);
  assert.equal((await c.post("/api/translate", { lang: "en", texts: [] })).status, 422);
});

test("notifications are written in both languages and read in the reader's language", async () => {
  const { deps, app } = setup();
  await addUser(deps, { email: "a@nalpia.com", name: "Anna", password: PW });
  const bId = await addUser(deps, { email: "b@nalpia.com", name: "Ben", password: PW });
  const a = new Client(app);
  await a.login("a@nalpia.com", PW);
  // Anna works in German …
  const r = await a.req("POST", "/api/tasks", { title: "Unterlagen schicken", assigneeId: bId }, { "x-lang": "de" });
  assert.equal(r.status, 201, r.text);
  const b = new Client(app);
  await b.login("b@nalpia.com", PW);
  // … Ben reads in English, and in German when he switches
  const en = await b.req("GET", "/api/notifications", undefined, { "x-lang": "en" });
  assert.match(en.json.items[0].title, /^Anna assigned/);
  const de = await b.req("GET", "/api/notifications", undefined, { "x-lang": "de" });
  assert.match(de.json.items[0].title, /^Anna hat dir/);
});

test("translateTexts: asks the model once for the missing texts and keeps the result", async () => {
  const { deps } = setup();
  let calls = 0;
  const fake = {
    sdk: {
      messages: {
        parse: async (req: { messages: { content: string }[] }) => {
          calls++;
          const { texts } = JSON.parse(req.messages[0]!.content) as { texts: string[] };
          return { parsed_output: { translations: texts.map((t) => (t === "Projektmanagement" ? "Project management" : `EN: ${t}`)) } };
        },
      },
    },
  };
  const d = { ...deps, ai: fake as unknown as typeof deps.ai };
  const texts = ["Bitte prüfe die Unterlagen bis Freitag.", "Projektmanagement", "Please check the documents.", "Bitte prüfe die Unterlagen bis Freitag."];
  const out = await translateTexts(d, texts, "en");
  assert.deepEqual(out, ["EN: Bitte prüfe die Unterlagen bis Freitag.", "Project management", null, "EN: Bitte prüfe die Unterlagen bis Freitag."]);
  assert.equal(calls, 1, "one request for all missing texts, duplicates once");
  await translateTexts(d, texts, "en");
  assert.equal(calls, 1, "second time from the database");
});
