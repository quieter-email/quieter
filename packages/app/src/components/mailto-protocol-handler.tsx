"use client";

import { useEffect } from "react";

import { appRuntime } from "../runtime";

export const MailtoProtocolHandler = () => {
  useEffect(() => {
    if (
      appRuntime.platform === "desktop" ||
      !("registerProtocolHandler" in navigator)
    ) {
      return;
    }

    try {
      navigator.registerProtocolHandler("mailto", "/?compose=mailto&mailto=%s");
    } catch {
      // Browsers may reject registration outside supported contexts or when already registered.
    }
  }, []);

  return null;
};
