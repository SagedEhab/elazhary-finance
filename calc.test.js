const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('./calc.js');

const TODAY = '2026-11-04';

const cert = (over = {}) => ({
  amountCents: 10000000, // 100,000.00
  rateMilli: 27250, // 27.25%
  frequency: 'monthly',
  endDate: '2027-01-31',
  startDate: null,
  payoutOverrideCents: null,
  ...over,
});

const loan = (over = {}) => ({
  balanceCents: 10000000,
  rateMilli: 20000, // 20%
  type: 'installment',
  nextDate: '2026-12-01',
  endDate: '2027-11-01', // 12 payments
  paymentOverrideCents: null,
  ...over,
});

test('parses money exactly, including Arabic digits', () => {
  assert.equal(Calc.parseMoney('100,000.5'), 10000050);
  assert.equal(Calc.parseMoney('١٠٠٬٠٠٠٫٥'), 10000050);
  assert.equal(Calc.parseMoney('1.005'), null);
  assert.equal(Calc.parseMoney('abc'), null);
  assert.equal(Calc.parseMoney(''), null);
});

test('parses and formats rates', () => {
  assert.equal(Calc.parseRate('27.25'), 27250);
  assert.equal(Calc.parseRate('٢٧٫٢٥٪'), 27250);
  assert.equal(Calc.parseRate('101'), null);
  assert.equal(Calc.formatRate(27250), '27.25%');
  assert.equal(Calc.formatRate(18000), '18%');
  assert.equal(Calc.formatRate(500), '0.5%');
});

test('formats money with grouping', () => {
  assert.equal(Calc.formatMoney(123456789), '1,234,567.89');
  assert.equal(Calc.formatMoney(-7), '-0.07');
  assert.equal(Calc.formatMoney(0), '0.00');
});

test('calculates a certificate payout for each frequency', () => {
  assert.equal(Calc.payoutCents(cert({ frequency: 'daily' })), 7466);
  assert.equal(Calc.payoutCents(cert()), 227083);
  assert.equal(Calc.payoutCents(cert({ frequency: 'quarterly' })), 681250);
  assert.equal(Calc.payoutCents(cert({ frequency: 'semiannual' })), 1362500);
  assert.equal(Calc.payoutCents(cert({ frequency: 'annual' })), 2725000);
});

test('annual income equals the rounded payouts actually received', () => {
  assert.equal(Calc.annualCents(cert()), 2724996);
  assert.equal(Calc.monthlyCents(cert({ frequency: 'quarterly' })), 227083);
});

test('stays exact for very large amounts', () => {
  const big = cert({ amountCents: 900000000000000, rateMilli: 33333, frequency: 'annual' });
  assert.equal(Calc.payoutCents(big), 299997000000000);
});

test('a payout entered by hand replaces the calculated one', () => {
  const c = cert({ payoutOverrideCents: 230000 });
  assert.equal(Calc.payoutCents(c), 230000);
  assert.equal(Calc.annualCents(c), 2760000);
});

test('counts back from the end date and clamps short months', () => {
  assert.deepEqual(Calc.remainingPayoutDates(cert(), TODAY), [
    '2026-11-30',
    '2026-12-31',
    '2027-01-31',
  ]);
});

test('summarizes what a certificate has left to pay', () => {
  const s = Calc.summarizeCertificate(cert(), TODAY);
  assert.equal(s.payoutsLeft, 3);
  assert.equal(s.leftToReceive, 681249);
  assert.equal(s.nextPayout, '2026-11-30');
  assert.equal(s.daysLeft, 88);
  assert.equal(s.ended, false);
});

test('a certificate with no end date still earns monthly profit', () => {
  const s = Calc.summarizeCertificate(cert({ endDate: null }), TODAY);
  assert.equal(s.monthly, 227083);
  assert.equal(s.leftToReceive, null);
  assert.equal(s.nextPayout, null);
  assert.equal(s.daysLeft, null);
  assert.equal(s.ended, false);
});

test('daily interest keeps the full yearly rate', () => {
  const c = cert({ frequency: 'daily', endDate: null });
  assert.equal(Calc.annualCents(c), 2725000);
  assert.equal(Calc.monthlyCents(c), 227083);
});

