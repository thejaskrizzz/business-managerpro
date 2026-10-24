const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const CreditNote = require('../models/CreditNote');
const Customer = require('../models/Customer');

const cents = value => Math.round(Number(value || 0) * 100);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Only settlement fields are updated: save hooks would recalculate historical totals.
async function applySoaCredit({ companyId, customerId, amount }) {
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        throw fail('Enter a positive credit amount with at most two decimal places');
    }
    const session = await mongoose.startSession();
    try {
        return await session.withTransaction(async () => {
            const customer = await Customer.findOne({ _id: customerId, company: companyId }).session(session).lean();
            if (!customer) throw fail('Customer not found', 404);
            const scope = { company: companyId, customer: customerId };
            const notes = await CreditNote.find({ ...scope, status: { $in: ['unused', 'partially_used'] },
                remainingBalance: { $gt: 0 }, $or: [{ expiryDate: null }, { expiryDate: { $gt: new Date() } }]
            }).sort({ createdAt: 1, _id: 1 }).session(session).lean();
            const invoices = await Invoice.find({ ...scope, invoiceNumber: { $exists: true, $ne: null },
                status: { $nin: ['cancelled', 'draft'] }
            }).sort({ createdAt: 1, _id: 1 }).session(session).lean();
            const outstanding = inv => Math.max(0, cents(inv.total) - cents(inv.paidAmount) - cents(inv.creditApplied));
            const available = notes.reduce((sum, cn) => sum + cents(cn.remainingBalance), 0);
            const unpaid = invoices.reduce((sum, inv) => sum + outstanding(inv), 0);
            const target = cents(amount);
            if (target > Math.min(available, unpaid)) throw fail('Amount exceeds currently available credit or outstanding issued invoices. Refresh and try again.');
            let remaining = target;
            const appliedRedemptions = [];
            for (const inv of invoices) {
                let needed = Math.min(outstanding(inv), remaining);
                const invoiceRedemptions = [];
                for (const cn of notes) {
                    const deduction = Math.min(needed, cents(cn.remainingBalance));
                    if (deduction <= 0) continue;
                    const value = deduction / 100;
                    const balance = (cents(cn.remainingBalance) - deduction) / 100;
                    const result = await CreditNote.updateOne({ _id: cn._id, ...scope, remainingBalance: cn.remainingBalance }, {
                        $inc: { usedAmount: value },
                        $set: { remainingBalance: balance, status: balance === 0 ? 'fully_used' : 'partially_used' },
                        $push: { redemptions: { invoice: inv._id, amount: value, date: new Date(), notes: `Applied to invoice ${inv.invoiceNumber} via Statement of Account` } }
                    }, { session, runValidators: true });
                    if (result.modifiedCount !== 1) throw fail('Credit changed during settlement. Refresh and try again.', 409);
                    cn.remainingBalance = balance;
                    invoiceRedemptions.push({ creditNote: cn._id, amount: value });
                    appliedRedemptions.push({ invoiceNumber: inv.invoiceNumber, creditNoteNumber: cn.creditNoteNumber, amount: value });
                    needed -= deduction;
                    remaining -= deduction;
                }
                if (invoiceRedemptions.length) {
                    const added = invoiceRedemptions.reduce((sum, r) => sum + cents(r.amount), 0);
                    const creditApplied = (cents(inv.creditApplied) + added) / 100;
                    const result = await Invoice.updateOne({ _id: inv._id, ...scope }, {
                        $set: { creditApplied, finalPayable: Math.max(0, (cents(inv.total) - cents(creditApplied)) / 100),
                            status: outstanding(inv) === added ? 'paid' : inv.status },
                        $push: { creditNoteRedemptions: { $each: invoiceRedemptions } }
                    }, { session, runValidators: true });
                    if (result.modifiedCount !== 1) throw fail('Invoice changed during settlement. Refresh and try again.', 409);
                }
                if (!remaining) break;
            }
            if (remaining) throw fail('Unable to allocate the full credit amount', 409);
            return { totalApplied: target / 100, appliedRedemptions };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally {
        await session.endSession();
    }
}

module.exports = { applySoaCredit };
