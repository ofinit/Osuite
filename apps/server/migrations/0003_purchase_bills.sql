CREATE TABLE "purchase_bill" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_bill_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30),
	"state" varchar(50) DEFAULT 'draft' NOT NULL,
	"vendor_id" bigint NOT NULL,
	"vendor_gstin" varchar(15),
	"vendor_state" varchar(50) NOT NULL,
	"vendor_bill_no" varchar(40) NOT NULL,
	"date" date DEFAULT current_date NOT NULL,
	"due_date" date,
	"place_of_supply" varchar(50),
	"notes" text,
	"taxable_amount" numeric(16, 2),
	"cgst_amount" numeric(16, 2),
	"sgst_amount" numeric(16, 2),
	"igst_amount" numeric(16, 2),
	"round_off" numeric(16, 2),
	"total_amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "purchase_bill_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_bill_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"bill_id" bigint,
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
ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_vendor_id_contact_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill_line" ADD CONSTRAINT "purchase_bill_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill_line" ADD CONSTRAINT "purchase_bill_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill_line" ADD CONSTRAINT "purchase_bill_line_bill_id_purchase_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."purchase_bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill_line" ADD CONSTRAINT "purchase_bill_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_bill_number_idx" ON "purchase_bill" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_bill_state_idx" ON "purchase_bill" USING btree ("state");--> statement-breakpoint
CREATE INDEX "purchase_bill_vendor_id_idx" ON "purchase_bill" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "purchase_bill_vendor_bill_no_idx" ON "purchase_bill" USING btree ("vendor_bill_no");--> statement-breakpoint
CREATE INDEX "purchase_bill_date_idx" ON "purchase_bill" USING btree ("date");--> statement-breakpoint
CREATE INDEX "purchase_bill_line_bill_id_idx" ON "purchase_bill_line" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "purchase_bill_line_product_id_idx" ON "purchase_bill_line" USING btree ("product_id");