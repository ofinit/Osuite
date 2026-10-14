CREATE TABLE "stock_adjustment" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_adjustment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30),
	"state" varchar(50) DEFAULT 'draft' NOT NULL,
	"warehouse_id" bigint,
	"date" date DEFAULT current_date NOT NULL,
	"reason" varchar(50) DEFAULT 'count' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_adjustment_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"adjustment_id" bigint,
	"sequence" integer,
	"product_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(16, 2),
	"note" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "stock_move" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_move_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"date" date NOT NULL,
	"reference" varchar(60) NOT NULL,
	"kind" varchar(50) NOT NULL,
	"product_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"qty" numeric(16, 3) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"value" numeric(16, 2) NOT NULL,
	"balance_qty" numeric(16, 3) NOT NULL,
	"ref_model" varchar(60) NOT NULL,
	"ref_id" integer NOT NULL,
	"reversed_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "stock_quant" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_quant_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"product_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"qty" numeric(16, 3) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"value" numeric(16, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_warehouse" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_warehouse_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"name" varchar(120) NOT NULL,
	"code" varchar(10) NOT NULL,
	"street" varchar(255),
	"city" varchar(100),
	"state_code" varchar(50)
);
--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD COLUMN "warehouse_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "warehouse_id" bigint;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_line" ADD CONSTRAINT "stock_adjustment_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_line" ADD CONSTRAINT "stock_adjustment_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_line" ADD CONSTRAINT "stock_adjustment_line_adjustment_id_stock_adjustment_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_line" ADD CONSTRAINT "stock_adjustment_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_reversed_by_id_stock_move_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."stock_move"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_warehouse" ADD CONSTRAINT "stock_warehouse_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_warehouse" ADD CONSTRAINT "stock_warehouse_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_adjustment_number_idx" ON "stock_adjustment" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_adjustment_state_idx" ON "stock_adjustment" USING btree ("state");--> statement-breakpoint
CREATE INDEX "stock_adjustment_warehouse_id_idx" ON "stock_adjustment" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_adjustment_line_adjustment_id_idx" ON "stock_adjustment_line" USING btree ("adjustment_id");--> statement-breakpoint
CREATE INDEX "stock_adjustment_line_product_id_idx" ON "stock_adjustment_line" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_move_date_idx" ON "stock_move" USING btree ("date");--> statement-breakpoint
CREATE INDEX "stock_move_reference_idx" ON "stock_move" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "stock_move_product_id_idx" ON "stock_move" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_move_warehouse_id_idx" ON "stock_move" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_move_reversed_by_id_idx" ON "stock_move" USING btree ("reversed_by_id");--> statement-breakpoint
CREATE INDEX "stock_quant_product_id_idx" ON "stock_quant" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_quant_warehouse_id_idx" ON "stock_quant" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_quant_product_id_warehouse_id_key" ON "stock_quant" USING btree ("product_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_warehouse_code_idx" ON "stock_warehouse" USING btree ("code");--> statement-breakpoint
ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_warehouse_id_stock_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."stock_warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_bill_warehouse_id_idx" ON "purchase_bill" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_warehouse_id_idx" ON "sales_invoice" USING btree ("warehouse_id");