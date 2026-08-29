package appverify

import (
	"fmt"
	"sort"
)

// Catalog is an immutable registry of verification profiles keyed by workload
// kind. Methods return cloned profiles/checks so callers cannot mutate the
// built-in catalog by accident.
type Catalog struct {
	profiles map[WorkloadKind]VerificationProfile
}

// NewCatalog builds and validates a catalog from profiles.
func NewCatalog(profiles []VerificationProfile) (*Catalog, error) {
	out := &Catalog{profiles: make(map[WorkloadKind]VerificationProfile, len(profiles))}
	for _, profile := range profiles {
		if err := profile.Validate(); err != nil {
			return nil, err
		}
		if _, dup := out.profiles[profile.WorkloadKind]; dup {
			return nil, fmt.Errorf("duplicate profile for workload kind %q", profile.WorkloadKind)
		}
		out.profiles[profile.WorkloadKind] = cloneProfile(profile)
	}
	if err := out.Validate(); err != nil {
		return nil, err
	}
	return out, nil
}

// Validate checks the catalog and every profile it contains.
func (c *Catalog) Validate() error {
	if c == nil || len(c.profiles) == 0 {
		return fmt.Errorf("catalog is empty")
	}
	for kind, profile := range c.profiles {
		if kind != profile.WorkloadKind {
			return fmt.Errorf("catalog key %q does not match profile kind %q", kind, profile.WorkloadKind)
		}
		if err := profile.Validate(); err != nil {
			return err
		}
	}
	return nil
}

// Profile returns the profile for kind.
func (c *Catalog) Profile(kind WorkloadKind) (VerificationProfile, bool) {
	if c == nil {
		return VerificationProfile{}, false
	}
	profile, ok := c.profiles[kind]
	if !ok {
		return VerificationProfile{}, false
	}
	return cloneProfile(profile), true
}

// Profiles returns all profiles sorted by workload kind.
func (c *Catalog) Profiles() []VerificationProfile {
	if c == nil {
		return nil
	}
	out := make([]VerificationProfile, 0, len(c.profiles))
	for _, profile := range c.profiles {
		out = append(out, cloneProfile(profile))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].WorkloadKind < out[j].WorkloadKind
	})
	return out
}

// Check returns a check by workload kind and check ID.
func (c *Catalog) Check(kind WorkloadKind, id string) (VerificationCheck, bool) {
	profile, ok := c.Profile(kind)
	if !ok {
		return VerificationCheck{}, false
	}
	return profile.Check(id)
}

var defaultCatalog *Catalog

func init() {
	catalog, err := buildDefaultCatalog()
	if err != nil {
		panic(fmt.Sprintf("appverify: invalid built-in catalog: %v", err))
	}
	defaultCatalog = catalog
}

// DefaultCatalog returns the validated built-in catalog.
func DefaultCatalog() *Catalog {
	return defaultCatalog
}

// Profiles returns built-in profiles sorted by workload kind.
func Profiles() []VerificationProfile {
	return defaultCatalog.Profiles()
}

// ProfileByKind returns a built-in profile by workload kind.
func ProfileByKind(kind WorkloadKind) (VerificationProfile, bool) {
	return defaultCatalog.Profile(kind)
}

func buildDefaultCatalog() (*Catalog, error) {
	return NewCatalog([]VerificationProfile{
		activeDirectoryProfile(),
		elasticsearchProfile(),
		genericHTTPProfile(),
		kafkaProfile(),
		kubernetesProfile(),
		mongodbProfile(),
		mssqlProfile(),
		mysqlProfile(),
		oracleProfile(),
		postgresProfile(),
		redisProfile(),
	})
}

func postgresProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadPostgres,
		Name:         "PostgreSQL",
		Checks: []VerificationCheck{
			sqlCheck("postgres-connect", "Connect and run SELECT 1", true, 15, "psql", "SELECT 1;", "1", "connectivity"),
			sqlCheck("postgres-recovery-marker", "Recovery marker is present", true, 30, "psql", "SELECT count(*) FROM clario_recovery_markers WHERE recovery_point_id = {recovery_point_id};", ">=1", "consistency"),
			sqlCheck("postgres-write-smoke", "Transactional write path succeeds", true, 30, "psql", "BEGIN; CREATE TEMP TABLE clario_dr_smoke(id int); INSERT INTO clario_dr_smoke VALUES (1); ROLLBACK;", "ROLLBACK", "write_path"),
			sqlCheck("postgres-replica-lag", "Replica replay lag is within objective", false, 20, "psql", "SELECT COALESCE(EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()), 0)::int;", "<={max_lag_seconds}", "rpo"),
		},
	}
}

func mysqlProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadMySQL,
		Name:         "MySQL",
		Checks: []VerificationCheck{
			sqlCheck("mysql-connect", "Connect and run SELECT 1", true, 15, "mysql", "SELECT 1;", "1", "connectivity"),
			sqlCheck("mysql-recovery-marker", "Recovery marker is present", true, 30, "mysql", "SELECT COUNT(*) FROM clario_recovery_markers WHERE recovery_point_id = '{recovery_point_id}';", ">=1", "consistency"),
			sqlCheck("mysql-write-smoke", "Transactional write path succeeds", true, 30, "mysql", "CREATE TEMPORARY TABLE clario_dr_smoke(id INT); INSERT INTO clario_dr_smoke VALUES (1); DROP TEMPORARY TABLE clario_dr_smoke;", "OK", "write_path"),
			sqlCheck("mysql-replica-lag", "Replica lag is within objective", false, 20, "mysql", "SHOW REPLICA STATUS;", "Seconds_Behind_Source<={max_lag_seconds}", "rpo"),
		},
	}
}

func mssqlProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadMSSQL,
		Name:         "Microsoft SQL Server",
		Checks: []VerificationCheck{
			sqlCheck("mssql-connect", "Connect and run SELECT 1", true, 20, "sqlcmd", "SELECT 1;", "1", "connectivity"),
			sqlCheck("mssql-database-online", "Database is online", true, 30, "sqlcmd", "SELECT state_desc FROM sys.databases WHERE name = '{database}';", "ONLINE", "readiness"),
			sqlCheck("mssql-recovery-marker", "Recovery marker is present", true, 30, "sqlcmd", "SELECT COUNT(*) FROM dbo.clario_recovery_markers WHERE recovery_point_id = '{recovery_point_id}';", ">=1", "consistency"),
			sqlCheck("mssql-write-smoke", "Transactional write path succeeds", true, 30, "sqlcmd", "BEGIN TRANSACTION; CREATE TABLE #clario_dr_smoke(id int); INSERT INTO #clario_dr_smoke VALUES (1); ROLLBACK TRANSACTION;", "OK", "write_path"),
			sqlCheck("mssql-replica-lag", "Availability replica lag is within objective", false, 30, "sqlcmd", "SELECT secondary_lag_seconds FROM sys.dm_hadr_database_replica_states;", "<={max_lag_seconds}", "rpo"),
		},
	}
}

func oracleProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadOracle,
		Name:         "Oracle Database",
		Checks: []VerificationCheck{
			tcpCheck("oracle-listener", "Listener accepts TCP connections", true, 15, "{endpoint.address}:1521", "connectivity"),
			sqlCheck("oracle-open-mode", "Database is open for workload access", true, 30, "sqlplus", "SELECT open_mode FROM v$database;", "READ WRITE", "readiness"),
			sqlCheck("oracle-recovery-marker", "Recovery marker is present", true, 30, "sqlplus", "SELECT COUNT(*) FROM clario_recovery_markers WHERE recovery_point_id = '{recovery_point_id}';", ">=1", "consistency"),
			sqlCheck("oracle-write-smoke", "Transactional write path succeeds", true, 45, "sqlplus", "CREATE GLOBAL TEMPORARY TABLE clario_dr_smoke(id NUMBER) ON COMMIT DELETE ROWS; INSERT INTO clario_dr_smoke VALUES (1); ROLLBACK;", "OK", "write_path"),
			sqlCheck("oracle-apply-lag", "Data Guard apply lag is within objective", false, 30, "sqlplus", "SELECT value FROM v$dataguard_stats WHERE name = 'apply lag';", "<={max_lag_seconds}", "rpo"),
		},
	}
}

func mongodbProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadMongoDB,
		Name:         "MongoDB",
		Checks: []VerificationCheck{
			nosqlCheck("mongodb-ping", "MongoDB ping succeeds", true, 15, "mongosh", "db.adminCommand({ ping: 1 })", "ok: 1", "connectivity"),
			nosqlCheck("mongodb-topology", "Replica set topology is healthy", true, 30, "mongosh", "db.hello()", "isWritablePrimary", "readiness"),
			nosqlCheck("mongodb-recovery-marker", "Recovery marker is present", true, 30, "mongosh", "db.getSiblingDB('{database}').clario_recovery_markers.countDocuments({ recovery_point_id: '{recovery_point_id}' })", ">=1", "consistency"),
			nosqlCheck("mongodb-write-smoke", "Write concern majority succeeds", true, 30, "mongosh", "db.getSiblingDB('{database}').clario_dr_smoke.insertOne({ recovery_point_id: '{recovery_point_id}' }, { writeConcern: { w: 'majority' } })", "acknowledged: true", "write_path"),
			nosqlCheck("mongodb-replication-lag", "Replication lag is within objective", false, 30, "mongosh", "rs.printSecondaryReplicationInfo()", "<={max_lag_seconds}", "rpo"),
		},
	}
}

func kafkaProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadKafka,
		Name:         "Apache Kafka",
		Checks: []VerificationCheck{
			tcpCheck("kafka-broker-tcp", "Broker listener accepts TCP connections", true, 15, "{endpoint.address}:9092", "connectivity"),
			cliCheck("kafka-topic-list", "Cluster metadata can be listed", true, 30, "kafka-topics", []string{"--bootstrap-server", "{endpoint.address}:9092", "--list"}, "clario", "readiness"),
			cliCheck("kafka-produce-consume", "Produce and consume smoke message succeeds", true, 45, "kafka-console-producer", []string{"--bootstrap-server", "{endpoint.address}:9092", "--topic", "{smoke_topic}"}, "delivered", "write_path"),
			cliCheck("kafka-consumer-offsets", "Consumer offsets are readable", false, 30, "kafka-consumer-groups", []string{"--bootstrap-server", "{endpoint.address}:9092", "--describe", "--all-groups"}, "GROUP", "rpo"),
		},
	}
}

func elasticsearchProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadElasticsearch,
		Name:         "Elasticsearch",
		Checks: []VerificationCheck{
			httpCheck("elasticsearch-cluster-health", "Cluster health is at least yellow", true, 20, "{endpoint.url}", "GET", "/_cluster/health?wait_for_status=yellow&timeout=10s", []int{200}, "\"status\"", "readiness"),
			httpCheck("elasticsearch-index-search", "Recovered index is searchable", true, 30, "{endpoint.url}", "GET", "/{index}/_search?q=_id:{recovery_point_id}", []int{200}, "\"hits\"", "consistency"),
			httpCheck("elasticsearch-write-smoke", "Document write and refresh succeeds", true, 30, "{endpoint.url}", "POST", "/clario-dr-smoke/_doc?refresh=true", []int{200, 201}, "\"result\"", "write_path"),
			httpCheck("elasticsearch-active-shards", "Active shards meet objective", false, 20, "{endpoint.url}", "GET", "/_cluster/health", []int{200}, "\"active_shards_percent_as_number\"", "rpo"),
		},
	}
}

func redisProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadRedis,
		Name:         "Redis",
		Checks: []VerificationCheck{
			cliCheck("redis-ping", "Redis PING succeeds", true, 10, "redis-cli", []string{"-h", "{endpoint.address}", "PING"}, "PONG", "connectivity"),
			cliCheck("redis-role", "Redis role is reported", true, 10, "redis-cli", []string{"-h", "{endpoint.address}", "ROLE"}, "master", "readiness"),
			cliCheck("redis-recovery-marker", "Recovery marker is present", true, 15, "redis-cli", []string{"-h", "{endpoint.address}", "GET", "clario:recovery:{recovery_point_id}"}, "{recovery_point_id}", "consistency"),
			cliCheck("redis-write-smoke", "SET/DEL smoke operation succeeds", true, 15, "redis-cli", []string{"-h", "{endpoint.address}", "--raw", "SET", "clario:dr:smoke", "{recovery_point_id}"}, "OK", "write_path"),
			cliCheck("redis-replication-offset", "Replication offset gap is within objective", false, 15, "redis-cli", []string{"-h", "{endpoint.address}", "INFO", "replication"}, "offset_gap<={max_lag_seconds}", "rpo"),
		},
	}
}

func activeDirectoryProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadActiveDirectory,
		Name:         "Active Directory",
		Checks: []VerificationCheck{
			ldapCheck("active-directory-ldap-bind", "LDAP bind and RootDSE query succeeds", true, 20, "ldapsearch", "base=\"\" scope=base filter=\"(objectClass=*)\" attrs=defaultNamingContext", "defaultNamingContext", "connectivity"),
			cliCheck("active-directory-dns-srv", "Domain controller SRV records resolve", true, 20, "nslookup", []string{"-type=SRV", "_ldap._tcp.dc._msdcs.{domain}"}, "_ldap", "readiness"),
			cliCheck("active-directory-sysvol", "SYSVOL and NETLOGON shares are available", true, 30, "net", []string{"view", "\\\\{endpoint.address}"}, "SYSVOL", "consistency"),
			cliCheck("active-directory-replication", "Directory replication summary is healthy", false, 45, "repadmin", []string{"/replsummary"}, "0 fails", "rpo"),
		},
	}
}

func kubernetesProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadKubernetes,
		Name:         "Kubernetes",
		Checks: []VerificationCheck{
			k8sCheck("kubernetes-api-ready", "API server readyz succeeds", true, 20, "kubectl", []string{"get", "--raw=/readyz"}, "ok", "connectivity"),
			k8sCheck("kubernetes-nodes-ready", "Recovered nodes are Ready", true, 45, "kubectl", []string{"wait", "--for=condition=Ready", "nodes", "--all", "--timeout=30s"}, "condition met", "readiness"),
			k8sCheck("kubernetes-workloads-available", "Workloads in namespace are available", true, 60, "kubectl", []string{"-n", "{namespace}", "wait", "--for=condition=Available", "deployments", "--all", "--timeout=45s"}, "condition met", "readiness"),
			k8sCheck("kubernetes-pvcs-bound", "Persistent volume claims are bound", false, 30, "kubectl", []string{"-n", "{namespace}", "get", "pvc", "-o", "jsonpath={.items[*].status.phase}"}, "Bound", "consistency"),
		},
	}
}

func genericHTTPProfile() VerificationProfile {
	return VerificationProfile{
		WorkloadKind: WorkloadGenericHTTP,
		Name:         "Generic HTTP service",
		Checks: []VerificationCheck{
			httpCheck("http-ready", "Readiness endpoint returns success", true, 15, "{endpoint.url}", "GET", "{health_path}", []int{200, 204}, "", "connectivity"),
			httpCheck("http-recovery-marker", "Recovery marker endpoint returns expected marker", true, 20, "{endpoint.url}", "GET", "{marker_path}", []int{200}, "{recovery_point_id}", "consistency"),
			httpCheck("http-write-smoke", "HTTP write-path smoke endpoint succeeds", false, 30, "{endpoint.url}", "POST", "{smoke_path}", []int{200, 201, 202, 204}, "", "write_path"),
		},
	}
}

func sqlCheck(id, name string, required bool, timeout int, tool, query, expect, tag string) VerificationCheck {
	return VerificationCheck{
		ID:             id,
		Name:           name,
		Kind:           CheckSQLQuery,
		Required:       required,
		TimeoutSeconds: timeout,
		Command:        &CommandSpec{Tool: tool, Query: query, ExpectedOutputContains: expect},
		Tags:           []string{tag},
	}
}

func nosqlCheck(id, name string, required bool, timeout int, tool, query, expect, tag string) VerificationCheck {
	return VerificationCheck{
		ID:             id,
		Name:           name,
		Kind:           CheckNoSQLCommand,
		Required:       required,
		TimeoutSeconds: timeout,
		Command:        &CommandSpec{Tool: tool, Query: query, ExpectedOutputContains: expect},
		Tags:           []string{tag},
	}
}

func cliCheck(id, name string, required bool, timeout int, tool string, args []string, expect, tag string) VerificationCheck {
	return VerificationCheck{
		ID:             id,
		Name:           name,
		Kind:           CheckCLICommand,
		Required:       required,
		TimeoutSeconds: timeout,
		Command:        &CommandSpec{Tool: tool, Args: append([]string(nil), args...), ExpectedOutputContains: expect},
		Tags:           []string{tag},
	}
}

func ldapCheck(id, name string, required bool, timeout int, tool, query, expect, tag string) VerificationCheck {
	return VerificationCheck{
		ID:             id,
		Name:           name,
		Kind:           CheckLDAPQuery,
		Required:       required,
		TimeoutSeconds: timeout,
		Command:        &CommandSpec{Tool: tool, Query: query, ExpectedOutputContains: expect},
		Tags:           []string{tag},
	}
}

func k8sCheck(id, name string, required bool, timeout int, tool string, args []string, expect, tag string) VerificationCheck {
	return VerificationCheck{
		ID:             id,
		Name:           name,
		Kind:           CheckKubernetesAPI,
		Required:       required,
		TimeoutSeconds: timeout,
		Command:        &CommandSpec{Tool: tool, Args: append([]string(nil), args...), ExpectedOutputContains: expect},
		Tags:           []string{tag},
	}
}

func httpCheck(id, name string, required bool, timeout int, target, method, path string, expectedStatus []int, expectedBody, tag string) VerificationCheck {
	return VerificationCheck{
		ID:             id,
		Name:           name,
		Kind:           CheckHTTPProbe,
		Required:       required,
		TimeoutSeconds: timeout,
		Probe: &ProbeSpec{
			Protocol:             ProbeHTTP,
			Target:               target,
			Method:               method,
			Path:                 path,
			ExpectedStatus:       append([]int(nil), expectedStatus...),
			ExpectedBodyContains: expectedBody,
		},
		Tags: []string{tag},
	}
}

func tcpCheck(id, name string, required bool, timeout int, target, tag string) VerificationCheck {
	return VerificationCheck{
		ID:             id,
		Name:           name,
		Kind:           CheckTCPProbe,
		Required:       required,
		TimeoutSeconds: timeout,
		Probe:          &ProbeSpec{Protocol: ProbeTCP, Target: target},
		Tags:           []string{tag},
	}
}
