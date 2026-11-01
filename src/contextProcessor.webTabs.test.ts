import type { App, WorkspaceLeaf } from "obsidian";
import { ContextProcessor } from "@/contextProcessor";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import { getYouTubeVideoId } from "@/utils/youtubeUrl";

jest.mock("@/logger");
jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(),
}));

const app = {} as App;
const pageUrl = "https://example.com/research";
const videoUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const leaf = { view: {} } as WorkspaceLeaf;
const service = {
  getYouTubeVideoId,
  getAvailability: jest.fn(() => ({ supported: true, available: true })),
  findLeafByUrl: jest.fn((): WorkspaceLeaf | null => leaf),
  getLeaves: jest.fn(() => [leaf]),
  getPageInfo: jest.fn(() => ({ url: pageUrl, title: "Research & evidence", mode: "reader" })),
  getReaderModeMarkdown: jest.fn(async () => "# Findings\nUse <source> & evidence."),
  getYouTubeTranscript: jest.fn(async () => ({
    videoId: "jNQXAC9IVRw",
    title: "Video findings",
    channel: "Research channel",
    transcript: [{ timestamp: "0:01", text: "The key finding." }],
  })),
};

describe("contextProcessor", () => {
  describe("ContextProcessor", () => {
    let processor: ContextProcessor;

    beforeEach(() => {
      jest.clearAllMocks();
      service.findLeafByUrl.mockReturnValue(leaf);
      service.getPageInfo.mockReturnValue({
        url: pageUrl,
        title: "Research & evidence",
        mode: "reader",
      });
      jest
        .mocked(getWebViewerService)
        .mockReturnValue(service as unknown as ReturnType<typeof getWebViewerService>);
      processor = ContextProcessor.getInstance(app);
    });

    describe("getInstance()", () => {
      it("returns the initialized processor when the agent requests it without an app", () => {
        expect(ContextProcessor.getInstance()).toBe(processor);
      });
    });

    describe("processContextWebTabs()", () => {
      it("returns no context without accessing the web viewer when no tabs are attached", async () => {
        expect(await processor.processContextWebTabs([])).toBe("");
        expect(getWebViewerService).not.toHaveBeenCalled();
      });

      it("includes an attached active page's text with escaped metadata and content", async () => {
        const result = await processor.processContextWebTabs([{ url: pageUrl, isActive: true }]);

        expect(result).toContain("<active_web_tab>");
        expect(result).toContain("<title>Research &amp; evidence</title>");
        expect(result).toContain(`<url>${pageUrl}</url>`);
        expect(result).toContain("# Findings\nUse &lt;source&gt; &amp; evidence.");
        expect(service.getYouTubeTranscript).not.toHaveBeenCalled();
      });

      it("includes the transcript and metadata of an attached YouTube tab", async () => {
        service.getPageInfo.mockReturnValue({ url: videoUrl, title: "Video", mode: "reader" });

        const result = await processor.processContextWebTabs([{ url: videoUrl, isActive: true }]);

        expect(result).toContain("<youtube_video_context>");
        expect(result).toContain("<video_id>jNQXAC9IVRw</video_id>");
        expect(result).toContain("<title>Video findings</title>");
        expect(result).toContain("<channel>Research channel</channel>");
        expect(result).toContain("<is_active>true</is_active>");
        expect(result).toContain("0:01: The key finding.");
        expect(service.getReaderModeMarkdown).not.toHaveBeenCalled();
      });

      it("reports a closed attached tab without trying to extract its content", async () => {
        service.findLeafByUrl.mockReturnValue(null);

        const result = await processor.processContextWebTabs([{ url: pageUrl }]);

        expect(result).toContain("<web_tab_context>");
        expect(result).toContain("<error>Web tab not found or closed</error>");
        expect(service.getReaderModeMarkdown).not.toHaveBeenCalled();
      });
    });
  });
});
