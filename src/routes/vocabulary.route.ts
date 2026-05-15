import { Env } from '../types/env';
import { WordEntry } from '../types/vocabulary.types';
import { verifyFirebaseToken } from '../services/firebase/auth.service';
import { getDocument, setDocument } from '../services/firebase/firestore.service';
import { generateWordEntry } from '../services/openai/vocabulary.service';

export async function handleVocabulary(request: Request, env: Env): Promise<Response> {
	// 1. Auth
	const token = request.headers.get('Authorization')?.replace('Bearer ', '');
	if (!token) return err('Unauthorized', 401);

	try {
		await verifyFirebaseToken(token, env);
	} catch {
		return err('Unauthorized', 401);
	}

	// 2. Parse body
	let word: string;
	try {
		const body = (await request.json()) as { word?: string };
		word = body.word?.trim() ?? '';
	} catch {
		return err('Invalid JSON body', 400);
	}
	if (!word) return err('Missing "word" field', 400);

	const wordId = word.toLowerCase();

	// 3. Cache hit → return immediately
	const cached = await getDocument<WordEntry>('vocabulary_cache', wordId, env);
	if (cached) return ok(cached);

	// 4. Generate via OpenAI
	let entry: WordEntry;
	try {
		entry = await generateWordEntry(word, env);
	} catch (e) {
		return err(e instanceof Error ? e.message : 'Generation failed', 502);
	}

	// 5. Persist to cache — non-blocking so the response is not delayed by a Firestore write
	setDocument('vocabulary_cache', entry.id, entry, env).catch(() => {});

	return ok(entry);
}

function ok(body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function err(message: string, status: number): Response {
	return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
