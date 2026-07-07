import argon2 from 'argon2';

// Argon2id per DESIGN.md §15. argon2's defaults already select the id variant
// with OWASP-aligned memory/time cost; we pin the type explicitly so a library
// default change can never silently downgrade us to argon2i/argon2d.
const options: argon2.Options = { type: argon2.argon2id };

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, options);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash must read as "wrong password", never as a 500 that
    // distinguishes valid-user-bad-hash from unknown-user.
    return false;
  }
}

// A real argon2id hash of a throwaway secret, computed once. Verifying an
// attempted password against this when the username is unknown makes the
// login path spend the same work whether or not the user exists — so response
// timing can't be used to enumerate usernames.
let dummyHash: Promise<string> | null = null;
export async function verifyDummy(plain: string): Promise<false> {
  dummyHash ??= hashPassword('bioverse-nonexistent-user-placeholder');
  await verifyPassword(await dummyHash, plain);
  return false;
}
