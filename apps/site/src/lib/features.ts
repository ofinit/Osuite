// What each product page says. Every claim here is something OSuite does today;
// every picture is a real screen from scripts/capture-screens.mjs.
import type { ImageMetadata } from 'astro';
import backups from '../assets/screens/backups.png';
import bank from '../assets/screens/bank.png';
import bills from '../assets/screens/bills.png';
import balanceSheet from '../assets/screens/balance-sheet.png';
import closing from '../assets/screens/closing.png';
import commandPalette from '../assets/screens/command-palette.png';
import dashboard from '../assets/screens/dashboard.png';
import dayBook from '../assets/screens/day-book.png';
import einvoiceSettings from '../assets/screens/einvoice-settings.png';
import gstr1 from '../assets/screens/gstr-1.png';
import gstr3b from '../assets/screens/gstr-3b.png';
import invoiceEinvoice from '../assets/screens/invoice-einvoice.png';
import invoiceEntry from '../assets/screens/invoice-entry.png';
import payments from '../assets/screens/payments.png';
import printInvoice from '../assets/screens/print-invoice.png';
import printProforma from '../assets/screens/print-proforma.png';
import printQuotation from '../assets/screens/print-quotation.png';
import printCredit from '../assets/screens/print-credit-note.png';
import printStatement from '../assets/screens/print-statement.png';
import invoicesList from '../assets/screens/invoices.png';
import profitLoss from '../assets/screens/profit-loss.png';
import quotations from '../assets/screens/quotations.png';
import receivables from '../assets/screens/receivables.png';
import statement from '../assets/screens/statement.png';
import stock from '../assets/screens/stock.png';
import stockLedger from '../assets/screens/stock-ledger.png';
import trialBalance from '../assets/screens/trial-balance.png';

export interface Shot {
  src: ImageMetadata;
  alt: string;
  /** CSS object-position for the crop. */
  focus?: string;
  /** A printed page (portrait sheet) rather than a screen. */
  sheet?: boolean;
}

export interface Chapter {
  /** Two lines at most at heading size. */
  claim: string;
  body: string[];
  shot?: Shot;
}

export interface Feature {
  slug: string;
  /** Name in lists and navigation. */
  name: string;
  /** Page title at display size: two short lines, uppercase. */
  title: [string, string];
  standfirst: string;
  /** Short line for the product index. */
  summary: string;
  hero: Shot;
  /** A screen recording for the top band; the hero shot is its poster. */
  video?: string;
  chapters: Chapter[];
  /** Three related screens, shown together as a strip near the end. */
  related: [Shot, Shot, Shot];
}

