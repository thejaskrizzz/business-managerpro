const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(file, mocks) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        module, exports: module.exports, Buffer, process: { platform: 'win32' }, console: { error() {}, log() {}, warn() {} },
        require(name) { if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`); return mocks[name]; }
    });
    return module.exports;
}

function fixture({ invoiceFailure = false, unsupported = false } = {}) {
    let state = {
        notes: [{ _id: 'cn1', remainingBalance: 30, usedAmount: 0, creditNoteNumber: 'CN1' },
            { _id: 'cn2', remainingBalance: 50, usedAmount: 0, creditNoteNumber: 'CN2' }],
        invoices: [{ _id: 'inv1', total: 40, paidAmount: 10, creditApplied: 0, invoiceNumber: 'INV1', status: 'sent' },
            { _id: 'inv2', total: 100, paidAmount: 0, creditApplied: 0, invoiceNumber: 'INV2', status: 'sent' }]
    };
    const original = structuredClone(state);
    let ended = false;
    const session = {
        async withTransaction(fn) {
            if (unsupported) throw Object.assign(new Error('Transaction unsupported'), { code: 20 });
            try { return await fn(); } catch (error) { state = structuredClone(original); throw error; }
        },
        async endSession() { ended = true; }
    };
    const query = value => ({ sort() { return this; }, session(actual) { assert.equal(actual, session); return this; }, async lean() { return structuredClone(value); } });
    function model(key) {
        return {
            find(filter) { assert.equal(filter.company, 'company'); assert.equal(filter.customer, 'customer'); return query(state[key]); },
            async updateOne(filter, update, options) {
                assert.equal(options.session, session);
                if (invoiceFailure && key === 'invoices') throw new Error('Invoice write failed');
                const doc = state[key].find(d => d._id === filter._id);
                Object.assign(doc, update.$set);
                for (const [field, amount] of Object.entries(update.$inc || {})) doc[field] += amount;
                return { modifiedCount: 1 };
            }
        };
    }
    const { applySoaCredit } = load('utils/applySoaCredit.js', {
        mongoose: { startSession: async () => session },
        '../models/Invoice': model('invoices'), '../models/CreditNote': model('notes'),
        '../models/Customer': { findOne: () => query({ _id: 'customer' }) }
    });
    return { apply: amount => applySoaCredit({ companyId: 'company', customerId: 'customer', amount }),
        state: () => state, original, ended: () => ended };
}

test('FIFO splits credits across issued invoices and preserves invoice totals', async () => {
    const f = fixture();
    const result = await f.apply(60);
    assert.equal(result.totalApplied, 60);
    assert.equal(f.state().notes[0].remainingBalance, 0);
    assert.equal(f.state().notes[1].remainingBalance, 20);
    assert.equal(f.state().invoices[0].status, 'paid');
    assert.equal(f.state().invoices[1].creditApplied, 30);
    assert.equal(f.state().invoices[0].total, 40);
    assert.equal(f.state().invoices[0].paidAmount, 10);
    assert.equal(f.ended(), true);
});

test('invoice failure aborts transaction and ends session', async () => {
    const f = fixture({ invoiceFailure: true });
    await assert.rejects(f.apply(30), /Invoice write failed/);
    assert.deepEqual(f.state(), f.original);
    assert.equal(f.ended(), true);
});

test('unsupported transactions fail without writes', async () => {
    const f = fixture({ unsupported: true });
    await assert.rejects(f.apply(30), /unsupported/);
    assert.deepEqual(f.state(), f.original);
});

test('reject invalid amounts and excess requests without settlement', async () => {
    for (const amount of [0, -1, NaN, Infinity, '30', null, undefined, 0.001, 100]) {
        const f = fixture();
        await assert.rejects(f.apply(amount));
        assert.deepEqual(f.state(), f.original);
    }
});

function statementFixture({ deduct = 'false', company = 'company', customer = true, pdf } = {}) {
    const handlers = {};
    const chain = rows => ({ sort() { return this; }, async lean() { return rows; } });
    const invoice = { _id: 'i', invoiceNumber: 'INV', createdAt: '2026-10-02', total: 100, subtotal: 100 };
    const note = { _id: 'c', creditNoteNumber: 'CN', createdAt: '2026-10-03', creditAmount: 30, remainingBalance: 30 };
    load('routes/soa.js', {
        express: { Router: () => ({ get: (p, ...h) => handlers.get = h.at(-1), post() {} }) },
        mongoose: { isObjectIdOrHexString: () => true }, '../utils/applySoaCredit': {},
        '../middleware/auth': { authenticateToken() {}, requireRole: () => () => {} },
        '../models/Invoice': { find: () => chain([invoice]) }, '../models/CreditNote': { find: () => chain([note]) },
        '../models/Customer': { findOne: async filter => { assert.equal(filter.company, 'company'); return customer ? {} : null; } },
        '../models/Company': { findById: async () => ({}) },
        '../utils/pdfGenerator': { generateSOAPDF: async () => pdf }
    });
    const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; }, send(body) { this.body = body; }, setHeader() {} };
    return handlers.get({ user: { company: company ? { _id: company } : null }, query: {
        customer_id: 'customer', from: '2026-10-01', to: '2026-10-24', deduct_credit: deduct, format: pdf ? 'pdf' : undefined
    } }, response).then(() => response);
}

test('deduction off preserves wallet; running balance explicitly excludes preview deductions', async () => {
    const { body } = await statementFixture();
    assert.equal(body.netBalanceDue, 100);
    assert.equal(body.remainingCreditAfterSOA, 30);
    assert.equal(body.invoices.at(-1).runningBalance, 100);
});

test('deduction on subtracts wallet exactly once', async () => {
    const { body } = await statementFixture({ deduct: 'true' });
    assert.equal(body.netBalanceDue, 70);
    assert.equal(body.creditDeducted, 30);
    assert.equal(body.invoices.at(-1).runningBalance, 100);
});

test('missing company and cross-company customer fail closed', async () => {
    assert.equal((await statementFixture({ company: null })).code, 403);
    assert.equal((await statementFixture({ customer: false })).code, 404);
});

test('PDF typed bytes become a Buffer; non-PDF data is rejected', async () => {
    const result = await statementFixture({ pdf: new Uint8Array(Buffer.from('%PDF-test')) });
    assert.equal(Buffer.isBuffer(result.body), true);
    assert.equal(result.body.toString(), '%PDF-test');
    assert.equal((await statementFixture({ pdf: Buffer.from('<html>') })).code, 500);
});

test('PDF renderer escapes customer text, returns bytes, and closes its browser', async () => {
    let closed = false;
    let html;
    const browser = { close: async () => { closed = true; }, newPage: async () => ({
        setJavaScriptEnabled: async enabled => assert.equal(enabled, false),
        setContent: async content => { html = content; }, pdf: async () => new Uint8Array(Buffer.from('%PDF-test'))
    }) };
    const mocks = { puppeteer: { launch: async () => browser }, 'html-pdf-node': {},
        path: require('node:path'), fs: {}, https: {}, http: {}, util: require('node:util') };
    const { generateSOAPDF } = load('utils/pdfGenerator.js', mocks);
    const bytes = await generateSOAPDF({ period: { from: '2026-10-01', to: '2026-10-24' }, invoices: [] }, {}, { firstName: '<script>alert(1)</script>' });
    assert.equal(bytes.toString(), '%PDF-test');
    assert.equal(closed, true);
    assert.ok(html.includes('&lt;script&gt;'));
    mocks.puppeteer.launch = async () => { throw new Error('No Chrome'); };
    await assert.rejects(generateSOAPDF({ period: { from: '2026-10-01', to: '2026-10-24' }, invoices: [] }, {}, {}), error => error.code === 'PDF_UNAVAILABLE');
});
