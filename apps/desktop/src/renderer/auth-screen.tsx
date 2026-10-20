import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AuthLayout } from "@quieter/app/components/auth-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { Button } from "@quieter/ui/button";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { useEffect, useState } from "react";

export const DesktopAuthScreen = () => {
  const [waiting, setWaiting] = useState(false);
  const [pending, setPending] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");

  useEffect(
    () =>
      window.onAuthError(() => {
        setPending(false);
        setWaiting(false);
        toastError(new Error("Desktop sign-in failed"));
      }),
    []
  );

  const signIn = async () => {
    setPending(true);
    try {
      await window.requestAuth();
      setWaiting(true);
    } catch (error) {
      toastError(error);
    } finally {
      setPending(false);
    }
  };

  const redeemCode = async () => {
    setPending(true);
    try {
      await window.authenticate({ token: code.trim() });
    } catch (error) {
      toastError(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout title="Continue to Quieter">
      <Button
        className="mt-8"
        onClick={() => {
          void signIn();
        }}
        pending={pending}
        pendingLabel="Opening browser"
        size="block"
      >
        {waiting ? "Open browser again" : "Continue in browser"}
        <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} />
      </Button>
      {waiting ? (
        <div className="mt-4 space-y-3">
          <p
            aria-live="polite"
            className="text-center text-body-sm text-muted-fg"
          >
            Finish signing in in your browser.
          </p>
          <Button
            onClick={() => {
              setShowCode(!showCode);
            }}
            size="block"
            variant="ghost"
          >
            Use a sign-in code
          </Button>
          {showCode ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void redeemCode();
              }}
            >
              <Field>
                <FieldLabel htmlFor="sign-in-code">Sign-in code</FieldLabel>
                <Input
                  autoComplete="off"
                  id="sign-in-code"
                  maxLength={4096}
                  onChange={(event) => {
                    setCode(event.target.value);
                  }}
                  value={code}
                />
              </Field>
              <Button
                disabled={!code.trim()}
                pending={pending}
                size="block"
                type="submit"
                variant="outline"
              >
                Continue
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </AuthLayout>
  );
};
