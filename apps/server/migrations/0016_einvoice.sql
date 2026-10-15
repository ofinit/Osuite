ALTER TABLE "sales_credit_note" ADD COLUMN "irn_status" varchar(50);--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "irn" varchar(64);--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "irn_ack_no" varchar(20);--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "irn_ack_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "irn_signed_qr" text;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "irn_simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "ewb_status" varchar(50);--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "ewb_no" varchar(20);--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "ewb_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_credit_note" ADD COLUMN "ewb_valid_until" date;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "irn_status" varchar(50);--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "irn" varchar(64);--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "irn_ack_no" varchar(20);--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "irn_ack_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "irn_signed_qr" text;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "irn_simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "ewb_status" varchar(50);--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "ewb_no" varchar(20);--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "ewb_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "ewb_valid_until" date;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_credit_note_irn_idx" ON "sales_credit_note" USING btree ("irn");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_irn_idx" ON "sales_invoice" USING btree ("irn");