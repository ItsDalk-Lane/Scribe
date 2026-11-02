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
