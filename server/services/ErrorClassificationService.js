function getErrorHaystack(record) {
  return [
    record?.name,
    record?.message,
    record?.stack,
    record?.meta?.filename,
    record?.meta?.source,
    record?.url,
    record?.path,
    record?.userAgent,
  ].map(v => String(v || '').toLowerCase()).join('\n');
}

const RULES = [
  {
    code: 'known-third-party-autofill-webview',
    label: 'Injected autofill/webview noise',
    actionable: false,
    ignoreOnIngest: true,
    matches(haystack) {
      return haystack.includes("can't find variable: _autofillcallbackhandler")
        || haystack.includes("can't find variable: _paymentautofillcallbackhandler")
        || haystack.includes('getvaluesofautofillinputs');
    }
  }
];

function classifyErrorRecord(record) {
  const haystack = getErrorHaystack(record);
  const matched = RULES.find(rule => rule.matches(haystack));
  if (matched) {
    return {
      code: matched.code,
      label: matched.label,
      actionable: matched.actionable,
      ignoreOnIngest: matched.ignoreOnIngest,
    };
  }

  return {
    code: 'actionable-runtime-error',
    label: 'Actionable runtime error',
    actionable: true,
    ignoreOnIngest: false,
  };
}

function summarizeErrors(records, { limit = 5 } = {}) {
  const items = Array.isArray(records) ? records : [];
  const classified = items.map(record => ({
    record,
    classification: classifyErrorRecord(record)
  }));
  const actionable = classified.filter(item => item.classification.actionable);
  const knownNoise = classified.filter(item => !item.classification.actionable);

  const byClassification = new Map();
  classified.forEach(item => {
    const key = item.classification.code;
    const existing = byClassification.get(key) || {
      code: item.classification.code,
      label: item.classification.label,
      actionable: item.classification.actionable,
      count: 0,
    };
    existing.count += 1;
    byClassification.set(key, existing);
  });

  const actionableMessages = new Map();
  actionable.forEach(item => {
    const key = String(item.record?.message || item.record?.name || 'Unknown error').trim() || 'Unknown error';
    const existing = actionableMessages.get(key) || { message: key, count: 0, lastSeenAt: null };
    existing.count += 1;
    const seenAt = item.record?.createdAt || item.record?.updatedAt || null;
    if (!existing.lastSeenAt || (seenAt && seenAt > existing.lastSeenAt)) existing.lastSeenAt = seenAt;
    actionableMessages.set(key, existing);
  });

  return {
    total: items.length,
    actionableCount: actionable.length,
    knownNoiseCount: knownNoise.length,
    byClassification: Array.from(byClassification.values()).sort((a, b) => b.count - a.count),
    topActionableMessages: Array.from(actionableMessages.values())
      .sort((a, b) => b.count - a.count || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
      .slice(0, limit),
  };
}

module.exports = {
  classifyErrorRecord,
  summarizeErrors,
};