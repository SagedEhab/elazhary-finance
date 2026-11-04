// Combines two people's changes to the shared data. `base` is the last version
// both agreed on, so we can tell a deletion from something newly added. When
// both people changed the same certificate or loan, the later save wins.
(function (root) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function mergeItem(base, local, remote) {
    if (!base) return local;
    return same(local, base) ? remote : local;
  }

  function mergeLists(baseList, localList, remoteList, mergeEntry) {
    const base = new Map((baseList || []).map((x) => [x.id, x]));
    const local = new Map((localList || []).map((x) => [x.id, x]));
    const remote = new Map((remoteList || []).map((x) => [x.id, x]));
    const result = [];
    for (const id of new Set([...remote.keys(), ...local.keys()])) {
      const b = base.get(id);
      const l = local.get(id);
      const r = remote.get(id);
      if (l && r) result.push(mergeEntry(b, l, r));
      // Only one side has it: it was either added there or deleted here.
      // An entry the other person edited survives a deletion.
      else if (l && (!b || !same(b, l))) result.push(l);
      else if (r && (!b || !same(b, r))) result.push(r);
    }
    return result;
  }

  function mergeBank(base, local, remote) {
    const fields = mergeItem(
      base && { name: base.name, catalogId: base.catalogId },
      { name: local.name, catalogId: local.catalogId },
      { name: remote.name, catalogId: remote.catalogId }
    );
    return {
      id: remote.id,
      ...fields,
      certificates: mergeLists(base && base.certificates, local.certificates, remote.certificates, mergeItem),
      loans: mergeLists(base && base.loans, local.loans, remote.loans, mergeItem),
    };
  }

  // Two devices may each have added the same bank before first syncing.
  function combineSameBanks(banks) {
    const result = [];
    const byCatalog = new Map();
    for (const bank of banks) {
      const existing = bank.catalogId && byCatalog.get(bank.catalogId);
      if (existing) {
        existing.certificates = [...existing.certificates, ...bank.certificates];
        existing.loans = [...existing.loans, ...bank.loans];
      } else {
        const copy = { ...bank, certificates: [...bank.certificates], loans: [...(bank.loans || [])] };
        if (bank.catalogId) byCatalog.set(bank.catalogId, copy);
        result.push(copy);
      }
    }
    return result;
  }

  function mergeData(base, local, remote) {
    if (!remote) return local;
    const banks = mergeLists(base && base.banks, local.banks, remote.banks, mergeBank);
    return { version: 2, banks: combineSameBanks(banks) };
  }

  const api = { mergeData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Merge = api;
})(this);
