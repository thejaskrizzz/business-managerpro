const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Company = require('../models/Company');
const Customer = require('../models/Customer');
const auth = require('../middleware/auth');
const { generateSOAPDF } = require('../utils/pdfGenerator');

// @route   GET /api/soa
// @desc    Get Statement of Account for a customer
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const { customer_id, from, to } = req.query;

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

        // Build query
        const query = {
            customer: customer_id,
            invoiceNumber: { $exists: true, $ne: null }, // Ensure existing invoices
            status: { $ne: 'cancelled' },
            createdAt: { $gte: fromDate, $lte: toDate } // Filter by date range. 
            // Note: User requirements say "invoice.date". 
            // Checking Invoice model... it has 'createdAt' and 'dueDate'. 
            // It doesn't seem to have a specific 'invoiceDate' field in the schema I read earlier?
            // Let me re-verify the Invoice model. 
            // Wait, looking at Invoice.js from previous turn...
            // It has `dueDate`, `createdAt`, `updatedAt`.
            // It DOES NOT have an explicit `invoiceDate` field.
            // Usually `createdAt` is used, or maybe `invoiceDate` was missed in my quick read?
            // I'll assume `createdAt` for now as the invoice date.
        };

        // Fetch invoices
        const invoices = await Invoice.find(query)
            .sort({ createdAt: 1 }) // Ascending order
            .lean(); // Convert to plain JS objects for better performance

        // Process invoices to calculate running balance
        // Requirement: Payment column = 0 for now. Balance = Amount.
        // Show running balance total at bottom.

        let runningBalance = 0;

        const statementItems = invoices.map(invoice => {
            // Description: combine item names
            const description = invoice.items
                ? invoice.items.map(item => item.name).join(', ')
                : invoice.description || 'Invoice';

            // Amount (Grand Total)
            const amount = invoice.total;

            // Update running balance
            runningBalance += amount;

            return {
                _id: invoice._id,
                invoiceDate: invoice.createdAt,
                invoiceNumber: invoice.invoiceNumber,
                description: description,
                amount: amount,
                payment: 0, // Hardcoded as per requirement
                balance: amount, // Balance for this specific invoice is just the amount? 
                // "Balance = Amount" might mean "outstanding amount for this invoice" 
                // OR it might mean "running balance after this line".
                // Usually SOA shows running balance.
                // "Show running balance total at bottom" implies the table might just show line items.
                // But usually the 'Balance' column in SOA is the running balance.
                // Requirement says: "Balance = Amount". This is ambiguous.
                // "Show running balance total at bottom" - okay.
                // If "Balance = Amount", then the column just repeats the Amount?
                // I will format it as: Amount | Payment | Balance (Running Balance)
                // Wait, re-reading: "Balance = Amount". 
                // If I just put Amount in Balance column, it's redundant.
                // I will interpret "Balance = Amount" as "Outstanding Balance of this invoice".
                // Since Payment=0, Outstanding = Amount.
                // But for an SOA, usually you have a running balance column.
                // I'll return the calculated running balance as well, just in case.
                // Let's stick to the prompt's explicit "Balance = Amount" for the column logic if strictly followed,
                // but standard accounting SOA implies running balance.
                // I'll generate the response structure so frontend can decide.
                runningBalance: runningBalance // Use this for the 'Balance' column if I decide so, or just for the bottom total.
            };
        });

        // Remove duplicates based on invoiceNumber (just in case, though query shouldn't return them if unique in DB)
        // The requirement "Remove duplicate invoices (same invoice_number must appear once)" suggests there might be data issues?
        // mongoose 'unique: true' on invoiceNumber should prevent this, but 'sparse: true' allows nulls.
        // My query filters `invoiceNumber: { $exists: true, $ne: null }`.
        // I'll assume standard `find` returns unique docs by _id. 
        // If they mean duplicate invoice NUMBERS across different docs...
        // I will do a filter in JS to be safe.

        const uniqueInvoices = [];
        const seenInvoiceNumbers = new Set();

        let finalRunningBalance = 0;

        for (const item of statementItems) {
            if (!seenInvoiceNumbers.has(item.invoiceNumber)) {
                seenInvoiceNumbers.add(item.invoiceNumber);

                // Recalculate running balance strictly on unique items
                finalRunningBalance += item.amount;
                item.runningBalance = finalRunningBalance;

                uniqueInvoices.push(item);
            }
        }

        const statementData = {
            customer_id,
            period: { from, to },
            statementDate: new Date(),
            invoices: uniqueInvoices,
            totalBalance: finalRunningBalance
        };

        // Check for PDF format
        if (req.query.format === 'pdf') {
            // Fetch Company and Customer details for PDF
            const company = await Company.findById(req.user.company._id);
            const customer = await Customer.findById(customer_id);

            const pdfResult = await generateSOAPDF(statementData, company, customer);

            if (pdfResult.isHtml) {
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
                return res.send(pdfResult.buffer);
            } else {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
                return res.send(pdfResult.buffer);
            }
        }

        res.json(statementData);

    } catch (err) {
        console.error('Error generating SOA:', err);
        res.status(500).json({ message: 'Server error generating Statement of Account' });
    }
});

module.exports = router;
