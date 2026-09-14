import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, View } from "react-native";

import { BrandMark } from "#/components/brand-mark";
import { Button } from "#/components/ui/button";
import { Surface } from "#/components/ui/surface";
import { Text } from "#/components/ui/text";
import { authClient } from "#/lib/auth-client";
import { webUrl } from "#/lib/env";

import { GoogleLogo } from "./google-logo";

const AUTHENTICATION_ERROR_MESSAGE =
  "We could not complete that sign-in. Please try again.";

export const AuthScreen = () => {
  const [error, setError] = useState<string | null>(null);

  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- Sign-in has no query cache to invalidate.
  const googleMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signIn.social({
        callbackURL: "/",
        errorCallbackURL: "/sign-in",
        fetchOptions: { timeout: 120_000 },
        provider: "google",
        requestSignUp: true,
      });
      if (response?.error) {
        throw new Error(response.error.message ?? AUTHENTICATION_ERROR_MESSAGE);
      }
    },
    onError: (mutationError: Error) => {
      setError(mutationError.message || AUTHENTICATION_ERROR_MESSAGE);
    },
    onMutate: () => {
      setError(null);
    },
  });

  return (
    <View className="flex-1 justify-center bg-bg px-6">
      <View className="mx-auto w-full max-w-md">
        <BrandMark
          className="text-fg"
          height={32}
          variant="combination"
          width={128}
        />
        <Text className="mt-8 text-title-md font-medium tracking-tight">
          Continue to Quieter
        </Text>

        <Surface className="mt-6 border-border">
          <View className="gap-4 p-4">
            <Button
              className="w-full"
              onPress={() => {
                googleMutation.mutate();
              }}
              pending={googleMutation.isPending}
              variant="outline"
            >
              <GoogleLogo />
              <Text className="text-fg">Continue with Google</Text>
            </Button>

            {error === null ? null : (
              <Text
                accessibilityLiveRegion="assertive"
                className="text-destructive"
              >
                {error}
              </Text>
            )}
          </View>
        </Surface>

        <Text className="mt-6 text-caption text-muted-fg">
          By continuing you agree to our{" "}
          <Text
            className="underline"
            onPress={() => {
              void Linking.openURL(`${webUrl}/terms`);
            }}
          >
            Terms
          </Text>{" "}
          and{" "}
          <Text
            className="underline"
            onPress={() => {
              void Linking.openURL(`${webUrl}/privacy`);
            }}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
    </View>
  );
};