test('daily interest grows with each day since it started', () => {
  const c = cert({ frequency: 'daily', endDate: '2026-11-14', startDate: '2026-11-01' });
  const s = Calc.summarizeCertificate(c, TODAY);
  assert.equal(s.daysEarned, 3);
  assert.equal(s.earnedSoFar, 22397); // 100,000 x 27.25% x 3 / 365
  assert.equal(s.payoutsLeft, 10);
  assert.equal(s.leftToReceive, 74658);
});

test('daily interest stops growing once the certificate ends', () => {
  const c = cert({ frequency: 'daily', endDate: '2026-11-02', startDate: '2026-11-01' });
  const s = Calc.summarizeCertificate(c, TODAY);
  assert.equal(s.ended, true);
  assert.equal(s.daysEarned, 1);
  assert.equal(s.leftToReceive, 0);
});

test('calculates an equal installment on a reducing balance', () => {
  assert.equal(Calc.countMonthlyPayments('2026-12-01', '2027-11-01'), 12);
  assert.equal(Calc.loanPayment(loan()), 926345);
});

test('a loan balance falls as payment dates pass', () => {
  const before = Calc.summarizeLoan(loan(), TODAY);
  assert.equal(before.balance, 10000000);
  assert.equal(before.nextPayment, '2026-12-01');
  assert.equal(before.interest, 166667);

  const after = Calc.summarizeLoan(loan(), '2026-12-02');
  assert.equal(after.balance, 10000000 + 166667 - 926345);
  assert.equal(after.nextPayment, '2027-01-01');
});

test('an installment loan is exactly paid off after its last payment', () => {
  const s = Calc.summarizeLoan(loan(), '2027-11-02');
  assert.equal(s.balance, 0);
  assert.equal(s.paidOff, true);
  assert.equal(s.payment, 0);
  assert.equal(s.interest, 0);
  assert.equal(s.nextPayment, null);
});

test('an interest-only loan keeps its balance until the end date', () => {
  const l = loan({ type: 'interestOnly', rateMilli: 24000 });
  const s = Calc.summarizeLoan(l, '2027-06-15');
  assert.equal(s.balance, 10000000);
  assert.equal(s.payment, 200000);
  assert.equal(s.interest, 200000);
  assert.equal(s.overdue, false);

  const late = Calc.summarizeLoan(l, '2027-11-02');
  assert.equal(late.balance, 10000000);
  assert.equal(late.overdue, true);
  assert.equal(late.payment, 0);
});

test('a loan payment entered by hand is used instead', () => {
  const l = loan({ endDate: null, paymentOverrideCents: 1000000 });
  assert.equal(Calc.loanPayment(l), 1000000);
  const s = Calc.summarizeLoan(l, '2026-12-02');
  assert.equal(s.balance, 10000000 + 166667 - 1000000);
});

test('bank summary separates profit from what you actually receive', () => {
  const bank = {
    certificates: [cert(), cert({ amountCents: 5000000, endDate: '2026-01-01' })],
    loans: [loan()],
  };
  const s = Calc.summarizeBank(bank, TODAY);
  assert.equal(s.worth, 10000000);
  assert.equal(s.activeCerts, 1);
  assert.equal(s.endedCerts, 1);
  assert.equal(s.averageRate, 27250);
  assert.equal(s.certMonthly, 227083);
  assert.equal(s.owed, 10000000);
  assert.equal(s.loanPayment, 926345);
  assert.equal(s.loanInterest, 166667);
  assert.equal(s.monthlyProfit, 227083 - 166667);
  assert.equal(s.monthlyGet, 227083 - 926345);
});

test('portfolio totals add up every bank', () => {
  const banks = [
    { certificates: [cert()], loans: [] },
    { certificates: [], loans: [loan({ rateMilli: 60000, type: 'interestOnly' })] },
  ];
  const s = Calc.summarizeAll(banks, TODAY);
  assert.equal(s.worth, 10000000);
  assert.equal(s.owed, 10000000);
  assert.equal(s.monthlyProfit, 227083 - 500000);
  assert.ok(s.monthlyProfit < 0);
});

test('validates real calendar dates', () => {
  assert.equal(Calc.isValidDate('2028-02-29'), true);
  assert.equal(Calc.isValidDate('2027-02-29'), false);
  assert.equal(Calc.isValidDate('nope'), false);
});
