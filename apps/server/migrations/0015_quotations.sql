CREATE TABLE "sales_quotation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_quotation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
	"valid_until" date,
	"reference" varchar(60),
	"notes" text,
	"invoice_id" bigint,
	"taxable_amount" numeric(16, 2),
	"cgst_amount" numeric(16, 2),
	"sgst_amount" numeric(16, 2),
	"igst_amount" numeric(16, 2),
	"round_off" numeric(16, 2),
	"total_amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "sales_quotation_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_quotation_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"quotation_id" bigint,
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
ALTER TABLE "sales_quotation" ADD CONSTRAINT "sales_quotation_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation" ADD CONSTRAINT "sales_quotation_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation" ADD CONSTRAINT "sales_quotation_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation" ADD CONSTRAINT "sales_quotation_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_line" ADD CONSTRAINT "sales_quotation_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_line" ADD CONSTRAINT "sales_quotation_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_line" ADD CONSTRAINT "sales_quotation_line_quotation_id_sales_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_line" ADD CONSTRAINT "sales_quotation_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotation_number_idx" ON "sales_quotation" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_quotation_state_idx" ON "sales_quotation" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sales_quotation_customer_id_idx" ON "sales_quotation" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_quotation_date_idx" ON "sales_quotation" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_quotation_invoice_id_idx" ON "sales_quotation" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_quotation_line_quotation_id_idx" ON "sales_quotation_line" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "sales_quotation_line_product_id_idx" ON "sales_quotation_line" USING btree ("product_id");