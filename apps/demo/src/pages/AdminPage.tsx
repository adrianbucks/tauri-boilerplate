import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@platform/ui";
import { Users, Laptop, RefreshCw, ShieldOff, Info } from "lucide-react";

interface MockUser {
  id: string;
  displayName: string;
  email: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED";
}

interface MockDevice {
  deviceId: string;
  name: string;
  status: "APPROVED" | "PENDING_APPROVAL" | "REVOKED";
  lastSeen: string;
}

const MOCK_USERS: MockUser[] = [
  {
    id: "usr_1",
    displayName: "Admin User",
    email: "admin@acme.com",
    role: "ADMIN",
    status: "ACTIVE",
  },
  {
    id: "usr_2",
    displayName: "Operator Alice",
    email: "alice@acme.com",
    role: "OPERATOR",
    status: "ACTIVE",
  },
  {
    id: "usr_3",
    displayName: "Viewer Bob",
    email: "bob@acme.com",
    role: "VIEWER",
    status: "SUSPENDED",
  },
];

const MOCK_DEVICES: MockDevice[] = [
  {
    deviceId: "dev_laptop_1",
    name: "Admin Laptop",
    status: "APPROVED",
    lastSeen: "2026-08-30T10:00:00Z",
  },
  {
    deviceId: "dev_tablet_2",
    name: "Warehouse Tablet",
    status: "PENDING_APPROVAL",
    lastSeen: "2026-08-30T09:30:00Z",
  },
  {
    deviceId: "dev_phone_3",
    name: "Field Phone",
    status: "REVOKED",
    lastSeen: "2026-08-29T14:00:00Z",
  },
];

export function AdminPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Identity & Access Admin
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage users, device approvals, and sync group memberships.
        </p>
      </div>

      <Alert variant="info">
        <Info className="h-4 w-4" />
        <AlertTitle>Demo Mode</AlertTitle>
        <AlertDescription>
          This page displays representative mock data. In a full Tauri build,{" "}
          <code>IdentityAdminService</code> performs live operations against the
          native SQLite database, emitting audit events for every change.
        </AlertDescription>
      </Alert>

      {/* Users */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle>Users</CardTitle>
          </div>
          <CardDescription>
            All user accounts in the primary organisation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {MOCK_USERS.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div>
                  <div className="font-medium text-sm">{user.displayName}</div>
                  <div className="text-xs text-muted-foreground">
                    {user.email}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{user.role}</Badge>
                  <Badge
                    variant={user.status === "ACTIVE" ? "success" : "warning"}
                  >
                    {user.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Devices */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-primary" />
            <CardTitle>Device Registry</CardTitle>
          </div>
          <CardDescription>
            All registered devices and their pairing status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {MOCK_DEVICES.map((device) => (
              <div
                key={device.deviceId}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div>
                  <div className="font-medium text-sm">{device.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {device.deviceId}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Last seen: {new Date(device.lastSeen).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {device.status === "PENDING_APPROVAL" && (
                    <Badge variant="warning">
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Pending Approval
                    </Badge>
                  )}
                  {device.status === "APPROVED" && (
                    <Badge variant="success">Approved</Badge>
                  )}
                  {device.status === "REVOKED" && (
                    <Badge variant="destructive">
                      <ShieldOff className="h-3 w-3 mr-1" />
                      Revoked
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sync Groups */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            <CardTitle>Sync Groups</CardTitle>
          </div>
          <CardDescription>
            P2P synchronisation groups and their membership policies
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                id: "grp_all",
                name: "Global Sync Group",
                members: 2,
                policy: "lww",
                status: "ACTIVE",
              },
              {
                id: "grp_ops",
                name: "Operations Team",
                members: 1,
                policy: "additive",
                status: "ACTIVE",
              },
            ].map((group) => (
              <div
                key={group.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div>
                  <div className="font-medium text-sm">{group.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {group.members} member{group.members !== 1 ? "s" : ""} ·
                    Conflict policy:{" "}
                    <code className="bg-muted px-1 rounded">
                      {group.policy}
                    </code>
                  </div>
                </div>
                <Badge variant="success">{group.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
