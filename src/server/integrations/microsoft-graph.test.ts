import { describe, expect, it, vi } from "vitest";
import { createMicrosoftGraphClient } from "@/server/integrations/microsoft-graph";

describe("microsoft graph client", () => {
  it("paginates folder children via @odata.nextLink", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(
          JSON.stringify({ access_token: "tok", expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (url.includes("/children") && !url.includes("skiptoken")) {
        return new Response(
          JSON.stringify({
            value: [
              { id: "1", name: "a.pdf", file: { mimeType: "application/pdf" } },
              { id: "2", name: "notes.txt", file: { mimeType: "text/plain" } },
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/drives/d/items/f/children?$skiptoken=2",
          }),
          { status: 200 },
        );
      }
      if (url.includes("skiptoken")) {
        return new Response(
          JSON.stringify({
            value: [{ id: "3", name: "b.pdf", file: { mimeType: "application/pdf" } }],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    const client = createMicrosoftGraphClient(
      {
        tenantId: "t",
        clientId: "c",
        clientSecret: "s",
      },
      fetchMock as unknown as typeof fetch,
    );

    const items = await client.listFolderChildren("d", "f", { pageSize: 2 });
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.name)).toEqual(["a.pdf", "notes.txt", "b.pdf"]);
    expect(fetchMock).toHaveBeenCalled();
    // Token response must not leak into return values
    expect(JSON.stringify(items)).not.toContain("tok");
  });

  it("maps auth failures without returning secrets", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "Invalid client secret",
        }),
        { status: 401 },
      ),
    );
    const client = createMicrosoftGraphClient(
      { tenantId: "t", clientId: "c", clientSecret: "super-secret-value" },
      fetchMock as unknown as typeof fetch,
    );
    await expect(client.getUserDrive("a@b.com")).rejects.toThrow(/Authentication failed/i);
  });
});
