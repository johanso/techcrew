import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

export function AuthHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function AuthDivider() {
  return <FieldSeparator className="text-xs uppercase tracking-wide">or continue with email</FieldSeparator>;
}

export function FormMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
      <CircleAlertIcon />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending} className="h-10 w-full text-sm">
      {pending && <Spinner />}
      {children}
    </Button>
  );
}
