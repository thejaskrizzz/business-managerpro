// Uses synthetic data only. Run with PUPPETEER_EXECUTABLE_PATH if Chrome is not bundled.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { generateSOAPDF } = require('../utils/pdfGenerator');

(async () => {
    const bytes = await generateSOAPDF({
        period: { from: '2026-10-01', to: '2026-10-24' },
        invoices: [
            { type: 'invoice', invoiceDate: '2026-10-01', invoiceNumber: 'TEST-001', description: 'Synthetic invoice', amount: 100, payment: 0, runningBalance: 100 },
            { type: 'credit_note', invoiceDate: '2026-10-02', invoiceNumber: 'TEST-CN', description: 'Synthetic credit note', amount: -30, payment: 30, runningBalance: 100 }
        ],
        totalInvoiced: 100, totalPayments: 0, creditDeducted: 30, netBalanceDue: 70, remainingCreditAfterSOA: 0
    }, { name: 'Synthetic Test Company', settings: { currency: 'AED' } }, { firstName: 'Test', lastName: 'Customer' });
    assert.equal(Buffer.isBuffer(bytes), true);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    if (process.argv[2]) fs.writeFileSync(process.argv[2], bytes);
    console.log(`Real browser PDF smoke test passed: ${bytes.length} bytes`);
})().catch(error => { console.error(error); process.exitCode = 1; });
