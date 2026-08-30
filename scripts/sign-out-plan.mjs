/**
 * Sign-out sequencing, isolated so it can be unit-tested.
 *
 * Two environments, two contracts:
 *  - DEPLOYED: the session is an HttpOnly cookie only the server can clear.
 *    `requestSignOut` MUST confirm before we redirect; a failure propagates so
 *    the UI reports a sign-out that did not happen instead of lying.
 *  - LIVE PREVIEW: the app is a cross-origin iframe with partitioned cookies;
 *    clearing the local bearer token is sufficient. The server call is
 *    best-effort with a 1.5s bound (the sign-in popup is already open and a
 *    request that never settles would leave it hanging), and the sequence
 *    always resolves.
 */

const PREVIEW_SIGN_OUT_BUDGET_MS = 1_500;

/**
 * @typedef {Object} PreSignInPlan
 * @property {boolean} livePreview
 * @property {boolean} hasBearer
 * @property {() => (Promise<unknown> | unknown)} requestSignOut
 * @property {() => void} clearToken
 */

/**
 * @typedef {PreSignInPlan & { redirect: () => void }} SignOutPlan
 */

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pre-sign-in cleanout: drop any prior session so switching providers actually
 * switches identity. Bounded PER ENVIRONMENT — only the server can end a
 * deployed session, so cutting it short at the preview's 1.5s would start
 * OAuth with the old session still live.
 */
/** @param {PreSignInPlan} plan */
export async function runPreSignInSignOut({ livePreview, hasBearer, requestSignOut, clearToken }) {
  if (!livePreview) {
    await requestSignOut();
    if (hasBearer) clearToken();
    return;
  }
  await Promise.race([
    Promise.resolve(requestSignOut()).catch(() => {}),
    sleep(PREVIEW_SIGN_OUT_BUDGET_MS),
  ]);
  if (hasBearer) clearToken();
}

/**
 * Sign out of this app's session, clear the preview token, then redirect.
 * Rejects when deployed and the server never confirms.
 */
/** @param {SignOutPlan} plan */
export async function runSignOut({ livePreview, hasBearer, requestSignOut, clearToken, redirect }) {
  if (!livePreview) {
    await requestSignOut();
    if (hasBearer) clearToken();
    redirect();
    return;
  }
  await Promise.race([
    Promise.resolve(requestSignOut()).catch(() => {}),
    sleep(PREVIEW_SIGN_OUT_BUDGET_MS),
  ]);
  if (hasBearer) clearToken();
  redirect();
}
