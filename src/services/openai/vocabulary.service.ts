import { Env } from '../../types/env';
import { config } from '../../config/env';
import { GeneratedWordEntry } from '../../types/vocabulary.types';

const CHAT_API = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are a German language expert creating vocabulary cards for Ukrainian speakers learning German.
Generate a complete word entry. All translations, the mnemonic, and the Ukrainian side of examples must be in Ukrainian.
Return ONLY a valid JSON object — no markdown, no extra text outside the JSON.

IMPORTANT: Always generate the entry for the BASE FORM of the word, regardless of what form was given as input:
- Verbs → infinitive ("gegangen", "geht", "ging" → generate for "gehen")
- Nouns → nominative singular without article ("dem Haus", "die Häuser" → generate for "Haus")
- Adjectives → base form ("größeren", "größte" → generate for "groß")

JSON schema:
{
  "lemma": "string — canonical base form, always lowercase (gehen, haus, groß)",
  "word": "string — base form with correct German capitalization (gehen, Haus, groß)",
  "type": "noun | verb | adjective | adverb | phrase | other",
  "level": "a1 | a2 | b1 | b2 | c1 | c2",
  "register": "neutral | formal | informal | colloquial",
  "translations": ["Ukrainian translation strings"],
  "noun": { "article": "der | die | das", "plural": "string", "genitive": "string" } or null,
  "verb": {
    "auxiliary": "haben | sein",
    "partizip2": "string",
    "isSeparable": true or false,
    "separablePrefix": "string or null",
    "conjugation": { "ich": "string", "du": "string", "er": "string" },
    "governs": "Akkusativ | Dativ | Genitiv or null — set to null if the verb does not require a direct object or case complement (e.g. gehen, schlafen, sein → null)"
  } or null,
  "adjective": { "comparative": "string", "superlative": "string" } or null,
  "examples": [{ "de": "German sentence", "uk": "Ukrainian translation" }],
  "mnemonic": "Ukrainian mnemonic hint or null",
  "relatedWords": ["related German words"]
}

Rules:
- Populate ONLY the field matching the word's grammatical type (noun/verb/adjective); set the other two to null.
- For separable verbs, conjugation must show the prefix in separated position: "ich": "mache auf".
- Include at least 2 example sentences. They must be natural and conversational, not textbook-style.
- relatedWords: 2–4 related German words.`;

export async function generateWordEntry(word: string, env: Env): Promise<GeneratedWordEntry> {
	const res = await fetch(CHAT_API, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: config.OPENAI_VOCABULARY_MODEL,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: `Generate word entry for: "${word}"` },
			],
			temperature: 0.3,
		}),
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`OpenAI error [${res.status}]: ${errText}`);
	}

	const data = (await res.json()) as { choices: { message: { content: string } }[] };
	return JSON.parse(data.choices[0]?.message?.content ?? '{}') as GeneratedWordEntry;
}
