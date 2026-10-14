CREATE TABLE "activations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"license_id" varchar(40) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"hostname" varchar(200),
	"platform" varchar(20),
	"app_version" varchar(20),
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checkin_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider" varchar(20) NOT NULL,
	"event_id" varchar(100) NOT NULL,
	"type" varchar(60) NOT NULL,
	"license_id" varchar(40),
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" varchar(200) NOT NULL,
	"email" varchar(200) NOT NULL,
	"phone" varchar(30),
	"company" varchar(200),
	"gstin" varchar(15),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"key" varchar(40) NOT NULL,
	"customer_id" bigint NOT NULL,
	"plan_id" varchar(40) NOT NULL,
	"seats" integer NOT NULL,
	"modules" jsonb NOT NULL,
	"billing_cycle" varchar(10) NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"deployment" varchar(10) DEFAULT 'desktop' NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"max_activations" integer DEFAULT 1 NOT NULL,
	"razorpay_subscription_id" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licenses_key_unique" UNIQUE("key"),
	CONSTRAINT "licenses_razorpay_subscription_id_unique" UNIQUE("razorpay_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"seats" integer NOT NULL,
	"modules" jsonb NOT NULL,
	"price_monthly" numeric(12, 2) NOT NULL,
	"price_yearly" numeric(12, 2) NOT NULL,
	"cloud_addon_monthly" numeric(12, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_claims" (
	"fingerprint" varchar(64) PRIMARY KEY NOT NULL,
	"license_id" varchar(40) NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activations_license_idx" ON "activations" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "activations_fp_idx" ON "activations" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_event_idx" ON "billing_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "licenses_customer_idx" ON "licenses" USING btree ("customer_id");