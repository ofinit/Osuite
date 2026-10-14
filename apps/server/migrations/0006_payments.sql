CREATE TABLE "account_payment" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_payment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30),
	"state" varchar(50) DEFAULT 'draft' NOT NULL,
	"direction" varchar(50) DEFAULT 'inbound' NOT NULL,
	"partner_id" bigint NOT NULL,
	"date" date DEFAULT current_date NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"mode" varchar(50) DEFAULT 'bank' NOT NULL,
	"reference" varchar(60),
	"allocated_amount" numeric(16, 2) DEFAULT '0',
	"unallocated_amount" numeric(16, 2) DEFAULT '0',
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "account_payment_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_payment_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"payment_id" bigint,
	"sequence" integer,
	"invoice_id" bigint,
	"bill_id" bigint,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD COLUMN "amount_paid" numeric(16, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD COLUMN "amount_due" numeric(16, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD COLUMN "payment_state" varchar(50) DEFAULT 'unpaid';--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "amount_paid" numeric(16, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "amount_due" numeric(16, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "payment_state" varchar(50) DEFAULT 'unpaid';--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_partner_id_contact_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_line" ADD CONSTRAINT "account_payment_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_line" ADD CONSTRAINT "account_payment_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_line" ADD CONSTRAINT "account_payment_line_payment_id_account_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."account_payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_line" ADD CONSTRAINT "account_payment_line_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_line" ADD CONSTRAINT "account_payment_line_bill_id_purchase_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."purchase_bill"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_payment_number_idx" ON "account_payment" USING btree ("number");--> statement-breakpoint
CREATE INDEX "account_payment_state_idx" ON "account_payment" USING btree ("state");--> statement-breakpoint
CREATE INDEX "account_payment_direction_idx" ON "account_payment" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "account_payment_partner_id_idx" ON "account_payment" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "account_payment_date_idx" ON "account_payment" USING btree ("date");--> statement-breakpoint
CREATE INDEX "account_payment_line_payment_id_idx" ON "account_payment_line" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "account_payment_line_invoice_id_idx" ON "account_payment_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "account_payment_line_bill_id_idx" ON "account_payment_line" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "purchase_bill_payment_state_idx" ON "purchase_bill" USING btree ("payment_state");--> statement-breakpoint
CREATE INDEX "sales_invoice_payment_state_idx" ON "sales_invoice" USING btree ("payment_state");--> statement-breakpoint
-- Existing documents: nothing has been paid yet, so the whole total is due.
UPDATE "sales_invoice" SET "amount_due" = "total_amount" WHERE "amount_paid" = 0;
--> statement-breakpoint
UPDATE "purchase_bill" SET "amount_due" = "total_amount" WHERE "amount_paid" = 0;
