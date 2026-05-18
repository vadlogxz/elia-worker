import { Env } from '../types/env';
import { WordEntry, GeneratedWordEntry } from '../types/vocabulary.types';
import { verifyFirebaseToken } from '../services/firebase/auth.service';
import { getDocument, setDocument } from '../services/firebase/firestore.service';
import { generateWordEntry } from '../services/openai/vocabulary.service';

// Lowercase + trim + spaces/slashes → underscore.
// Umlauts, Cyrillic, CJK pass through unchanged.
function normalize(input: string): string {
	return input.toLowerCase().trim().replace(/[\s/]+/g, '_');
}

async function lookupWordId(key: string, env: Env): Promise<string | null> {
	const doc = await getDocument<{ wordId: string }>('vocabulary_lookup', key, env);
	return doc?.wordId ?? null;
}

async function saveLookup(key: string, uuid: string, env: Env): Promise<void> {
	await setDocument('vocabulary_lookup', key, { wordId: uuid }, env);
}

export async function handleVocabulary(request: Request, env: Env): Promise<Response> {
	// 1. Auth token + body
	const token = request.headers.get('Authorization')?.replace('Bearer ', '');
	if (!token) return err('Unauthorized', 401);

	let word: string;
	try {
		const body = (await request.json()) as { word?: string };
		word = body.word?.trim() ?? '';
	} catch {
		return err('Invalid JSON body', 400);
	}
	if (!word) return err('Missing "word" field', 400);

	const key = normalize(word);
	console.log('[vocabulary] requested:', word, '→ key:', key);

	// 2. Auth + lookup in parallel
	const [authResult, lookupResult] = await Promise.allSettled([
		verifyFirebaseToken(token, env),
		lookupWordId(key, env),
	]);

	if (authResult.status === 'rejected') {
		console.error('[vocabulary] auth failed:', authResult.reason?.message);
		return err('Unauthorized', 401);
	}
	console.log('[vocabulary] auth ok, uid:', authResult.value);

	// 3. Lookup hit → fetch from cache by UUID
	if (lookupResult.status === 'fulfilled' && lookupResult.value) {
		const uuid = lookupResult.value;
		console.log('[vocabulary] lookup hit:', key, '→', uuid);
		const cached = await getDocument<WordEntry>('vocabulary_cache', uuid, env);
		if (cached) return ok(cached);
		console.log('[vocabulary] stale lookup, regenerating');
	} else {
		console.log('[vocabulary] lookup miss, generating...');
	}

	// 4. Generate via OpenAI
	let generated: GeneratedWordEntry;
	try {
		generated = await generateWordEntry(word, env);
		console.log('[vocabulary] generated lemma:', generated.lemma, generated.type, generated.level);
	} catch (e) {
		console.error('[vocabulary] generation failed:', e instanceof Error ? e.message : e);
		return err(e instanceof Error ? e.message : 'Generation failed', 502);
	}

	// 5. Assemble final entry
	const uuid = crypto.randomUUID();
	const entry: WordEntry = { ...generated, id: uuid, cachedAt: new Date().toISOString() };

	// 6. Save cache + lookup for the searched form and the lemma
	const lemmaKey = normalize(generated.lemma);
	try {
		await setDocument('vocabulary_cache', uuid, entry, env);
		console.log('[vocabulary] cached:', uuid);

		await saveLookup(key, uuid, env);
		if (lemmaKey !== key) {
			await saveLookup(lemmaKey, uuid, env);
			console.log('[vocabulary] lookups saved:', key, '+', lemmaKey);
		} else {
			console.log('[vocabulary] lookup saved:', key);
		}
	} catch (e) {
		console.error('[vocabulary] firestore write failed:', e instanceof Error ? e.message : e);
	}

	return ok(entry);
}

function ok(body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function err(message: string, status: number): Response {
	return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
