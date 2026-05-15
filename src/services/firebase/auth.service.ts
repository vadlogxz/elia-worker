import { Env } from '../../types/env';

// Firebase publishes RSA public keys in JWK format at this URL.
// Cloudflare caches the response automatically based on Cache-Control headers (~1h TTL).
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface Jwk {
	kid: string;
	kty: string;
	alg: string;
	use: string;
	n: string;
	e: string;
}

function b64urlToBytes(s: string): Uint8Array {
	const base64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function parseJwt(token: string): {
	header: Record<string, string>;
	payload: Record<string, unknown>;
	sig: Uint8Array;
	signingInput: string;
} {
	const parts = token.split('.');
	if (parts.length !== 3) throw new Error('Malformed JWT');
	const decode = (b64: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(b64)));
	return {
		header: decode(parts[0]),
		payload: decode(parts[1]),
		sig: b64urlToBytes(parts[2]),
		signingInput: `${parts[0]}.${parts[1]}`,
	};
}

async function fetchPublicKeys(): Promise<Jwk[]> {
	const res = await fetch(JWKS_URL);
	if (!res.ok) throw new Error(`Failed to fetch Firebase public keys: ${res.status}`);
	const data = (await res.json()) as { keys: Jwk[] };
	return data.keys;
}

// Verifies a Firebase ID token and returns the uid on success.
// Throws on any verification failure.
export async function verifyFirebaseToken(token: string, env: Env): Promise<string> {
	const { header, payload, sig, signingInput } = parseJwt(token);

	const now = Math.floor(Date.now() / 1000);
	if ((payload.exp as number) < now) throw new Error('Token expired');
	if (payload.aud !== env.FIREBASE_PROJECT_ID) throw new Error('Invalid audience');
	if (payload.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) throw new Error('Invalid issuer');
	if (!payload.sub) throw new Error('Missing subject');

	const keys = await fetchPublicKeys();
	const jwk = keys.find((k) => k.kid === header.kid);
	if (!jwk) throw new Error('Signing key not found');

	const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
	const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, new TextEncoder().encode(signingInput));
	if (!valid) throw new Error('Invalid token signature');

	return payload.sub as string;
}
