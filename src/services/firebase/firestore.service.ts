import { Env } from '../../types/env';

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

// Best-effort in-memory cache for the access token within a single isolate lifetime.
let tokenCache: { value: string; exp: number } | null = null;

// ── Firestore typed-value conversion ──────────────────────────────────────────

interface FsValue {
	stringValue?: string;
	integerValue?: string;
	doubleValue?: number;
	booleanValue?: boolean;
	nullValue?: 'NULL_VALUE';
	arrayValue?: { values?: FsValue[] };
	mapValue?: { fields?: Record<string, FsValue> };
}

interface FsDocument {
	name: string;
	fields?: Record<string, FsValue>;
}

function toFsValue(v: unknown): FsValue {
	if (v === null || v === undefined) return { nullValue: 'NULL_VALUE' };
	if (typeof v === 'boolean') return { booleanValue: v };
	if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
	if (typeof v === 'string') return { stringValue: v };
	if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
	if (typeof v === 'object') {
		const fields: Record<string, FsValue> = {};
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields[k] = toFsValue(val);
		return { mapValue: { fields } };
	}
	return { stringValue: String(v) };
}

function fromFsValue(v: FsValue): unknown {
	if ('nullValue' in v) return null;
	if ('booleanValue' in v) return v.booleanValue;
	if ('integerValue' in v) return parseInt(v.integerValue!, 10);
	if ('doubleValue' in v) return v.doubleValue;
	if ('stringValue' in v) return v.stringValue;
	if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(fromFsValue);
	if ('mapValue' in v) {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v.mapValue?.fields ?? {})) out[k] = fromFsValue(val);
		return out;
	}
	return null;
}

// ── Service account → Google access token ────────────────────────────────────

function b64url(data: ArrayBuffer): string {
	const bytes = new Uint8Array(data);
	let bin = '';
	for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function pemToBuffer(pem: string): ArrayBuffer {
	// Handles both literal \n (env var escaping) and real newlines
	const clean = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
	return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)).buffer;
}

async function fetchAccessToken(env: Env): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	if (tokenCache && tokenCache.exp > now + 60) {
		console.log('[firestore] using cached access token');
		return tokenCache.value;
	}

	console.log('[firestore] fetching new access token for', env.FIREBASE_CLIENT_EMAIL);

	const enc = new TextEncoder();
	const h = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).buffer as ArrayBuffer);
	const p = b64url(enc.encode(JSON.stringify({ iss: env.FIREBASE_CLIENT_EMAIL, scope: SCOPE, aud: OAUTH_URL, iat: now, exp: now + 3600 })).buffer as ArrayBuffer);
	const signingInput = `${h}.${p}`;

	const privateKey = await crypto.subtle.importKey('pkcs8', pemToBuffer(env.FIREBASE_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(signingInput));
	const jwt = `${signingInput}.${b64url(sig)}`;

	const res = await fetch(OAUTH_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`OAuth token error ${res.status}: ${body}`);
	}

	const data = (await res.json()) as { access_token: string; expires_in: number };
	tokenCache = { value: data.access_token, exp: now + data.expires_in };
	console.log('[firestore] access token fetched, expires in', data.expires_in, 's');
	return tokenCache.value;
}

// ── Public API ────────────────────────────────────────────────────────────────

function docUrl(projectId: string, collection: string, docId: string): string {
	return `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;
}

export async function getDocument<T>(collection: string, docId: string, env: Env): Promise<T | null> {
	const url = docUrl(env.FIREBASE_PROJECT_ID, collection, docId);
	console.log('[firestore] GET', url);

	const token = await fetchAccessToken(env);
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

	console.log('[firestore] GET status:', res.status);
	if (res.status === 404) return null;
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Firestore GET error ${res.status}: ${body}`);
	}

	const doc = (await res.json()) as FsDocument;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(doc.fields ?? {})) out[k] = fromFsValue(v);
	return out as T;
}

export async function setDocument(collection: string, docId: string, data: object, env: Env): Promise<void> {
	const url = docUrl(env.FIREBASE_PROJECT_ID, collection, docId);
	console.log('[firestore] PATCH', url);

	const token = await fetchAccessToken(env);
	const fields: Record<string, FsValue> = {};
	for (const [k, v] of Object.entries(data)) fields[k] = toFsValue(v);

	const res = await fetch(url, {
		method: 'PATCH',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ fields }),
	});

	console.log('[firestore] PATCH status:', res.status);
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Firestore PATCH error ${res.status}: ${body}`);
	}
}
