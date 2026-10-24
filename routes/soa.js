const express = require('express');
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

        // Parse dates
        // Using start of day for 'from' and end of day for 'to' to be inclusive
        const fromDate = new Date(from);
        fromDate.setHours(0, 0, 0, 0);

        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
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

        // Deduplicate by reference number and calculate running balance
        const uniqueItems = [];
        const seenRefs = new Set();
        let runningBalance = 0;

        for (const item of allItems) {
            if (!seenRefs.has(item.invoiceNumber)) {
                seenRefs.add(item.invoiceNumber);

                if (item.type === 'invoice') {
                    runningBalance += (item.amount - item.payment);
                } else if (item.type === 'credit_note') {
                    runningBalance -= (item.remainingBalance !== undefined ? item.remainingBalance : Math.abs(item.amount));
                }
                item.runningBalance = Math.max(0, runningBalance);
                uniqueItems.push(item);
            }
        }

        // Totals
        const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
        const totalTax = invoices.reduce((sum, inv) => sum + Number(inv.taxAmount || 0), 0);
        const totalSubtotal = invoices.reduce((sum, inv) => sum + Number(inv.subtotal || (inv.total - (inv.taxAmount || 0))), 0);
        const totalPaidCash = invoices.reduce((sum, inv) => sum + Number(inv.paidAmount || 0), 0);
        const totalCreditApplied = invoices.reduce((sum, inv) => sum + Number(inv.creditApplied || 0), 0);
        const totalPayments = totalPaidCash + totalCreditApplied;
        const totalOutstandingInvoices = Math.max(0, totalInvoiced - totalPayments);

        // Determine if credit should be reduced
        const shouldDeductCredit = deduct_credit !== 'false';
        const creditDeducted = shouldDeductCredit ? Math.min(totalAvailableCredit, totalOutstandingInvoices) : 0;
        const netBalanceDue = Math.max(0, totalOutstandingInvoices - creditDeducted);
        const remainingCreditAfterSOA = Math.max(0, totalAvailableCredit - totalOutstandingInvoices);

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
            const customer = await Customer.findById(customer_id);

            const pdfResult = await generateSOAPDF(statementData, company, customer);

            if (pdfResult && pdfResult.isHtml) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename || 'SOA.html'}"`);
                return res.send(pdfResult.buffer);
            } else {
                res.setHeader('Content-Type', 'application/pdf');
                const filename = (pdfResult && pdfResult.filename) || `SOA-${customer ? customer.firstName : 'Customer'}-${to}.pdf`;
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                const outBuffer = Buffer.isBuffer(pdfResult) ? pdfResult : (pdfResult && pdfResult.buffer ? pdfResult.buffer : Buffer.from(pdfResult || ''));
                return res.send(outBuffer);
            }
        }

        res.json(statementData);

    } catch (err) {
        console.error('Error generating SOA:', err);
        res.status(500).json({ message: 'Server error generating Statement of Account' });
    }
});

// @route   POST /api/soa/apply-credit
// @desc    Apply customer available credit notes to unpaid invoices (FIFO) and reduce credit notes
// @access  Private (Admin / Manager)
router.post('/apply-credit', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { customer_id, amount } = req.body;
        if (!customer_id) {
            return res.status(400).json({ message: 'customer_id is required' });
        }

        const companyId = req.user?.company?._id;

        // Find available credit notes for this customer (oldest first, FIFO)
        const now = new Date();
        const cnQuery = {
            customer: customer_id,
            status: { $in: ['unused', 'partially_used'] },
            $or: [
                { expiryDate: null },
                { expiryDate: { $gt: now } }
            ]
        };
        if (companyId) cnQuery.company = companyId;

        const creditNotes = await CreditNote.find(cnQuery).sort({ createdAt: 1 });
        const totalAvailableCredit = creditNotes.reduce((sum, cn) => sum + Number(cn.remainingBalance || 0), 0);

        if (totalAvailableCredit <= 0.001) {
            return res.status(400).json({ message: 'No available credit notes found for this customer' });
        }

        // Find unpaid invoices for this customer (oldest first, FIFO)
        const invQuery = {
            customer: customer_id,
            status: { $ne: 'cancelled' }
        };
        if (companyId) invQuery.company = companyId;

        const invoices = await Invoice.find(invQuery).sort({ createdAt: 1 });

        const eligibleInvoices = invoices.filter(inv => {
            const outstanding = Math.max(0, Number(inv.total || 0) - Number(inv.paidAmount || 0) - Number(inv.creditApplied || 0));
            return outstanding > 0.001;
        });

        if (eligibleInvoices.length === 0) {
            return res.status(400).json({ message: 'Customer has no outstanding unpaid invoices' });
        }

        const totalUnpaid = eligibleInvoices.reduce((sum, inv) => {
            return sum + Math.max(0, Number(inv.total || 0) - Number(inv.paidAmount || 0) - Number(inv.creditApplied || 0));
        }, 0);

        const targetAmount = amount 
            ? Math.min(Number(amount), totalAvailableCredit, totalUnpaid) 
            : Math.min(totalAvailableCredit, totalUnpaid);

        if (targetAmount <= 0.001) {
            return res.status(400).json({ message: 'Invalid or zero credit amount to apply' });
        }

        let remainingToApply = targetAmount;
        let cnIndex = 0;
        const appliedRedemptions = [];

        for (const inv of eligibleInvoices) {
            if (remainingToApply <= 0.001) break;

            const invOutstanding = Math.max(0, Number(inv.total || 0) - Number(inv.paidAmount || 0) - Number(inv.creditApplied || 0));
            let invNeeded = Math.min(remainingToApply, invOutstanding);

            while (invNeeded > 0.001 && cnIndex < creditNotes.length) {
                const currentCN = creditNotes[cnIndex];
                if (currentCN.remainingBalance <= 0.001) {
                    cnIndex++;
                    continue;
                }

                const deduction = Math.min(invNeeded, currentCN.remainingBalance);

                // Update Credit Note
                currentCN.redemptions.push({
                    invoice: inv._id,
                    amount: deduction,
                    date: new Date(),
                    notes: `Applied to invoice ${inv.invoiceNumber} via Statement of Account`
                });
                currentCN.usedAmount = (currentCN.usedAmount || 0) + deduction;
                await currentCN.save(); // triggers pre-save recalc of remainingBalance & status

                // Update Invoice
                if (!inv.creditNoteRedemptions) inv.creditNoteRedemptions = [];
                inv.creditNoteRedemptions.push({
                    creditNote: currentCN._id,
                    amount: deduction
                });
                inv.creditApplied = (inv.creditApplied || 0) + deduction;
                inv.finalPayable = Math.max(0, (inv.total || 0) - inv.creditApplied);

                if ((inv.paidAmount || 0) + inv.creditApplied >= (inv.total || 0) - 0.001) {
                    inv.status = 'paid';
                }

                appliedRedemptions.push({
                    invoiceNumber: inv.invoiceNumber,
                    creditNoteNumber: currentCN.creditNoteNumber,
                    amount: deduction
                });

                invNeeded -= deduction;
                remainingToApply -= deduction;
            }

            await inv.save();
        }

        const totalApplied = targetAmount - remainingToApply;

        res.json({
            message: `Successfully applied ${totalApplied.toFixed(2)} credit to customer invoices`,
            totalApplied,
            appliedRedemptions
        });

    } catch (err) {
        console.error('Error applying credit via SOA:', err);
        res.status(500).json({ message: 'Server error applying credit to invoices' });
    }
});

module.exports = router;

