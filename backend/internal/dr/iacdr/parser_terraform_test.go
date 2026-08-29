package iacdr

import (
	"errors"
	"testing"
)

// realTerraformState is a REAL terraform.tfstate (version 4) fixture with three
// resources and their dependencies recorded the way Terraform records them:
// aws_subnet.main depends on aws_vpc.main, and aws_instance.web depends on
// aws_subnet.main. It also includes a data source (aws_ami.ubuntu) which the
// parser must SKIP (data sources are reads, not infra to reconstitute) and a
// count-expanded resource (aws_security_group_rule.allow) with two instances.
const realTerraformState = `{
  "version": 4,
  "terraform_version": "1.7.5",
  "serial": 42,
  "lineage": "1f2e3d4c-aaaa-bbbb-cccc-000000000001",
  "outputs": {},
  "resources": [
    {
      "mode": "managed",
      "type": "aws_vpc",
      "name": "main",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        {
          "index_key": null,
          "attributes": { "cidr_block": "10.0.0.0/16", "tags": { "Name": "main-vpc" }, "id": "vpc-123" },
          "dependencies": []
        }
      ]
    },
    {
      "mode": "managed",
      "type": "aws_subnet",
      "name": "main",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        {
          "index_key": null,
          "attributes": { "cidr_block": "10.0.1.0/24", "vpc_id": "vpc-123", "id": "subnet-456" },
          "dependencies": ["aws_vpc.main"]
        }
      ]
    },
    {
      "mode": "managed",
      "type": "aws_instance",
      "name": "web",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        {
          "index_key": null,
          "attributes": { "instance_type": "t3.micro", "subnet_id": "subnet-456", "id": "i-789" },
          "dependencies": ["aws_subnet.main", "data.aws_ami.ubuntu"]
        }
      ]
    },
    {
      "mode": "data",
      "type": "aws_ami",
      "name": "ubuntu",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        { "attributes": { "id": "ami-000" }, "dependencies": [] }
      ]
    },
    {
      "mode": "managed",
      "type": "aws_security_group_rule",
      "name": "allow",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        { "index_key": 0, "attributes": { "from_port": 80 }, "dependencies": [] },
        { "index_key": 1, "attributes": { "from_port": 443 }, "dependencies": [] }
      ]
    }
  ]
}`

func TestTerraformParser_RealState(t *testing.T) {
	p := NewTerraformParser()
	res, err := p.Parse([]byte(realTerraformState))
	if err != nil {
		t.Fatalf("Parse: unexpected error: %v", err)
	}
	if res.SourceKind != SourceTerraformState {
		t.Fatalf("SourceKind = %q, want %q", res.SourceKind, SourceTerraformState)
	}

	// 3 single managed resources + 2 count instances = 5; the data source skipped.
	if got := len(res.Resources); got != 5 {
		t.Fatalf("resource count = %d, want 5; resources=%v", got, addresses(res.Resources))
	}

	byAddr := map[string]Resource{}
	for _, r := range res.Resources {
		byAddr[r.Address] = r
	}

	// VPC: no deps, provider extracted from the long provider address.
	vpc, ok := byAddr["aws_vpc.main"]
	if !ok {
		t.Fatalf("aws_vpc.main missing; got %v", addresses(res.Resources))
	}
	if vpc.Provider != "aws" {
		t.Errorf("vpc provider = %q, want aws", vpc.Provider)
	}
	if vpc.Type != "aws_vpc" || vpc.Name != "main" {
		t.Errorf("vpc type/name = %q/%q", vpc.Type, vpc.Name)
	}
	if len(vpc.DependsOn) != 0 {
		t.Errorf("vpc deps = %v, want none", vpc.DependsOn)
	}
	if vpc.Attributes["cidr_block"] != "10.0.0.0/16" {
		t.Errorf("vpc cidr_block = %v", vpc.Attributes["cidr_block"])
	}

	// Subnet depends on vpc.
	subnet := byAddr["aws_subnet.main"]
	if len(subnet.DependsOn) != 1 || subnet.DependsOn[0] != "aws_vpc.main" {
		t.Errorf("subnet deps = %v, want [aws_vpc.main]", subnet.DependsOn)
	}

	// Instance depends on subnet AND the data source (the raw edge is preserved;
	// the planner drops the unreconstitutable external edge — tested separately).
	inst := byAddr["aws_instance.web"]
	if len(inst.DependsOn) != 2 {
		t.Errorf("instance deps = %v, want 2 (subnet + data ami)", inst.DependsOn)
	}

	// count-expanded resources got distinct addresses + names.
	if _, ok := byAddr["aws_security_group_rule.allow[0]"]; !ok {
		t.Errorf("missing count instance [0]; got %v", addresses(res.Resources))
	}
	if _, ok := byAddr["aws_security_group_rule.allow[1]"]; !ok {
		t.Errorf("missing count instance [1]; got %v", addresses(res.Resources))
	}

	// Every resource carries a non-empty hash.
	for _, r := range res.Resources {
		if r.Hash == "" {
			t.Errorf("resource %s has empty hash", r.Address)
		}
	}

	// Provenance metadata.
	if res.Metadata["terraform_version"] != "1.7.5" {
		t.Errorf("metadata terraform_version = %q", res.Metadata["terraform_version"])
	}
	if res.Metadata["lineage"] == "" {
		t.Errorf("metadata lineage missing")
	}
}

func TestTerraformParser_Errors(t *testing.T) {
	p := NewTerraformParser()
	tests := []struct {
		name    string
		input   string
		wantErr error
	}{
		{"empty", "", ErrEmptyArtifact},
		{"malformed json", "{ not json", ErrParse},
		{"no managed resources", `{"version":4,"resources":[{"mode":"data","type":"aws_ami","name":"x","instances":[{"attributes":{}}]}]}`, ErrEmptyArtifact},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := p.Parse([]byte(tt.input))
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestTerraformParser_LegacyV3(t *testing.T) {
	const v3 = `{
      "version": 3,
      "terraform_version": "0.11.14",
      "modules": [
        {
          "path": ["root"],
          "resources": {
            "aws_vpc.main": {
              "type": "aws_vpc",
              "provider": "provider.aws",
              "depends_on": [],
              "primary": { "id": "vpc-1", "attributes": { "cidr_block": "10.0.0.0/16" } }
            },
            "aws_subnet.main": {
              "type": "aws_subnet",
              "provider": "provider.aws",
              "depends_on": ["aws_vpc.main"],
              "primary": { "id": "subnet-1", "attributes": { "cidr_block": "10.0.1.0/24" } }
            }
          }
        }
      ]
    }`
	res, err := NewTerraformParser().Parse([]byte(v3))
	if err != nil {
		t.Fatalf("Parse v3: %v", err)
	}
	if len(res.Resources) != 2 {
		t.Fatalf("v3 resource count = %d, want 2", len(res.Resources))
	}
	byAddr := map[string]Resource{}
	for _, r := range res.Resources {
		byAddr[r.Address] = r
	}
	subnet, ok := byAddr["aws_subnet.main"]
	if !ok {
		t.Fatalf("v3 aws_subnet.main missing; got %v", addresses(res.Resources))
	}
	if subnet.Provider != "aws" {
		t.Errorf("v3 subnet provider = %q, want aws", subnet.Provider)
	}
	if len(subnet.DependsOn) != 1 || subnet.DependsOn[0] != "aws_vpc.main" {
		t.Errorf("v3 subnet deps = %v", subnet.DependsOn)
	}
}

func addresses(rs []Resource) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Address
	}
	return out
}
