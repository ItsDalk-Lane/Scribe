import { createGitlabAccessToken } from "./createGitlabAccessToken";
function response(payload: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => payload } as Response;
}

describe("createGitlabAccessToken", () => {
  describe("createGitlabAccessToken()", () => {
    it("uses the public direct-access endpoint and shares cached credentials for 25 minutes", async () => {
      let now = 1000;
      const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
      const token = { token: "direct-fixture", headers: { "x-gitlab-id": "fixture" } };
      const transport = jest.fn(async () => response(token));
      try {
        const getToken = createGitlabAccessToken(
          "https://gitlab.fixture.invalid/",
          "Bearer user-token",
          transport
        );
        const controller = new AbortController();
        expect(await Promise.all([getToken(controller.signal), getToken()])).toEqual([
          token,
          token,
        ]);
        const [url, request] = (transport.mock.calls as unknown as Array<[string, RequestInit]>)[0];
        expect(url).toBe(
          "https://gitlab.fixture.invalid/api/v4/ai/third_party_agents/direct_access"
        );
        expect(new Headers(request.headers).get("Authorization")).toBe("Bearer user-token");
        expect(request.signal).not.toBe(controller.signal);
        expect(request.signal).toBeInstanceOf(AbortSignal);
        expect(JSON.parse(request.body as string)).toEqual({
          feature_flags: { DuoAgentPlatformNext: true },
        });
        expect(await getToken()).toEqual(token);
        expect(transport).toHaveBeenCalledTimes(1);
        now += 25 * 60 * 1000;
        expect(await getToken()).toEqual(token);
        expect(transport).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });
    it("clears a rejected token exchange and retains status for the shared retry policy", async () => {
      const transport = jest
        .fn()
        .mockResolvedValueOnce(response({}, 401))
        .mockResolvedValueOnce(response({ token: "new-token", headers: {} }));
      const getToken = createGitlabAccessToken(
        "https://gitlab.fixture.invalid",
        "user-token",
        transport
      );
      await expect(getToken()).rejects.toMatchObject({ statusCode: 401 });
      expect(await getToken()).toEqual({ token: "new-token", headers: {} });
    });
    it("expires a stalled exchange, retries it and ignores its late result (https://github.com/ItsDalk-Lane/Scribe/issues/61)", async () => {
      jest.useFakeTimers();
      let release!: (value: Response) => void;
      const firstResponse = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const transport = jest
        .fn()
        .mockReturnValueOnce(firstResponse)
        .mockResolvedValue(response({ token: "fresh-token", headers: {} }));
      const getToken = createGitlabAccessToken("https://gitlab.fixture.invalid", "key", transport);
      const outcomes: unknown[] = [];
      const first = getToken().catch((error: unknown) => {
        outcomes.push(error);
      });
      try {
        await jest.advanceTimersByTimeAsync(15_000);
        expect(outcomes).toEqual([expect.objectContaining({ name: "TimeoutError" })]);
        await first;
        expect(await getToken()).toEqual({ token: "fresh-token", headers: {} });
        let readLate!: () => void;
        const lateRead = new Promise<void>((resolve) => {
          readLate = resolve;
        });
        release({
          ok: true,
          json: async () => {
            readLate();
            return { token: "stale-token", headers: {} };
          },
        } as Response);
        await lateRead;
        expect(await getToken()).toEqual({ token: "fresh-token", headers: {} });
        expect(transport).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it("stops only a cancelled caller while another caller receives the shared token (https://github.com/ItsDalk-Lane/Scribe/issues/61)", async () => {
      let release!: (value: Response) => void;
      const transport = jest.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          })
      );
      const getToken = createGitlabAccessToken("https://gitlab.fixture.invalid", "key", transport);
      const controller = new AbortController();
      const first = getToken(controller.signal).catch((error: unknown) => error);
      const second = getToken();
      controller.abort();
      const outcomes: unknown[] = [];
      const observed = first.then((value) => {
        outcomes.push(value);
      });
      release(response({ token: "shared-token", headers: {} }));
      await observed;
      expect(outcomes).toEqual([expect.objectContaining({ name: "AbortError" })]);
      expect(await second).toEqual({ token: "shared-token", headers: {} });
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it.each([{}, { token: "", headers: {} }, { token: "fixture", headers: { invalid: 42 } }])(
      "rejects malformed direct-access response %j",
      async (payload) => {
        await expect(
          createGitlabAccessToken("https://gitlab.fixture.invalid", "user-token", async () =>
            response(payload)
          )()
        ).rejects.toThrow("Unexpected response");
      }
    );
  });
});
