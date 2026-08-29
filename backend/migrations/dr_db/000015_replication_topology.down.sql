DROP POLICY IF EXISTS tenant_delete ON dr_topology_edge;
DROP POLICY IF EXISTS tenant_update ON dr_topology_edge;
DROP POLICY IF EXISTS tenant_insert ON dr_topology_edge;
DROP POLICY IF EXISTS tenant_isolation ON dr_topology_edge;

DROP POLICY IF EXISTS tenant_delete ON dr_topology_node;
DROP POLICY IF EXISTS tenant_update ON dr_topology_node;
DROP POLICY IF EXISTS tenant_insert ON dr_topology_node;
DROP POLICY IF EXISTS tenant_isolation ON dr_topology_node;

DROP TABLE IF EXISTS dr_topology_edge;
DROP TABLE IF EXISTS dr_topology_node;
