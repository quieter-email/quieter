import { vi } from "vite-plus/test";

vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/quieter");
