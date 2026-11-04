const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeData } = require('./merge.js');

const cert = (id, amountCents = 100) => ({ id, name: '', amountCents, rateMilli: 1000, frequency: 'monthly', endDate: null });
const bank = (id, certificates = [], loans = [], catalogId = id) => ({ id, catalogId, certificates, loans });
const data = (...banks) => ({ version: 2, banks });
const ids = (result) => result.banks.map((b) => b.id);
const certIds = (result, i = 0) => result.banks[i].certificates.map((c) => c.id);

test('uploads local data when nothing is shared yet', () => {
  const local = data(bank('a'));
  assert.deepEqual(mergeData(null, local, null), local);
});

test('keeps certificates each person added to the same bank', () => {
  const base = data(bank('a'));
  const mine = data(bank('a', [cert('me')]));
  const father = data(bank('a', [cert('dad')]));
  assert.deepEqual(certIds(mergeData(base, mine, father)).sort(), ['dad', 'me']);
});

test('keeps banks each person added', () => {
  const base = data(bank('a'));
  const result = mergeData(base, data(bank('a'), bank('b')), data(bank('a'), bank('c')));
  assert.deepEqual(ids(result).sort(), ['a', 'b', 'c']);
});

test('a certificate deleted here stays deleted', () => {
  const base = data(bank('a', [cert('x'), cert('y')]));
  const mine = data(bank('a', [cert('y')]));
  const father = data(bank('a', [cert('x'), cert('y')]));
  assert.deepEqual(certIds(mergeData(base, mine, father)), ['y']);
});

test('a certificate the other person deleted stays deleted', () => {
  const base = data(bank('a', [cert('x'), cert('y')]));
  const mine = data(bank('a', [cert('x'), cert('y')]));
  const father = data(bank('a', [cert('y')]));
  assert.deepEqual(certIds(mergeData(base, mine, father)), ['y']);
});

test('a bank the other person deleted stays deleted', () => {
  const base = data(bank('a'), bank('b'));
  assert.deepEqual(ids(mergeData(base, data(bank('a'), bank('b')), data(bank('a')))), ['a']);
});

test('an edit survives the other person deleting the same certificate', () => {
  const base = data(bank('a', [cert('x', 100)]));
  const mine = data(bank('a', [cert('x', 200)]));
  const father = data(bank('a', []));
  assert.equal(mergeData(base, mine, father).banks[0].certificates[0].amountCents, 200);
});

test("takes the other person's edit when this device didn't change it", () => {
  const base = data(bank('a', [cert('x', 100)]));
  const father = data(bank('a', [cert('x', 300)]));
  assert.equal(mergeData(base, base, father).banks[0].certificates[0].amountCents, 300);
});

test('when both edit the same certificate, the later save wins', () => {
  const base = data(bank('a', [cert('x', 100)]));
  const mine = data(bank('a', [cert('x', 200)]));
  const father = data(bank('a', [cert('x', 300)]));
  assert.equal(mergeData(base, mine, father).banks[0].certificates[0].amountCents, 200);
});

test('edits to different certificates both survive', () => {
  const base = data(bank('a', [cert('x', 1), cert('y', 1)]));
  const mine = data(bank('a', [cert('x', 2), cert('y', 1)]));
  const father = data(bank('a', [cert('x', 1), cert('y', 3)]));
  const [x, y] = mergeData(base, mine, father).banks[0].certificates;
  assert.equal(x.amountCents, 2);
  assert.equal(y.amountCents, 3);
});

test('merges loans the same way', () => {
  const loan = (id) => ({ id, balanceCents: 100 });
  const base = data(bank('a'));
  const result = mergeData(base, data(bank('a', [], [loan('m')])), data(bank('a', [], [loan('d')])));
  assert.deepEqual(result.banks[0].loans.map((l) => l.id).sort(), ['d', 'm']);
});

test('two devices that added the same bank before syncing share one bank', () => {
  const mine = data(bank('id-1', [cert('me')], [], 'nbe'));
  const father = data(bank('id-2', [cert('dad')], [], 'nbe'));
  const result = mergeData(null, mine, father);
  assert.equal(result.banks.length, 1);
  assert.deepEqual(certIds(result).sort(), ['dad', 'me']);
});

test('custom banks with no catalog entry are never combined', () => {
  const a = { id: 'a', name: 'One', certificates: [], loans: [] };
  const b = { id: 'b', name: 'Two', certificates: [], loans: [] };
  assert.equal(mergeData(null, data(a), data(b)).banks.length, 2);
});
