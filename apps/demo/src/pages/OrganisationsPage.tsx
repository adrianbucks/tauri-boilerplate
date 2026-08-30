import React, { useState, useCallback, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@platform/ui";
import { Building2, Plus, CheckCircle, Globe } from "lucide-react";
import {
  OrganisationService,
  type OrganisationRecord,
} from "@features/organisations";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";

const ctx = createOperationContext({
  deviceId: "demo_device",
  organisationId: "org_demo",
  userId: "user_demo",
});

interface OrgRowProps {
  org: OrganisationRecord;
}

function OrgRow({ org }: OrgRowProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Building2 className="h-4 w-4" />
        </div>
        <div>
          <div className="font-medium text-sm">{org.name}</div>
          {org.domain ? (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
              <Globe className="h-3 w-3" />
              <code className="bg-muted px-1 rounded">{org.domain}</code>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground mt-0.5">
              No domain
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Created {new Date(org.created_at).toLocaleString()}
          </div>
        </div>
      </div>
      <Badge
        variant={
          org.status === "ACTIVE"
            ? "success"
            : org.status === "SUSPENDED"
              ? "warning"
              : "secondary"
        }
      >
        {org.status}
      </Badge>
    </div>
  );
}

export function OrganisationsPage() {
  const [orgs, setOrgs] = useState<OrganisationRecord[]>([]);
  const [service, setService] = useState<OrganisationService | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = new MemoryDatabaseConnection(":memory:");
      await db.init();
      await db.execute(`
        CREATE TABLE core_organisations (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT,
          updated_by TEXT,
          name TEXT NOT NULL,
          domain TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          settings_json TEXT
        );
      `);
      const svc = new OrganisationService(db);
      setService(svc);
      setOrgs(await svc.listOrganisations());
    })();
  }, []);

  const loadOrgs = useCallback(async () => {
    if (!service) return;
    setOrgs(await service.listOrganisations());
  }, [service]);

  const handleCreate = useCallback(async () => {
    if (!service || !name.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const org = await service.createOrganisation(
        { name: name.trim(), domain: domain.trim() || undefined },
        ctx,
      );
      setSuccess(`Organisation "${org.name}" created successfully`);
      setName("");
      setDomain("");
      await loadOrgs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [service, name, domain, loadOrgs]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Organisations</h1>
        <p className="text-muted-foreground mt-1">
          Manage organisation tenancies — each with optional domain and
          configurable settings.
        </p>
      </div>

      {success && (
        <Alert variant="success">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create Organisation</CardTitle>
          <CardDescription>
            Register a new tenancy in the local database
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 max-w-2xl">
            <div className="flex-1 min-w-[200px]">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Logistics Ltd"
                label="Organisation Name *"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com (optional)"
                label="Domain"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleCreate}
                isLoading={loading}
                disabled={!service || !name.trim()}
              >
                <Plus className="h-4 w-4 mr-1" />
                Create
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Organisations ({orgs.length})</CardTitle>
          <CardDescription>
            Registered organisation tenancies in the local database
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orgs.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              No organisations yet — create one above.
            </div>
          ) : (
            <div className="space-y-3">
              {orgs.map((org) => (
                <OrgRow key={org.id} org={org} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
