import React, { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@platform/ui";
import { LockKeyhole } from "lucide-react";
import { usePlatform } from "../hooks/usePlatform.js";

export function LoginPage() {
  const { authenticate, isReady, error: platformError } = usePlatform();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId.trim() || !password) return;

    setLoading(true);
    setError(null);
    try {
      await authenticate({
        user_id: userId.trim(),
        password,
      });
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <CardTitle className="mt-4">Sign in</CardTitle>
          <CardDescription>
            Authenticate this user and device through the native session
            boundary.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(error || platformError) && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Authentication failed</AlertTitle>
              <AlertDescription>{error ?? platformError}</AlertDescription>
            </Alert>
          )}
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              label="User ID"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              autoComplete="username"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <Button
              type="submit"
              className="w-full"
              isLoading={loading}
              disabled={!isReady || loading}
            >
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
