import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Guard,
  RateLimiter,
  CreditLedger,
  estimateCredits,
  presentedToken,
  clientIp,
  type Clock,
} from '../src/investigations/guard.ts';

/**
 * TRACE — deploy guard (feedback #4: protect credits before a public deploy).
 *
 * Pure unit tests with an injected clock and explicit config — no next/*, no
 * network, no env mutation. Covers the four gates (token, per-IP rate limit,
 * credit budget, dry-run estimate) plus the prod fail-closed + save-disable
 * behavior and the invariant that the token never leaks into posture().
 */

const TOKEN = 'trace_secret_token_0123456789';
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

// A hand-advanced clock so rate-limit windows are deterministic.
function fakeClock(start = 0): Clock & { advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('EST1: dry-run estimate matches the orchestrator cost model (5 + 1 + pages)', () => {
  const e = estimateCredits({ maxPages: 5 });
  assert.equal(e.breakdown.counterparties, 5);
  assert.equal(e.breakdown.relatedWallets, 1);
  assert.equal(e.breakdown.transactionPages, 5);
  assert.equal(e.plannedCredits, 11);
  assert.equal(e.worstCaseCredits, 11);
});

test('EST2: the maxCredits ceiling caps the worst case; disabled calls drop out', () => {
  const capped = estimateCredits({ maxCredits: 8, maxPages: 5 });
  assert.equal(capped.plannedCredits, 11);
  assert.equal(capped.worstCaseCredits, 8); // clamped to the ceiling

  const noCp = estimateCredits({ fetchCounterparties: false, maxPages: 3 });
  assert.equal(noCp.breakdown.counterparties, 0);
  assert.equal(noCp.plannedCredits, 4); // 0 + 1 + 3
});

test('TOKEN1: header parsing accepts Bearer and x-trace-token, case-insensitive', () => {
  assert.equal(presentedToken({ Authorization: 'Bearer abc' }), 'abc');
  assert.equal(presentedToken({ 'X-Trace-Token': 'xyz' }), 'xyz');
  assert.equal(presentedToken({}), null);
});

test('AUTH1: a configured token is required and compared exactly', () => {
  const g = new Guard({ token: TOKEN, isProduction: true, ratePerMin: 0, creditBudget: Infinity, allowSave: false });
  assert.equal(g.authorize(bearer(TOKEN)), null); // correct token → allowed
  assert.equal(g.authorize(bearer('wrong'))?.status, 401);
  assert.equal(g.authorize({})?.status, 401); // missing → 401
});

test('AUTH2: no token in production is FAIL-CLOSED (503); in dev it is allowed', () => {
  const prod = new Guard({ token: null, isProduction: true, ratePerMin: 0, creditBudget: Infinity, allowSave: false });
  assert.equal(prod.authorize({})?.status, 503);

  const dev = new Guard({ token: null, isProduction: false, ratePerMin: 0, creditBudget: Infinity, allowSave: false });
  assert.equal(dev.authorize({}), null);
});

test('RATE1: fixed window refuses past the limit, then recovers after the window', () => {
  const clock = fakeClock();
  const rl = new RateLimiter(2, 60_000, clock);
  assert.equal(rl.check('ip').ok, true);
  assert.equal(rl.check('ip').ok, true);
  const blocked = rl.check('ip');
  assert.equal(blocked.ok, false);
  assert.equal((blocked as { retryAfterSec: number }).retryAfterSec, 60);
  clock.advance(60_000);
  assert.equal(rl.check('ip').ok, true); // window rolled over
});

test('RATE2: separate IPs have independent budgets; limit<=0 disables the gate', () => {
  const rl = new RateLimiter(1, 60_000, fakeClock());
  assert.equal(rl.check('a').ok, true);
  assert.equal(rl.check('a').ok, false);
  assert.equal(rl.check('b').ok, true); // different key, fresh window

  const off = new RateLimiter(0, 60_000, fakeClock());
  for (let i = 0; i < 100; i += 1) assert.equal(off.check('x').ok, true);
});

test('IP1: clientIp prefers the first X-Forwarded-For hop, then X-Real-IP', () => {
  assert.equal(clientIp({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), '1.2.3.4');
  assert.equal(clientIp({ 'x-real-ip': '9.9.9.9' }), '9.9.9.9');
  assert.equal(clientIp({}), 'unknown');
});

test('BUDGET1: the ledger refuses a run it cannot afford, and settles actual spend', () => {
  const ledger = new CreditLedger(10);
  assert.equal(ledger.canAfford(7), true);
  ledger.record(7);
  assert.equal(ledger.remaining(), 3);
  assert.equal(ledger.canAfford(7), false); // 7 + 7 > 10
  assert.equal(ledger.canAfford(3), true);
});

test('BUDGET2: preflight blocks once the deploy budget is exhausted', () => {
  const g = new Guard({ token: null, isProduction: false, ratePerMin: 0, creditBudget: 11, allowSave: false });
  const est = estimateCredits({ maxPages: 5 }); // worstCase 11
  assert.equal(g.preflight(est), null); // first run fits
  g.settle(11);
  assert.equal(g.preflight(est)?.status, 429); // second run cannot afford
});

test('SAVE1: saveEnabled is off in prod unless TRACE_ALLOW_SAVE, on in dev', () => {
  const prod = new Guard({ token: TOKEN, isProduction: true, ratePerMin: 0, creditBudget: Infinity, allowSave: false });
  assert.equal(prod.saveEnabled, false);
  const prodAllowed = new Guard({ token: TOKEN, isProduction: true, ratePerMin: 0, creditBudget: Infinity, allowSave: true });
  assert.equal(prodAllowed.saveEnabled, true);
  const dev = new Guard({ token: null, isProduction: false, ratePerMin: 0, creditBudget: Infinity, allowSave: false });
  assert.equal(dev.saveEnabled, true);
});

test('POSTURE1: posture never leaks the token and reports safe fields', () => {
  const g = new Guard({ token: TOKEN, isProduction: true, ratePerMin: 5, creditBudget: 100, allowSave: false });
  const p = g.posture();
  assert.equal(p.authRequired, true);
  assert.equal(p.ratePerMin, 5);
  assert.equal(p.creditBudget, 100);
  assert.equal(p.creditsRemaining, 100);
  assert.ok(!JSON.stringify(p).includes(TOKEN), 'the token must never appear in posture');
});

test('ENV1: fromEnv is fail-closed-in-prod and uncapped-in-dev by default', () => {
  const prod = Guard.fromEnv({ NODE_ENV: 'production' });
  assert.equal(prod.authorize({})?.status, 503); // no token in prod → refuse
  assert.equal(prod.posture().creditBudget, 100); // conservative default cap

  const dev = Guard.fromEnv({});
  assert.equal(dev.authorize({}), null); // dev convenience
  assert.equal(dev.posture().creditBudget, null); // uncapped locally
  assert.equal(dev.posture().ratePerMin, 5); // unset rate → default, NOT 0 (disabled)

  const configured = Guard.fromEnv({ NODE_ENV: 'production', TRACE_API_TOKEN: TOKEN, TRACE_CREDIT_BUDGET: '50' });
  assert.equal(configured.authorize(bearer(TOKEN)), null);
  assert.equal(configured.posture().creditBudget, 50);

  const customRate = Guard.fromEnv({ TRACE_RATE_LIMIT_PER_MIN: '20' });
  assert.equal(customRate.posture().ratePerMin, 20);
});
