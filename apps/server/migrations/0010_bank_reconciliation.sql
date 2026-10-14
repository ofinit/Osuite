CREATE TABLE "account_bank_account" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_bank_account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"name" varchar(120) NOT NULL,
	"bank_name" varchar(120),
	"account_number" varchar(30),
	"ifsc" varchar(11),
	"ledger_account_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_statement" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_statement_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"name" varchar(160) NOT NULL,
	"bank_account_id" bigint NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"closing_balance" numeric(16, 2),
	"line_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_statement_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_statement_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"statement_id" bigint,
	"sequence" integer,
	"bank_account_id" bigint NOT NULL,
	"date" date NOT NULL,
	"description" varchar(300) NOT NULL,
	"reference" varchar(80),
	"amount" numeric(16, 2) NOT NULL,
	"balance" numeric(16, 2),
	"fingerprint" varchar(64) NOT NULL,
	"entry_line_id" bigint
);
--> statement-breakpoint
ALTER TABLE "account_payment" ADD COLUMN "bank_account_id" bigint;--> statement-breakpoint
ALTER TABLE "account_bank_account" ADD CONSTRAINT "account_bank_account_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_bank_account" ADD CONSTRAINT "account_bank_account_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_bank_account" ADD CONSTRAINT "account_bank_account_ledger_account_id_account_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."account_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statement" ADD CONSTRAINT "account_statement_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statement" ADD CONSTRAINT "account_statement_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statement" ADD CONSTRAINT "account_statement_bank_account_id_account_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."account_bank_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statement_line" ADD CONSTRAINT "account_statement_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statement_line" ADD CONSTRAINT "account_statement_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statement_line" ADD CONSTRAINT "account_statement_line_statement_id_account_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."account_statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statement_line" ADD CONSTRAINT "account_statement_line_bank_account_id_account_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."account_bank_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statement_line" ADD CONSTRAINT "account_statement_line_entry_line_id_account_entry_line_id_fk" FOREIGN KEY ("entry_line_id") REFERENCES "public"."account_entry_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_bank_account_ledger_account_id_idx" ON "account_bank_account" USING btree ("ledger_account_id");--> statement-breakpoint
CREATE INDEX "account_statement_bank_account_id_idx" ON "account_statement" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "account_statement_line_statement_id_idx" ON "account_statement_line" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "account_statement_line_bank_account_id_idx" ON "account_statement_line" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "account_statement_line_date_idx" ON "account_statement_line" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "account_statement_line_entry_line_id_idx" ON "account_statement_line" USING btree ("entry_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_statement_line_bank_account_id_fingerprint_key" ON "account_statement_line" USING btree ("bank_account_id","fingerprint");--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_bank_account_id_account_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."account_bank_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_payment_bank_account_id_idx" ON "account_payment" USING btree ("bank_account_id");