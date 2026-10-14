-- Standard Indian chart of accounts. "key" marks accounts automatic postings use;
-- users may rename them or add their own accounts.
INSERT INTO "account_account" ("code", "name", "type", "key") VALUES
  ('1100', 'Cash in hand', 'asset', 'cash'),
  ('1200', 'Bank account', 'asset', 'bank'),
  ('1300', 'Sundry debtors', 'asset', 'receivable'),
  ('1400', 'Stock-in-hand', 'asset', 'inventory'),
  ('1510', 'Input CGST', 'asset', 'input_cgst'),
  ('1520', 'Input SGST', 'asset', 'input_sgst'),
  ('1530', 'Input IGST', 'asset', 'input_igst'),
  ('2100', 'Sundry creditors', 'liability', 'payable'),
  ('2210', 'Output CGST', 'liability', 'output_cgst'),
  ('2220', 'Output SGST', 'liability', 'output_sgst'),
  ('2230', 'Output IGST', 'liability', 'output_igst'),
  ('3100', 'Capital account', 'equity', NULL),
  ('3900', 'Opening balance equity', 'equity', 'opening_equity'),
  ('4100', 'Sales', 'income', 'sales'),
  ('5100', 'Cost of goods sold', 'expense', 'cogs'),
  ('5200', 'Purchases (services and consumables)', 'expense', 'purchases'),
  ('5300', 'Stock gain / loss', 'expense', 'stock_adjustment'),
  ('5900', 'Round off', 'expense', 'round_off')
ON CONFLICT DO NOTHING;
