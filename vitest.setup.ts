import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Stub server-only and next/headers in test env
vi.mock("server-only", () => ({}));
