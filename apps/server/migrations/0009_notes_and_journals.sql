CREATE TABLE "account_manual" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_manual_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30),
	"state" varchar(50) DEFAULT 'draft' NOT NULL,
	"date" date DEFAULT current_date NOT NULL,
	"reference" varchar(60),
	"narration" varchar(200) NOT NULL,
	"total_debit" numeric(16, 2) DEFAULT '0',
	"total_credit" numeric(16, 2) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "account_manual_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_manual_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"journal_id" bigint,
	"sequence" integer,
	"account_id" bigint NOT NULL,
	"partner_id" bigint,
	"label" varchar(200),
	"debit" numeric(16, 2) DEFAULT '0',
	"credit" numeric(16, 2) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "purchase_debit_note" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_debit_note_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30),
	"state" varchar(50) DEFAULT 'draft' NOT NULL,
	"bill_id" bigint NOT NULL,
	"vendor_id" bigint NOT NULL,
	"vendor_gstin" varchar(15),
	"vendor_state" varchar(50) NOT NULL,
	"place_of_supply" varchar(50),
	"date" date DEFAULT current_date NOT NULL,
	"reason" varchar(50) DEFAULT 'return' NOT NULL,
	"warehouse_id" bigint,
	"notes" text,
	"taxable_amount" numeric(16, 2),
	"cgst_amount" numeric(16, 2),
	"sgst_amount" numeric(16, 2),
	"igst_amount" numeric(16, 2),
	"round_off" numeric(16, 2),
	"total_amount" numeric(16, 2),
	"amount_applied" numeric(16, 2) DEFAULT '0',
	"unapplied_amount" numeric(16, 2) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "purchase_debit_note_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_debit_note_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"debit_note_id" bigint,
	"sequence" integer,
	"product_id" bigint,
	"description" varchar(300) NOT NULL,
	"hsn_code" varchar(8),
	"qty" numeric(14, 3) DEFAULT '1' NOT NULL,
	"uom" varchar(50) DEFAULT 'NOS' NOT NULL,
	"unit_price" numeric(16, 2) DEFAULT '0' NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0',
	"gst_rate" varchar(50) DEFAULT '18' NOT NULL,
	"taxable_amount" numeric(16, 2),
	"tax_amount" numeric(16, 2),
	"total_amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "sales_credit_note" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_credit_note_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30),
	"state" varchar(50) DEFAULT 'draft' NOT NULL,
	"invoice_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"customer_gstin" varchar(15),
	"place_of_supply" varchar(50) NOT NULL,
	"date" date DEFAULT current_date NOT NULL,
	"reason" varchar(50) DEFAULT 'return' NOT NULL,
	"warehouse_id" bigint,
	"notes" text,
	"taxable_amount" numeric(16, 2),
	"cgst_amount" numeric(16, 2),
	"sgst_amount" numeric(16, 2),
	"igst_amount" numeric(16, 2),
	"round_off" numeric(16, 2),
	"total_amount" numeric(16, 2),
	"amount_applied" numeric(16, 2) DEFAULT '0',
	"unapplied_amount" numeric(16, 2) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "sales_credit_note_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_credit_note_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"credit_note_id" bigint,
	"sequence" integer,
	"product_id" bigint,
	"description" varchar(300) NOT NULL,
	"hsn_code" varchar(8),
	"qty" numeric(14, 3) DEFAULT '1' NOT NULL,
	"uom" varchar(50) DEFAULT 'NOS' NOT NULL,
	"unit_price" numeric(16, 2) DEFAULT '0' NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0',
	"gst_rate" varchar(50) DEFAULT '18' NOT NULL,
	"taxable_amount" numeric(16, 2),
	"tax_amount" numeric(16, 2),
	"total_amount" numeric(16, 2)
);
--> statement-breakpoint
ALTER TABLE "account_manual" ADD CONSTRAINT "account_manual_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_manual" ADD CONSTRAINT "account_manual_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_manual_line" ADD CONSTRAINT "account_manual_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_manual_line" ADD CONSTRAINT "account_manual_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_manual_line" ADD CONSTRAINT "account_manual_line_journal_id_account_manual_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."account_manual"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_manual_line" ADD CONSTRAINT "account_manual_line_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_manual_line" ADD CONSTRAINT "account_manual_line_partner_id_contact_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note" ADD CONSTRAINT "purchase_debit_note_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note" ADD CONSTRAINT "purchase_debit_note_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note" ADD CONSTRAINT "purchase_debit_note_bill_id_purchase_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."purchase_bill"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note" ADD CONSTRAINT "purchase_debit_note_vendor_id_contact_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note" ADD CONSTRAINT "purchase_debit_note_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note_line" ADD CONSTRAINT "purchase_debit_note_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note_line" ADD CONSTRAINT "purchase_debit_note_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note_line" ADD CONSTRAINT "purchase_debit_note_line_debit_note_id_purchase_debit_note_id_fk" FOREIGN KEY ("debit_note_id") REFERENCES "public"."purchase_debit_note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_debit_note_line" ADD CONSTRAINT "purchase_debit_note_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD CONSTRAINT "sales_credit_note_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD CONSTRAINT "sales_credit_note_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD CONSTRAINT "sales_credit_note_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD CONSTRAINT "sales_credit_note_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD CONSTRAINT "sales_credit_note_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_line" ADD CONSTRAINT "sales_credit_note_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_line" ADD CONSTRAINT "sales_credit_note_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_line" ADD CONSTRAINT "sales_credit_note_line_credit_note_id_sales_credit_note_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."sales_credit_note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_line" ADD CONSTRAINT "sales_credit_note_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_manual_number_idx" ON "account_manual" USING btree ("number");--> statement-breakpoint
CREATE INDEX "account_manual_state_idx" ON "account_manual" USING btree ("state");--> statement-breakpoint
CREATE INDEX "account_manual_date_idx" ON "account_manual" USING btree ("date");--> statement-breakpoint
CREATE INDEX "account_manual_line_journal_id_idx" ON "account_manual_line" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "account_manual_line_account_id_idx" ON "account_manual_line" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_manual_line_partner_id_idx" ON "account_manual_line" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_debit_note_number_idx" ON "purchase_debit_note" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_debit_note_state_idx" ON "purchase_debit_note" USING btree ("state");--> statement-breakpoint
CREATE INDEX "purchase_debit_note_bill_id_idx" ON "purchase_debit_note" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "purchase_debit_note_vendor_id_idx" ON "purchase_debit_note" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "purchase_debit_note_date_idx" ON "purchase_debit_note" USING btree ("date");--> statement-breakpoint
CREATE INDEX "purchase_debit_note_warehouse_id_idx" ON "purchase_debit_note" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "purchase_debit_note_line_debit_note_id_idx" ON "purchase_debit_note_line" USING btree ("debit_note_id");--> statement-breakpoint
CREATE INDEX "purchase_debit_note_line_product_id_idx" ON "purchase_debit_note_line" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_credit_note_number_idx" ON "sales_credit_note" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_credit_note_state_idx" ON "sales_credit_note" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sales_credit_note_invoice_id_idx" ON "sales_credit_note" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_credit_note_customer_id_idx" ON "sales_credit_note" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_credit_note_date_idx" ON "sales_credit_note" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_credit_note_warehouse_id_idx" ON "sales_credit_note" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "sales_credit_note_line_credit_note_id_idx" ON "sales_credit_note_line" USING btree ("credit_note_id");--> statement-breakpoint
CREATE INDEX "sales_credit_note_line_product_id_idx" ON "sales_credit_note_line" USING btree ("product_id");