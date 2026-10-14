CREATE TABLE "sales_invoice" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_invoice_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
	"due_date" date,
	"reference" varchar(60),
	"notes" text,
	"taxable_amount" numeric(16, 2),
	"cgst_amount" numeric(16, 2),
	"sgst_amount" numeric(16, 2),
	"igst_amount" numeric(16, 2),
	"round_off" numeric(16, 2),
	"total_amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_invoice_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"invoice_id" bigint,
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
CREATE TABLE "sequences" (
	"code" varchar(30) NOT NULL,
	"period" varchar(10) NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "sequences_code_period_pk" PRIMARY KEY("code","period")
);
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_number_idx" ON "sales_invoice" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_invoice_state_idx" ON "sales_invoice" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sales_invoice_customer_id_idx" ON "sales_invoice" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_date_idx" ON "sales_invoice" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_invoice_line_invoice_id_idx" ON "sales_invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_line_product_id_idx" ON "sales_invoice_line" USING btree ("product_id");