/**
 * The Worker holds every refused sign-in for a fixed time (`WRONG_CREDENTIAL_DELAY_MS`, 400 ms, and 3 s more while the whole app is under
 * attack). That wait is the product, but 800+ tests refuse a sign-in on the way to what they check and waited it out for nothing: test/setup.ts
 * makes the Worker skip the wait (the failure is still counted). A test that measures the wait itself sets `floor.real` and gets the
 * production behaviour back; setup.ts resets it after every test.
 */
export const floor = { real: false };