export const FEATURES: Feature[] = [
  {
    slug: 'invoicing',
    name: 'Invoicing and quotations',
    title: ['Bill in', 'a minute'],
    standfirst: 'GST tax invoices, quotations and proformas, typed as fast as you talk to the customer.',
    summary: 'Tax invoices, quotations, proformas and credit notes, with GST worked out as you type.',
    hero: { src: invoiceEntry, alt: 'A new invoice being entered: customer, items, rates and live GST totals', focus: '35% 0' },
    video: '/media/invoice-entry.webm',
    chapters: [
      {
        claim: 'Pick the customer; the rest fills itself in.',
        body: [
          'Their GSTIN and place of supply come from the contact. Each product brings its HSN code, unit, rate and GST rate. Type a quantity, press Enter for the next line, and the totals follow as you type.',
          'Inside your state the tax splits into CGST and SGST; to another state it is IGST. Round off is printed on its own line and the amount appears in words, in lakh and crore.',
        ],
        shot: { src: printInvoice, alt: 'A printed tax invoice with HSN summary, amount in words, bank details and UPI QR', sheet: true },
      },
      {
        claim: 'Numbers that restart every April.',
        body: [
          'Every document gets the next number for its financial year when you post it: INV/26-27/0001, then 0002. Drafts take no number, so the series has no gaps, and posted documents cannot be edited.',
          'Add your UPI ID once and every invoice prints a UPI QR code for its exact amount, so customers can pay from their phone the moment they read it.',
        ],
      },
      {
        claim: 'Quote first, invoice when they say yes.',
        body: [
          'Send a quotation with a validity date. Mark it sent, accepted or declined; revise it without losing its number. When the customer agrees, one click turns it into a draft invoice with the same items.',
          'The same quotation prints as a proforma invoice with your bank details and a UPI QR code, for customers who pay in advance.',
        ],
        shot: { src: quotations, alt: 'The list of quotations with their status: sent, accepted, invoiced', focus: '30% 0' },
      },
      {
        claim: 'Find anything with Ctrl K.',
        body: [
          'Press Ctrl K anywhere and type a customer, an invoice number or a product. In any list, N starts a new record and the slash key searches. The keyboard does what Tally users expect it to.',
        ],
        shot: { src: commandPalette, alt: 'The search palette finding a customer, their invoices and a new-invoice shortcut', focus: '50% 20%' },
      },
    ],
    related: [{ src: printProforma, alt: 'A quotation printed as a proforma invoice with bank details and UPI QR', focus: '50% 0' }, { src: printQuotation, alt: 'A printed quotation with its validity date', focus: '50% 0' }, { src: printCredit, alt: 'A printed credit note against an invoice', focus: '50% 0' }],
  },
  {
    slug: 'gst-returns',
    name: 'GST returns',
    title: ['GSTR-1', 'and 3B'],
    standfirst: 'GSTR-1 and GSTR-3B, built from the invoices, bills and notes you post, in the tables the portal asks for.',
    summary: 'GSTR-1 and GSTR-3B from your posted documents, as CSV for the offline tool or your accountant.',
    hero: { src: gstr1, alt: 'GSTR-1 for the month: B2B invoices, B2C large, B2C small, credit notes', focus: '40% 0' },
    chapters: [
      {
        claim: 'GSTR-1, table by table.',
        body: [
          'B2B invoices with the customer’s GSTIN, B2C large invoices over ₹1 lakh to other states, B2C small grouped by state and rate, credit notes to registered and unregistered customers, the HSN summary net of returns, and the document count.',
          'Download each table as CSV for the GST offline tool, or send it to your accountant.',
        ],
      },
      {
        claim: 'GSTR-3B with your input credit.',
        body: [
          'Outward supplies and tax by head, nil-rated sales, and the input tax credit from purchase bills less debit notes, netted head by head to what you pay for the month.',
          'The dashboard shows the same figure all month, so the payable is never a surprise on the 20th.',
        ],
        shot: { src: gstr3b, alt: 'GSTR-3B: outward supplies, input tax credit and net tax payable by IGST, CGST and SGST', focus: '40% 0' },
      },
      {
        claim: 'Filing stays on the portal.',
        body: [
          'OSuite prepares the returns; you file them on the GST portal or through your accountant. Every figure traces back to a posted document you can open.',
        ],
      },
    ],
    related: [{ src: invoicesList, alt: 'The list of invoices with amounts due and payment status', focus: '30% 0' }, { src: printCredit, alt: 'A printed credit note against an invoice', focus: '50% 0' }, { src: dashboard, alt: 'The dashboard with sales, dues, cash and GST', focus: '40% 0' }],
  },
  {
    slug: 'e-invoicing',
    name: 'E-invoicing and e-way bills',
    title: ['IRN and', 'e-way bills'],
    standfirst: 'The e-invoice built in the portal’s own format, checked before it is sent, with the signed QR printed on the invoice.',
    summary: 'E-invoice JSON in the IRP format, checked first; IRN and signed QR on the print; e-way bills from the IRN.',
    hero: { src: invoiceEinvoice, alt: 'A posted invoice with its IRN, acknowledgement number and e-way bill', focus: '40% 0' },
    chapters: [
      {
        claim: 'Checked before it leaves.',
        body: [
          'OSuite builds the e-invoice (schema INV-01, version 1.1) from the posted invoice and checks it against the portal’s rules first: document number format, addresses and PIN codes, 4, 6 or 8 digit HSN codes, valid rates, totals that match the items.',
          'Anything missing is listed in plain words, such as “The customer: a 6-digit PIN code is required”, before anything is sent.',
        ],
      },
      {
        claim: 'IRN and signed QR, printed.',
        body: [
          'The IRN, acknowledgement number and date and the signed QR code are stored on the invoice and printed on it. Credit notes are e-invoiced the same way, with the original invoice they adjust.',
        ],
        shot: { src: printInvoice, alt: 'A printed invoice showing the IRN, acknowledgement, e-way bill number and the signed QR code', sheet: true },
      },
      {
        claim: 'The portal’s rules, kept for you.',
        body: [
          'An e-invoice can be cancelled within 24 hours, and only after its e-way bill. An invoice with an active IRN cannot simply be cancelled: OSuite points you to a credit note. E-way bills are for goods, need a vehicle number or transporter ID, and stay valid one day per 200 km.',
          'Every step is written to the edit history, and the e-invoice JSON can be downloaded from the invoice.',
        ],
      },
      {
        claim: 'Connection to the portal.',
        body: [
          'Registration with the Invoice Registration Portal goes through a GST Suvidha Provider; that connection is being finalised. Until it is live, a built-in simulator lets you try the whole flow, and everything it produces is clearly marked as simulated.',
        ],
        shot: { src: einvoiceSettings, alt: 'E-invoicing settings with the provider choice', focus: '40% 0' },
      },
    ],
    related: [{ src: invoicesList, alt: 'The list of invoices with amounts due and payment status', focus: '30% 0' }, { src: printCredit, alt: 'A printed credit note against an invoice', focus: '50% 0' }, { src: gstr1, alt: 'GSTR-1 tables for the month', focus: '40% 0' }],
  },
  {
    slug: 'purchases',
    name: 'Purchases and bills',
    title: ['Bills in,', 'credit in'],
    standfirst: 'Vendor bills with their GST checked, stock added at cost and input credit counted for the return.',
    summary: 'Vendor bills and debit notes, with duplicate checks, stock at cost and input tax credit.',
    hero: { src: bills, alt: 'The list of purchase bills with vendors, amounts and payment status', focus: '30% 0' },
    chapters: [
      {
        claim: 'The same bill never goes in twice.',
        body: [
          'Enter the vendor’s bill number; OSuite refuses a second bill with the same number from the same vendor. The vendor’s GSTIN is checked against their state, so tax is split correctly.',
        ],
      },
      {
        claim: 'Stock at cost, credit for the return.',
        body: [
          'Goods on a bill come into stock at their net cost, without the GST you can claim back. That GST goes to input tax credit and on to GSTR-3B.',
          'Send goods back with a debit note against the original bill: stock goes out at the cost it came in, and the bill’s balance comes down.',
        ],
      },
      {
        claim: 'Know what you owe, and when.',
        body: [
          'Payables show every vendor’s balance by how overdue it is. Pay a bill in part or in full, by bank, UPI, cheque or cash, and its status follows.',
        ],
        shot: { src: payments, alt: 'Payments recorded against invoices and bills, by mode', focus: '30% 0' },
      },
    ],
    related: [{ src: stock, alt: 'Stock on hand by warehouse', focus: '30% 0' }, { src: stockLedger, alt: 'The stock ledger of movements', focus: '30% 0' }, { src: gstr3b, alt: 'GSTR-3B summary with input tax credit', focus: '40% 0' }],
  },
  {
    slug: 'inventory',
    name: 'Inventory',
    title: ['Stock you', 'can trust'],
    standfirst: 'Stock that moves only when a document is posted, valued at weighted average cost, in one or more warehouses.',
    summary: 'Stock by warehouse at weighted average cost, a ledger that cannot be edited, and reorder levels.',
    hero: { src: stock, alt: 'Stock on hand by product and warehouse with average cost and value', focus: '30% 0' },
    chapters: [
      {
        claim: 'Every movement has a document.',
        body: [
          'Invoices take stock out, bills bring it in, credit and debit notes return it, and adjustments record opening stock, damage and counts. Each movement is written to a stock ledger that cannot be edited; a cancellation adds a reversing movement instead.',
        ],
        shot: { src: stockLedger, alt: 'The stock ledger: every movement with its document, quantity and cost', focus: '30% 0' },
      },
      {
        claim: 'Valued at weighted average cost.',
        body: [
          'Each purchase updates the average cost; each sale is costed at it, so the profit and loss carries the real cost of goods sold. Returns come back at the cost they went out at.',
        ],
      },
      {
        claim: 'No selling what is not there.',
        body: [
          'OSuite stops a sale that would take stock below zero, unless you choose to allow it the way Tally does. Set a reorder level on a product and the dashboard lists it when stock falls to that level.',
        ],
      },
    ],
    related: [{ src: bills, alt: 'Purchase bills from vendors', focus: '30% 0' }, { src: dashboard, alt: 'The dashboard with sales, dues, cash and GST', focus: '40% 0' }, { src: invoiceEntry, alt: 'An invoice being entered', focus: '35% 0' }],
  },
  {
    slug: 'receivables',
    name: 'Payments and receivables',
    title: ['Get paid', 'on time'],
    standfirst: 'Payments matched to invoices, advances kept as credit, and every customer’s balance by how overdue it is.',
    summary: 'Payments against invoices, advances and credit notes applied, ageing and statements of account.',
    hero: { src: receivables, alt: 'Receivables by customer: not due, 1 to 30, 31 to 60, 61 to 90 and over 90 days', focus: '30% 0' },
    chapters: [
      {
        claim: 'Who owes what, by how late.',
        body: [
          'Receivables group every customer’s open invoices into not due, 1–30, 31–60, 61–90 and over 90 days, with their advances shown beside. The dashboard lists the most overdue invoices first.',
        ],
      },
      {
        claim: 'Advances and credit, applied.',
        body: [
          'Record a payment against one invoice or several, or as an advance. Advances and credit notes stay as credit until you apply them to the next invoice in one click, oldest dues first.',
        ],
      },
      {
        claim: 'A statement they can check.',
        body: [
          'Every customer has a statement of account with the opening balance, each invoice, payment and note, and a running balance. Print it on A4 or save it as PDF and send it.',
        ],
        shot: { src: statement, alt: 'A customer statement of account with a running balance', focus: '30% 0' },
      },
    ],
    related: [{ src: payments, alt: 'Payments recorded by mode', focus: '30% 0' }, { src: printStatement, alt: 'A printed statement of account', focus: '50% 0' }, { src: dashboard, alt: 'The dashboard with sales, dues, cash and GST', focus: '40% 0' }],
  },
  {
    slug: 'banking',
    name: 'Banking and reconciliation',
    title: ['Your bank,', 'reconciled'],
    standfirst: 'Import the statement from your bank, let OSuite match it to your books, and see what has not cleared.',
    summary: 'Bank statement import for Indian banks, automatic matching by amount and reference, charges booked.',
    hero: { src: bank, alt: 'A bank statement matched to payments in the books, with a bank charge left to book', focus: '30% 0' },
    chapters: [
      {
        claim: 'Bring in the statement as it is.',
        body: [
          'Export the statement from your net banking as CSV and drop it in. OSuite finds the header row in common Indian bank exports and reads Indian dates and amounts. Lines already imported are recognised, so overlapping statements are never counted twice.',
        ],
      },
      {
        claim: 'Matched by amount and reference.',
        body: [
          'Each bank line is matched to an entry in your books with the same amount within ten days. A UTR or document number found in the bank’s text ranks first, and automatic matching only takes the unambiguous ones.',
          'Bank charges and interest that are not in your books yet can be booked straight from the statement.',
        ],
      },
      {
        claim: 'Books and bank, side by side.',
        body: [
          'The summary compares the bank’s closing balance with your books and lists the items in your books that have not reached the bank yet, such as cheques not yet cleared.',
        ],
      },
    ],
    related: [{ src: payments, alt: 'Payments recorded by mode', focus: '30% 0' }, { src: dayBook, alt: 'The day book', focus: '30% 0' }, { src: trialBalance, alt: 'The trial balance', focus: '30% 0' }],
  },
  {
    slug: 'accounting',
    name: 'Accounting and reports',
    title: ['Books that', 'balance'],
    standfirst: 'Double-entry accounts kept for you from every document, with the ledger, day book and statements Tally users know.',
    summary: 'Automatic double entry, ledger, day book, trial balance, P&L, balance sheet and year-end closing.',
    hero: { src: dayBook, alt: 'The day book: every voucher of the day with its debit and credit lines', focus: '30% 0' },
    chapters: [
      {
        claim: 'Every document posts its own entry.',
        body: [
          'Invoices, bills, payments, notes and stock adjustments each post a balanced journal entry to a chart of accounts made for Indian businesses. Manual journals cover salaries, rent and depreciation. An entry that does not balance is refused.',
        ],
      },
      {
        claim: 'Ledger, day book, the familiar names.',
        body: [
          'Open any account’s ledger with its opening balance and a running Dr/Cr balance; every voucher links to its document. The day book lists every entry of the day. The trial balance, profit and loss and balance sheet drill into the ledger.',
        ],
        shot: { src: trialBalance, alt: 'Trial balance with debit and credit totals that agree', focus: '30% 0' },
      },
      {
        claim: 'Close the year, lock it.',
        body: [
          'At the end of the financial year, OSuite moves the year’s profit to reserves and locks it: nothing can be posted with a date in a closed year. The most recent closing can be reopened to correct a mistake.',
        ],
        shot: { src: closing, alt: 'Year-end closing: each financial year with its profit and status', focus: '30% 0' },
      },
    ],
    related: [{ src: profitLoss, alt: 'Profit and loss for the year', focus: '30% 0' }, { src: balanceSheet, alt: 'The balance sheet', focus: '30% 0' }, { src: statement, alt: 'A customer statement on screen', focus: '30% 0' }],
  },
  {
    slug: 'dashboard',
    name: 'Dashboard',
    title: ['Morning', 'numbers'],
    standfirst: 'Sales, dues, cash, GST and stock that is running low, on the first screen you see.',
    summary: 'Sales this month, what customers owe, cash and bank, GST payable, profit, low stock and drafts.',
    hero: { src: dashboard, alt: 'The OSuite dashboard', focus: '40% 0' },
    chapters: [
      {
        claim: 'Six numbers, each a door.',
        body: [
          'Sales this month against the same days last month, what customers owe and how much is overdue, what you owe vendors, cash and bank, GST payable for the month, and profit for the year. Each one opens the report behind it.',
        ],
      },
      {
        claim: 'What needs you today.',
        body: [
          'The most overdue invoices, the best customers this year, products at or below their reorder level, and drafts waiting to be posted, each a click from the record.',
        ],
        shot: { src: profitLoss, alt: 'Profit and loss for the financial year', focus: '30% 0' },
      },
    ],
    related: [{ src: receivables, alt: 'Receivables by how overdue they are', focus: '30% 0' }, { src: stock, alt: 'Stock on hand by warehouse', focus: '30% 0' }, { src: gstr3b, alt: 'GSTR-3B summary with input tax credit', focus: '40% 0' }],
  },
];


/** Every captured screen, by name, for pages that are not about one feature. */
export const SCREENS = { backups, bank, bills, balanceSheet, closing, commandPalette, dashboard, dayBook, einvoiceSettings, gstr1, gstr3b, invoiceEinvoice, invoiceEntry, payments, printInvoice, printProforma, printQuotation, printCredit, printStatement, invoicesList, profitLoss, quotations, receivables, statement, stock, stockLedger, trialBalance };
