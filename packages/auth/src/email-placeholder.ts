type AuthEmailPreviewType = "magic-link" | "verification";

type AuthEmailPreview = {
  createdAt: number;
  email: string;
  token: string;
  type: AuthEmailPreviewType;
  url: string;
};

const previews = new Map<string, AuthEmailPreview>();

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const storeAuthEmailPreview = (
  preview: Omit<AuthEmailPreview, "createdAt" | "email"> & {
    email: string;
  },
) => {
  previews.set(normalizeEmail(preview.email), {
    ...preview,
    createdAt: Date.now(),
    email: normalizeEmail(preview.email),
  });
};

export const getAuthEmailPreview = (email: string) => {
  return previews.get(normalizeEmail(email)) ?? null;
};
