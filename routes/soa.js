const express = require('express');
const mongoose = require('mongoose');
const { applySoaCredit } = require('../utils/applySoaCredit');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Company = require('../models/Company');
const Customer = require('../models/Customer');
const CreditNote = require('../models/CreditNote');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { generateSOAPDF } = require('../utils/pdfGenerator');

// @route   GET /api/soa
// @desc    Get Statement of Account for a customer with credit note support
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { customer_id, from, to, deduct_credit } = req.query;

        if (!customer_id || !from || !to) {
            return res.status(400).json({ message: 'Missing required parameters: customer_id, from, to' });
        }

        if (!mongoose.isObjectIdOrHexString(customer_id)) return res.status(400).json({ message: 'Invalid customer ID' });
        if (!req.user?.company?._id) return res.status(403).json({ message: 'User must belong to a company' });
        const customer = await Customer.findOne({ _id: customer_id, company: req.user.company._id });
        if (!customer) return res.status(404).json({ message: 'Customer not found' });
        // Parse dates
        // Using start of day for 'from' and end of day for 'to' to be inclusive
        const fromDate = new Date(from);
        fromDate.setHours(0, 0, 0, 0);

        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        const companyId = req.user?.company?._id;

        // Build query for Invoices in date range
        const invoiceQuery = {
            customer: customer_id,
            invoiceNumber: { $exists: true, $ne: null },
            status: { $ne: 'cancelled' },
            createdAt: { $gte: fromDate, $lte: toDate }
        };
        if (companyId) {
            invoiceQuery.company = companyId;
        }

        // Build query for Credit Notes in date range
        const cnQuery = {
            customer: customer_id,
            creditNoteNumber: { $exists: true, $ne: null },
            createdAt: { $gte: fromDate, $lte: toDate }
        };
        if (companyId) {
            cnQuery.company = companyId;
        }

        // Build query for all currently available Credit Notes (active credits in customer's account)
        const activeCnQuery = {
            customer: customer_id,
            status: { $in: ['unused', 'partially_used'] },
            $or: [
                { expiryDate: null },
                { expiryDate: { $gt: new Date() } }
            ]
        };
        if (companyId) {
            activeCnQuery.company = companyId;
        }

        // Fetch Invoices, Period Credit Notes, and Total Available Credits concurrently
        const [invoices, creditNotesInPeriod, availableCreditNotes] = await Promise.all([
            Invoice.find(invoiceQuery).sort({ createdAt: 1 }).lean(),
            CreditNote.find(cnQuery).sort({ createdAt: 1 }).lean(),
            CreditNote.find(activeCnQuery).sort({ createdAt: 1 }).lean()
        ]);

        const totalAvailableCredit = availableCreditNotes.reduce(
            (sum, cn) => sum + Number(cn.remainingBalance || 0),
            0
        );

        // Process invoices
        const invoiceItems = invoices.map(invoice => {
            const description = invoice.items && invoice.items.length > 0
                ? invoice.items.map(item => item.name).filter(Boolean).join(', ')
                : (invoice.description || invoice.title || 'Invoice');

            const amount = Number(invoice.total || 0);
            const taxAmount = Number(invoice.taxAmount || 0);
            const subtotal = Number(invoice.subtotal || (amount - taxAmount));
            const paidAmount = Number(invoice.paidAmount || 0);
            const creditApplied = Number(invoice.creditApplied || 0);
            const payment = paidAmount + creditApplied;
            const balance = Math.max(0, amount - payment);

            return {
                _id: invoice._id,
                type: 'invoice',
                invoiceDate: invoice.createdAt,
                invoiceNumber: invoice.invoiceNumber,
                description,
                subtotal,
                taxAmount,
                amount,
                paidAmount,
                creditApplied,
                payment,
                balance,
                rawDate: new Date(invoice.createdAt).getTime()
            };
        });

        // Process credit notes issued in the period
        const creditNoteItems = creditNotesInPeriod.map(cn => {
            const description = cn.returnReason
                ? `Credit Note (${cn.returnReason})`
                : (cn.returnedItems && cn.returnedItems.length > 0
                    ? `Credit Note - ${cn.returnedItems.map(i => i.productName).filter(Boolean).join(', ')}`
                    : 'Credit Note / Return');

            const creditAmount = Number(cn.creditAmount || 0);
            const remainingBalance = Number(cn.remainingBalance || 0);
            const usedAmount = Number(cn.usedAmount || 0);

            return {
                _id: cn._id,
                type: 'credit_note',
                invoiceDate: cn.createdAt,
                invoiceNumber: cn.creditNoteNumber,
                description,
                subtotal: -(cn.subtotal || creditAmount),
                taxAmount: -(cn.taxAmount || 0),
                amount: -creditAmount,
                paidAmount: 0,
                creditApplied: usedAmount,
                payment: creditAmount,
                balance: remainingBalance,
                remainingBalance,
                status: cn.status,
                rawDate: new Date(cn.createdAt).getTime()
            };
        });

        // Merge invoices and credit notes chronologically
        const allItems = [...invoiceItems, ...creditNoteItems].sort((a, b) => a.rawDate - b.rawDate);

        // Credit notes are informational rows. Available credit is deducted once in
        // the summary; this column tracks issued invoice debt before wallet credits.
        let runningBalance = 0;
        const uniqueItems = allItems.map(item => {
            if (item.type === 'invoice') runningBalance += item.balance;
            return { ...item, runningBalance };
        });

        // Totals
        const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
        const totalTax = invoices.reduce((sum, inv) => sum + Number(inv.taxAmount || 0), 0);
        const totalSubtotal = invoices.reduce((sum, inv) => sum + Number(inv.subtotal || (inv.total - (inv.taxAmount || 0))), 0);
        const totalPaidCash = invoices.reduce((sum, inv) => sum + Number(inv.paidAmount || 0), 0);
        const totalCreditApplied = invoices.reduce((sum, inv) => sum + Number(inv.creditApplied || 0), 0);
        const totalPayments = totalPaidCash + totalCreditApplied;
        const totalOutstandingInvoices = invoiceItems.reduce((sum, inv) => sum + inv.balance, 0);

        // Determine if credit should be reduced
        const shouldDeductCredit = deduct_credit !== 'false';
        const creditDeducted = shouldDeductCredit ? Math.min(totalAvailableCredit, totalOutstandingInvoices) : 0;
        const netBalanceDue = Math.max(0, totalOutstandingInvoices - creditDeducted);
        const remainingCreditAfterSOA = Math.max(0, totalAvailableCredit - creditDeducted);

        const avgTaxRate = totalSubtotal > 0 ? Math.round((totalTax / totalSubtotal) * 100) : 0;

        const statementData = {
            customer_id,
            period: { from, to },
            statementDate: new Date(),
            invoices: uniqueItems,
            totalInvoiced,
            totalTax,
            totalSubtotal,
            totalPayments,
            totalPaidCash,
            totalCreditApplied,
            totalPaidAndApplied: totalPayments,
            totalOutstandingInvoices,
            availableCreditBalance: totalAvailableCredit,
            deductCredit: shouldDeductCredit,
            creditDeducted,
            netBalanceDue,
            remainingCreditAfterSOA,
            totalBalance: netBalanceDue,
            grandTotal: netBalanceDue,
            avgTaxRate,
            availableCreditNotes: availableCreditNotes.map(cn => ({
                _id: cn._id,
                creditNoteNumber: cn.creditNoteNumber,
                creditAmount: cn.creditAmount,
                usedAmount: cn.usedAmount,
                remainingBalance: cn.remainingBalance,
                createdAt: cn.createdAt,
                status: cn.status
            }))
        };

        // Check for PDF format
        if (req.query.format === 'pdf') {
            let company = null;
            if (req.user?.company && req.user.company.name) {
                company = req.user.company;
            } else if (companyId) {
                company = await Company.findById(companyId);
            }


            const pdfResult = await generateSOAPDF(statementData, company, customer);

            const outBuffer = Buffer.from(pdfResult);
            if (outBuffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF output');
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="SOA-${customer_id}-${toDate.toISOString().slice(0, 10)}.pdf"`);
            return res.send(outBuffer);
        }
        res.json(statementData);
    } catch (err) {
        console.error('Error generating SOA:', err);
        res.status(err.code === 'PDF_UNAVAILABLE' ? 503 : 500).json({ message: err.code === 'PDF_UNAVAILABLE'
            ? 'PDF generation is unavailable. Ask the administrator to check the server browser installation.'
            : 'Server error generating Statement of Account' });
    }
});

router.post('/apply-credit', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { customer_id, amount } = req.body;
        const companyId = req.user?.company?._id;
        if (!companyId) return res.status(403).json({ message: 'User must belong to a company' });
        if (!mongoose.isObjectIdOrHexString(customer_id)) return res.status(400).json({ message: 'Invalid customer ID' });
        const result = await applySoaCredit({ companyId, customerId: customer_id, amount });
        res.json({ message: `Successfully applied ${result.totalApplied.toFixed(2)} credit to customer invoices`, ...result });
    } catch (err) {
        console.error('Error applying credit via SOA:', err);
        const unsupported = err.code === 20 || err.code === 303;
        res.status(err.status || (unsupported ? 503 : 500)).json({ message: err.status ? err.message : unsupported
            ? 'Safe credit settlement requires MongoDB transaction support. Contact the administrator.'
            : 'Credit settlement could not be confirmed. Refresh balances before trying again.' });
    }
});

module.exports = router;
