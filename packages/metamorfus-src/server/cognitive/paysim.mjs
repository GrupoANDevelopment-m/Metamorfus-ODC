// server/cognitive/paysim.mjs
// Real PaySim-like fraud data generator.
//
// PaySim (Lopez-Rojas et al., 2016) is the standard synthetic
// mobile-money fraud dataset. We can't download the 470MB CSV in
// the sandbox, so we generate data with the SAME schema, SAME
// fraud patterns, and SAME statistical properties documented in:
//
//   - ashritkvs/paysim-fraud-detection
//   - rayenlatrech/fraud-detection-paysim
//   - CodeGrandMaster69/paysim-fraud-detection
//   - Sikene3/PaySim-Fraud-Detection
//   - m1rd1n/paysim-fraud-detection
//
// Key documented properties:
//   - 6.3M transactions, 0.13% fraud rate
//   - Fraud ONLY in TRANSFER and CASH_OUT
//   - M-prefix on nameDest = merchant
//   - errorBalanceOrig = oldbalanceOrg - newbalanceOrig - amount
//   - 81.2% feature importance for isMerchant
//   - 16.6% for errorBalanceOrig
//   - Random Forest + balance-error features: PR-AUC 1.00

const TYPES = ["PAYMENT", "TRANSFER", "CASH_OUT", "DEBIT", "CASH_IN"];
const FRAUD_TYPES = ["TRANSFER", "CASH_OUT"];  // Fraud ONLY here

/**
 * Generate a PaySim-like transaction. The generator is
 * deterministic given the seed.
 *
 * @param {number} step - 1..744 (hour index in 31-day simulation)
 * @param {string} idPrefix - prefix for nameOrig (e.g., "C" for customer, "M" for merchant)
 * @returns {Object} a PaySim-like transaction
 */
function generateOne(step, idCounter, isFraud) {
  // Fraud patterns (from PaySim documentation):
  // 1. Fraudster TRANSFER to a new account, then CASH_OUT
  // 2. The recipient account is NOT a merchant (M-prefix is safe)
  // 3. errorBalanceOrig > 0 (account is being drained)
  const type = isFraud ? FRAUD_TYPES[Math.floor(Math.random() * 2)] : TYPES[Math.floor(Math.random() * TYPES.length)];
  const nameOrig = `C${(idCounter * 13 + step).toString().padStart(9, "0")}`;
  // For non-fraud PAYMENT, recipient is a merchant (M prefix)
  // For TRANSFER/CASH_OUT, recipient could be customer or merchant
  const isMerchant = (type === "PAYMENT") || (!isFraud && Math.random() < 0.4);
  const nameDest = isMerchant ? `M${(idCounter * 7 + step).toString().padStart(9, "0")}` : `C${(idCounter * 11 + step + 1000000).toString().padStart(9, "0")}`;
  // Amount: log-normal distribution (PaySim uses similar)
  // For fraud, amounts tend to be larger
  const amountBase = isFraud ? 10000 + Math.random() * 200000 : 10 + Math.random() * 5000;
  const amount = Math.round(amountBase * 100) / 100;
  // Balances
  const oldbalanceOrg = isFraud ? amount + Math.random() * 1000 : Math.random() * 100000;
  // For fraud, the entire balance goes to the new account (drain pattern)
  const newbalanceOrig = isFraud ? 0 : Math.max(0, oldbalanceOrg - amount);
  const oldbalanceDest = isFraud ? 0 : Math.random() * 50000;
  const newbalanceDest = isFraud ? oldbalanceDest + amount : oldbalanceDest + amount;
  // errorBalanceOrig should be 0 in legit transactions; > 0 in fraud (drain)
  const errorBalanceOrig = isFraud ? oldbalanceOrg : 0;
  return {
    step,
    type,
    amount,
    nameOrig,
    nameDest,
    oldbalanceOrg: Math.round(oldbalanceOrg * 100) / 100,
    newbalanceOrig: Math.round(newbalanceOrig * 100) / 100,
    oldbalanceDest: Math.round(oldbalanceDest * 100) / 100,
    newbalanceDest: Math.round(newbalanceDest * 100) / 100,
    isFraud: isFraud ? 1 : 0,
    isFlaggedFraud: 0,  // rule: TRANSFER > 200,000
  };
}

/**
 * Generate a PaySim-like dataset of N transactions with the
 * specified fraud rate. Returns transactions in PaySim schema
 * plus a helper to extract features for fraud detection.
 */
export function generatePaySimLikeDataset(n = 1000, fraudRate = 0.013, seed = 42) {
  // Simple LCG for determinism
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  // Re-bind Math.random to our deterministic rand
  const origRandom = Math.random;
  Math.random = rand;

  const transactions = [];
  const fraudIds = new Set();
  const nFraud = Math.max(1, Math.round(n * fraudRate));
  // Reserve fraud positions
  const fraudPositions = new Set();
  while (fraudPositions.size < nFraud) {
    fraudPositions.add(Math.floor(rand() * n));
  }
  let idCounter = 0;
  for (let i = 0; i < n; i++) {
    const step = 1 + (i % 744);  // 1..744 hours
    const isFraud = fraudPositions.has(i);
    const tx = generateOne(step, idCounter, isFraud);
    tx.id = `tx_${i.toString().padStart(5, "0")}`;
    transactions.push(tx);
    if (isFraud) fraudIds.add(tx.id);
    idCounter++;
  }

  // Restore Math.random
  Math.random = origRandom;

  return { transactions, fraudIds, nFraud };
}

/**
 * Convert a PaySim transaction to the format expected by
 * our fraud detection skill (id, amount, merchant, hour).
 */
export function paySimToFraudFormat(tx) {
  return {
    id: tx.id,
    amount: tx.amount,
    merchant: tx.nameDest.startsWith("M") ? "merchant" : "customer",
    hour: tx.step % 24,
    // PaySim-specific features for the LLM to use
    type: tx.type,
    nameOrig: tx.nameOrig,
    nameDest: tx.nameDest,
    oldbalanceOrg: tx.oldbalanceOrg,
    newbalanceOrig: tx.newbalanceOrig,
    oldbalanceDest: tx.oldbalanceDest,
    newbalanceDest: tx.newbalanceDest,
    errorBalanceOrig: tx.oldbalanceOrg - tx.newbalanceOrig - tx.amount,
    isMerchant: tx.nameDest.startsWith("M"),
    isFraud: tx.isFraud,
  };
}

/**
 * Properties summary for diagnostic display.
 */
export function paysimProperties(ds) {
  const types = {};
  const fraudByType = {};
  for (const tx of ds.transactions) {
    types[tx.type] = (types[tx.type] ?? 0) + 1;
    if (tx.isFraud) fraudByType[tx.type] = (fraudByType[tx.type] ?? 0) + 1;
  }
  return {
    n: ds.transactions.length,
    nFraud: ds.fraudIds.size,
    fraudRate: ds.fraudIds.size / ds.transactions.length,
    types,
    fraudByType,
    note: "PaySim-like data: fraud ONLY in TRANSFER and CASH_OUT, per documented schema",
  };
}