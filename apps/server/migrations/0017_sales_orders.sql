CREATE TABLE "sales_delivery" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_delivery_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30),
	"state" varchar(50) DEFAULT 'draft' NOT NULL,
	"customer_id" bigint NOT NULL,
	"customer_gstin" varchar(15),
	"place_of_supply" varchar(50) NOT NULL,
	"date" date DEFAULT current_date NOT NULL,
	"purpose" varchar(50) DEFAULT 'supply' NOT NULL,
	"warehouse_id" bigint,
	"vehicle_no" varchar(20),
	"order_id" bigint,
	"invoice_id" bigint,
	"notes" text,
	"taxable_amount" numeric(16, 2),
	"cgst_amount" numeric(16, 2),
	"sgst_amount" numeric(16, 2),
	"igst_amount" numeric(16, 2),
	"round_off" numeric(16, 2),
	"total_amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "sales_delivery_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_delivery_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"delivery_id" bigint,
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
	"order_line_id" bigint
);
--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_order_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30),
	"state" varchar(50) DEFAULT 'draft' NOT NULL,
	"customer_id" bigint NOT NULL,
	"customer_gstin" varchar(15),
	"place_of_supply" varchar(50) NOT NULL,
	"date" date DEFAULT current_date NOT NULL,
	"deliver_by" date,
	"reference" varchar(60),
	"warehouse_id" bigint,
	"quotation_id" bigint,
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
CREATE TABLE "sales_order_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_order_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
ALTER TABLE "sales_invoice" ADD COLUMN "order_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD COLUMN "order_line_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD COLUMN "stock_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_quotation" ADD COLUMN "order_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_delivery" ADD CONSTRAINT "sales_delivery_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery" ADD CONSTRAINT "sales_delivery_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery" ADD CONSTRAINT "sales_delivery_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery" ADD CONSTRAINT "sales_delivery_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery" ADD CONSTRAINT "sales_delivery_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery" ADD CONSTRAINT "sales_delivery_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_line" ADD CONSTRAINT "sales_delivery_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_line" ADD CONSTRAINT "sales_delivery_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_line" ADD CONSTRAINT "sales_delivery_line_delivery_id_sales_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."sales_delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_line" ADD CONSTRAINT "sales_delivery_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_line" ADD CONSTRAINT "sales_delivery_line_order_line_id_sales_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sales_order_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_quotation_id_sales_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_number_idx" ON "sales_delivery" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_delivery_state_idx" ON "sales_delivery" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sales_delivery_customer_id_idx" ON "sales_delivery" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_date_idx" ON "sales_delivery" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_delivery_warehouse_id_idx" ON "sales_delivery" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_order_id_idx" ON "sales_delivery" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_invoice_id_idx" ON "sales_delivery" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_line_delivery_id_idx" ON "sales_delivery_line" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_line_product_id_idx" ON "sales_delivery_line" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_line_order_line_id_idx" ON "sales_delivery_line" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_number_idx" ON "sales_order" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_order_state_idx" ON "sales_order" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sales_order_customer_id_idx" ON "sales_order" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_order_date_idx" ON "sales_order" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_order_warehouse_id_idx" ON "sales_order" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "sales_order_quotation_id_idx" ON "sales_order" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "sales_order_line_order_id_idx" ON "sales_order_line" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sales_order_line_product_id_idx" ON "sales_order_line" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_order_line_id_sales_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sales_order_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation" ADD CONSTRAINT "sales_quotation_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_invoice_order_id_idx" ON "sales_invoice" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_line_order_line_id_idx" ON "sales_invoice_line" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "sales_quotation_order_id_idx" ON "sales_quotation" USING btree ("order_id");