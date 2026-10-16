CREATE TABLE "purchase_order" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
	"date" date DEFAULT current_date NOT NULL,
	"deliver_by" date,
	"reference" varchar(60),
	"place_of_supply" varchar(50),
	"warehouse_id" bigint,
	"delivery_status" varchar(50) DEFAULT 'none',
	"invoice_status" varchar(50) DEFAULT 'none',
	"notes" text,
	"taxable_amount" numeric(16, 2),
	"cgst_amount" numeric(16, 2),
	"sgst_amount" numeric(16, 2),
	"igst_amount" numeric(16, 2),
	"round_off" numeric(16, 2),
	"total_amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"order_id" bigint,
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
	"total_amount" numeric(16, 2),
	"qty_delivered" numeric(14, 3) DEFAULT '0',
	"qty_invoiced" numeric(14, 3) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_receipt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
	"place_of_supply" varchar(50),
	"date" date DEFAULT current_date NOT NULL,
	"vendor_challan_no" varchar(40),
	"warehouse_id" bigint,
	"order_id" bigint,
	"bill_id" bigint,
	"notes" text,
	"taxable_amount" numeric(16, 2),
	"cgst_amount" numeric(16, 2),
	"sgst_amount" numeric(16, 2),
	"igst_amount" numeric(16, 2),
	"round_off" numeric(16, 2),
	"total_amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_receipt_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"receipt_id" bigint,
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
	"total_amount" numeric(16, 2),
	"order_line_id" bigint,
	"stock_value" numeric(16, 2) DEFAULT '0'
);
--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD COLUMN "order_id" bigint;--> statement-breakpoint
ALTER TABLE "purchase_bill_line" ADD COLUMN "order_line_id" bigint;--> statement-breakpoint
ALTER TABLE "purchase_bill_line" ADD COLUMN "stock_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_bill_line" ADD COLUMN "received_value" numeric(16, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_vendor_id_contact_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_vendor_id_contact_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_bill_id_purchase_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."purchase_bill"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_line" ADD CONSTRAINT "purchase_receipt_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_line" ADD CONSTRAINT "purchase_receipt_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_line" ADD CONSTRAINT "purchase_receipt_line_receipt_id_purchase_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_line" ADD CONSTRAINT "purchase_receipt_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_line" ADD CONSTRAINT "purchase_receipt_line_order_line_id_purchase_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."purchase_order_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_number_idx" ON "purchase_order" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_order_state_idx" ON "purchase_order" USING btree ("state");--> statement-breakpoint
CREATE INDEX "purchase_order_vendor_id_idx" ON "purchase_order" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "purchase_order_date_idx" ON "purchase_order" USING btree ("date");--> statement-breakpoint
CREATE INDEX "purchase_order_warehouse_id_idx" ON "purchase_order" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "purchase_order_line_order_id_idx" ON "purchase_order_line" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_line_product_id_idx" ON "purchase_order_line" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_number_idx" ON "purchase_receipt" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_receipt_state_idx" ON "purchase_receipt" USING btree ("state");--> statement-breakpoint
CREATE INDEX "purchase_receipt_vendor_id_idx" ON "purchase_receipt" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_date_idx" ON "purchase_receipt" USING btree ("date");--> statement-breakpoint
CREATE INDEX "purchase_receipt_warehouse_id_idx" ON "purchase_receipt" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_order_id_idx" ON "purchase_receipt" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_bill_id_idx" ON "purchase_receipt" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_line_receipt_id_idx" ON "purchase_receipt_line" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_line_product_id_idx" ON "purchase_receipt_line" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_line_order_line_id_idx" ON "purchase_receipt_line" USING btree ("order_line_id");--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill_line" ADD CONSTRAINT "purchase_bill_line_order_line_id_purchase_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."purchase_order_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_bill_order_id_idx" ON "purchase_bill" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_bill_line_order_line_id_idx" ON "purchase_bill_line" USING btree ("order_line_id");