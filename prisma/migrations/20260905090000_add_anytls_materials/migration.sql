CREATE TABLE "anytls_materials" (
    "inbound_uuid" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "material" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anytls_materials_pkey" PRIMARY KEY ("inbound_uuid"),
    CONSTRAINT "anytls_materials_inbound_uuid_fkey" FOREIGN KEY ("inbound_uuid")
      REFERENCES "config_profile_inbounds"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);
