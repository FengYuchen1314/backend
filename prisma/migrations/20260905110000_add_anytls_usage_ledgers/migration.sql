CREATE TABLE "anytls_usage_ledgers" (
    "node_uuid" UUID NOT NULL,
    "epoch" UUID NOT NULL,
    "counters" JSONB NOT NULL DEFAULT '{}',
    "node_remainder_nano" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "anytls_usage_ledgers_pkey" PRIMARY KEY ("node_uuid", "epoch"),
    CONSTRAINT "anytls_usage_ledgers_node_uuid_fkey" FOREIGN KEY ("node_uuid")
        REFERENCES "nodes"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);
