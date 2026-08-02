/**
 * Route-level tests for portal.ts
 *
 * Covers GET /portal/subscribers:
 *   1. Unauthenticated request → 401
 *   2. Authenticated non-operator (OPERATOR_USER_IDS set, user not in list) → 403
 *   3. Authenticated operator (user in OPERATOR_USER_IDS) → 200
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Request, Response, NextFunction } from "express";

// ─── Mock DB before importing the router ──────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() =>
          Promise.resolve([
            {
              id: 1,
              email: "test@example.com",
              name: "Test User",
              source: "portal",
              createdAt: new Date("2026-08-01T00:00:00Z"),
            },
          ])
        ),
      })),
    })),
  },
  guestSubscribersTable: { createdAt: Symbol("createdAt") },
}));

// ─── Mock logger ───────────────────────────────────────────────────────────────

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Mock sportsCache ─────────────────────────────────────────────────────────

const { mockGetPicks, mockLoadPicksFromSnapshot, mockGetCacheStatus } = vi.hoisted(() => ({
  mockGetPicks: vi.fn(() => [] as any[]),
  mockLoadPicksFromSnapshot: vi.fn(() => null as { picks: any[]; savedAt: string } | null),
  mockGetCacheStatus: vi.fn(() => ({ source: "live" as "live" | "snapshot" | "mock" })),
}));

vi.mock("../lib/sportsCache.js", () => ({
  getPicks: mockGetPicks,
  loadPicksFromSnapshot: mockLoadPicksFromSnapshot,
  getCacheStatus: mockGetCacheStatus,
}));

// ─── Mock email helpers ────────────────────────────────────────────────────────

vi.mock("../lib/emailTransport.js", () => ({
  isSmtpConfigured: vi.fn(() => false),
  getTransport: vi.fn(),
}));

vi.mock("../lib/emailTemplate.js", () => ({
  buildWelcomeEmailHtml: vi.fn(() => ""),
  buildWelcomeEmailText: vi.fn(() => ""),
}));

// ─── Import router after mocks are set up ─────────────────────────────────────

import portalRouter from "./portal.js";

// ─── Test app factory ─────────────────────────────────────────────────────────

function makeApp(userId?: string) {
  const app = express();
  app.use(express.json());

  // Inject auth state via middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (userId) {
      (req as any).user = { id: userId, email: null, firstName: null, lastName: null, profileImageUrl: null };
      req.isAuthenticated = function () { return true; } as typeof req.isAuthenticated;
    } else {
      req.isAuthenticated = function () { return false; } as typeof req.isAuthenticated;
    }
    next();
  });

  app.use(portalRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// ─── Sample pick fixture ──────────────────────────────────────────────────────

function makePick(id: string) {
  return {
    id,
    playerName: `Player ${id}`,
    team: "TeamA",
    opponent: "TeamB",
    sport: "NBA",
    propType: "Points",
    line: 22.5,
    direction: "Over" as const,
    projection: 25,
    confidence: 78,
    riskTier: "Balanced" as const,
    explanation: "test",
    socialImpact: null,
    createdAt: new Date().toISOString(),
  };
}

// ─── GET /portal/picks/preview ────────────────────────────────────────────────

describe("GET /portal/picks/preview", () => {
  beforeEach(() => {
    mockGetPicks.mockReturnValue([]);
    mockLoadPicksFromSnapshot.mockReturnValue(null);
    mockGetCacheStatus.mockReturnValue({ source: "live" });
  });

  it("returns source=live when in-memory picks are present", async () => {
    mockGetPicks.mockReturnValue([makePick("p1"), makePick("p2")]);
    mockGetCacheStatus.mockReturnValue({ source: "live" });

    const res = await request(makeApp()).get("/portal/picks/preview");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("live");
    expect(res.body.picks.length).toBeGreaterThan(0);
  });

  it("returns source=snapshot when in-memory cache source is snapshot", async () => {
    mockGetPicks.mockReturnValue([makePick("p1")]);
    mockGetCacheStatus.mockReturnValue({ source: "snapshot" });

    const res = await request(makeApp()).get("/portal/picks/preview");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("snapshot");
  });

  it("falls back to disk snapshot when live cache is empty and snapshot has picks", async () => {
    mockGetPicks.mockReturnValue([]);
    mockGetCacheStatus.mockReturnValue({ source: "live" });
    mockLoadPicksFromSnapshot.mockReturnValue({
      picks: [makePick("snap1"), makePick("snap2")],
      savedAt: "2026-08-01T12:00:00Z",
    });

    const res = await request(makeApp()).get("/portal/picks/preview");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("snapshot");
    expect(res.body.picks.length).toBeGreaterThan(0);
  });

  it("returns empty picks with source=live when both cache and snapshot are empty", async () => {
    mockGetPicks.mockReturnValue([]);
    mockLoadPicksFromSnapshot.mockReturnValue(null);

    const res = await request(makeApp()).get("/portal/picks/preview");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("live");
    expect(res.body.picks).toHaveLength(0);
    expect(res.body.totalAvailable).toBe(0);
  });

  it("returns empty picks with source=live when snapshot has no picks", async () => {
    mockGetPicks.mockReturnValue([]);
    mockLoadPicksFromSnapshot.mockReturnValue({ picks: [], savedAt: "2026-08-01T12:00:00Z" });

    const res = await request(makeApp()).get("/portal/picks/preview");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("live");
    expect(res.body.picks).toHaveLength(0);
  });
});

// ─── GET /portal/subscribers ──────────────────────────────────────────────────

describe("GET /portal/subscribers", () => {
  const originalEnv = process.env["OPERATOR_USER_IDS"];

  beforeEach(() => {
    process.env["OPERATOR_USER_IDS"] = "operator-user-1,operator-user-2";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["OPERATOR_USER_IDS"];
    } else {
      process.env["OPERATOR_USER_IDS"] = originalEnv;
    }
  });

  it("returns 401 for unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/portal/subscribers");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Authentication required" });
  });

  it("returns 403 for authenticated non-operator users", async () => {
    const res = await request(makeApp("regular-user-99")).get("/portal/subscribers");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "Operator access required" });
  });

  it("returns 200 with subscriber data for authenticated operators", async () => {
    const res = await request(makeApp("operator-user-1")).get("/portal/subscribers");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: expect.any(Number),
      last7Days: expect.any(Number),
      dailyCounts: expect.any(Array),
      recent: expect.any(Array),
    });
  });

  it("returns 403 when OPERATOR_USER_IDS is empty (fail-closed)", async () => {
    process.env["OPERATOR_USER_IDS"] = "";
    const res = await request(makeApp("any-user")).get("/portal/subscribers");
    expect(res.status).toBe(403);
  });
});
