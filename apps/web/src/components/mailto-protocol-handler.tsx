"use client";

import { useEffect } from "react";

export const MailtoProtocolHandler = () => {
  useEffect(() => {
    if (!("registerProtocolHandler" in navigator)) {
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
