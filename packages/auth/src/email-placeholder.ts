type AuthEmailPreviewType = "magic-link" | "verification";

type AuthEmailPreview = {
  createdAt: number;
  email: string;
  token: string;
  type: AuthEmailPreviewType;
  url: string;
};

const previews = new Map<string, AuthEmailPreview>();

export const storeAuthEmailPreview = (
  preview: Omit<AuthEmailPreview, "createdAt" | "email"> & {
    email: string;
  },
) => {
  previews.set(preview.email.trim().toLowerCase(), {
    ...preview,
    createdAt: Date.now(),
    email: preview.email.trim().toLowerCase(),
  });
};

export const getAuthEmailPreview = (email: string) => {
  return previews.get(email.trim().toLowerCase()) ?? null;
};
