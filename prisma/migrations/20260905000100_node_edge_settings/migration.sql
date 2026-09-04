-- Panel-owned desired settings must not be overwritten by Agent metadata reports.
CREATE TABLE "node_edge_config" (
    "node_id" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    CONSTRAINT "node_edge_config_pkey" PRIMARY KEY ("node_id"),
    CONSTRAINT "node_edge_config_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "node_edge_config_node_id_fkey" FOREIGN KEY ("node_id")
        REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
