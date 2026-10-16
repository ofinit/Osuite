-- Starter roles. Levels: none, view, edit (create and post), full (also cancel).
INSERT INTO "base_role" ("name", "notes", "sales_access", "purchase_access", "inventory_access", "masters_access", "payments_access", "accounts_access", "gst_access") VALUES
  ('Full access', 'Everything except company settings, users, backups and the licence.', 'full', 'full', 'full', 'full', 'full', 'full', 'full'),
  ('Accountant', 'Keeps the books: every document, payments, reports and GST returns.', 'full', 'full', 'view', 'edit', 'full', 'full', 'full'),
  ('Sales and billing', 'Quotes, orders, challans and invoices; records payments received. Cannot cancel posted documents or see the accounts.', 'edit', 'none', 'view', 'edit', 'edit', 'none', 'edit'),
  ('Purchase and stores', 'Purchase orders, goods receipts, bills and stock. Cannot see sales or the accounts.', 'none', 'edit', 'edit', 'edit', 'none', 'none', 'none'),
  ('Read only', 'Can look at everything and print, but not change anything.', 'view', 'view', 'view', 'view', 'view', 'view', 'view')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Users from before roles keep what they could do.
UPDATE "users" SET "role_id" = (SELECT "id" FROM "base_role" WHERE "name" = 'Full access') WHERE NOT "is_admin" AND "role_id" IS NULL;
