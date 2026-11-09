import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type HostingOwnerLoginFormProps = {
  busy: boolean;
  error: string;
  onSubmit: (username: string, password: string) => Promise<boolean>;
};

const HostingOwnerLoginForm = ({ busy, error, onSubmit }: HostingOwnerLoginFormProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await onSubmit(username, password)) setPassword("");
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold leading-none tracking-tight">
          بوابة مالك الاستضافة
        </h1>
        <CardDescription>دخول خاص لإدارة مخزون عملات الموقع</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="hosting-owner-username" className="text-sm font-medium">
              اسم المستخدم
            </label>
            <Input
              id="hosting-owner-username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="hosting-owner-password" className="text-sm font-medium">
              كلمة المرور
            </label>
            <Input
              id="hosting-owner-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              dir="ltr"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "جارٍ التحقق…" : "تسجيل الدخول"}
          </Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
};

export default HostingOwnerLoginForm;
