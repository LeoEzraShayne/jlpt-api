import { generateKeyPairSync, sign } from 'node:crypto';
import { AdmobVerifier } from '../../src/android-commerce/admob-verifier';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const raw = 'foo=hello%20world&bar=user%40gmail.com';
const decoded = 'foo=hello world&bar=user@gmail.com';
// Match the official Tink encoded-query byte convention, independently of parseSsv.
// https://github.com/tink-crypto/tink-java-apps/blob/main/rewardedads/src/test/java/com/google/crypto/tink/apps/rewardedads/RewardedAdsVerifierTest.java
function paddedSignature() {
  // ECDSA DER is variable length; select a normal signature whose canonical base64 has padding.
  for (let i = 0; i < 32; i++) {
    const signature = sign('sha256', Buffer.from(decoded), {
      key: keys.privateKey,
      dsaEncoding: 'der',
    })
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_');
    if (signature.endsWith('=')) return signature;
  }
  throw new Error('PADDED_ECDSA_TEST_FIXTURE_UNAVAILABLE');
}
function fixture() {
  const verifier = new AdmobVerifier();
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        keys: [
          {
            keyId: 1234,
            base64: keys.publicKey
              .export({ type: 'spki', format: 'der' })
              .toString('base64'),
          },
        ],
      }),
      { status: 200 },
    ),
  );
  const signature = paddedSignature();
  return {
    verifier,
    signature,
    plain: `${raw}&signature=${signature}&key_id=1234`,
    encoded: `${raw}&signature=${encodeURIComponent(signature)}&key_id=1%3234`,
  };
}
afterEach(() => jest.restoreAllMocks());
test('valid percent-encoded signature padding and key ID use the same single-decoded signed bytes', async () => {
  const f = fixture();
  expect(f.encoded).toContain('%3D');
  expect(await f.verifier.verify(f.plain)).toEqual({
    foo: 'hello world',
    bar: 'user@gmail.com',
  });
  expect(await f.verifier.verify(f.encoded)).toEqual({
    foo: 'hello world',
    bar: 'user@gmail.com',
  });
});
test('double-encoded signature padding and key digits are rejected instead of decoded twice', async () => {
  const f = fixture();
  for (const query of [
    f.encoded.replace('%3D', '%253D'),
    f.encoded.replace('1%3234', '1%253234'),
  ])
    await expect(f.verifier.verify(query)).rejects.toMatchObject({
      response: { code: 'INVALID_ADMOB_SIGNATURE' },
    });
});
test('encoded suffix separators and duplicate or trailing parameters remain rejected', async () => {
  const f = fixture();
  for (const query of [
    f.plain.replace('key_id=1234', 'key_id=1234%26next%3D1'),
    f.plain.replace('signature=', 'signature=%26'),
    f.plain + '&after=1',
    `key_id=1234&${f.plain}`,
  ])
    await expect(f.verifier.verify(query)).rejects.toMatchObject({
      response: { code: 'INVALID_ADMOB_SIGNATURE' },
    });
});
