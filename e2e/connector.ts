import { createHash, randomBytes } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

// Claude's side of the connector, for the save tests. It connects the way Claude's
// app does (the consent page, then a token for the code), calls tools over
// /api/mcp, and disconnects again so the Claude page is left as it was found.

/** The only address the portal hands a code to. The suite answers it itself, so nothing leaves the machine. */
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

export type ListedTool = {
  name: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
};

/** A tool's answer: its text, and whether the tool called it an error. */
export type ToolAnswer = { isError: boolean; text: string };

type Rpc = {
  result?: { tools?: ListedTool[]; content?: { type: string; text: string }[]; isError?: boolean };
  error?: { code: number; message: string };
};

export async function connectClaude(page: Page, request: APIRequestContext) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const clientId = `e2e-${randomBytes(6).toString("hex")}`;

  await page.route(`${CALLBACK}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "connected" }),
  );
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "e2e",
  });
  await page.goto(`/oauth/authorize?${query}`);
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL((url) => url.href.startsWith(CALLBACK));
  const code = new URL(page.url()).searchParams.get("code") ?? "";
  expect(code, "the consent page hands Claude a code").not.toBe("");
  await page.unroute(`${CALLBACK}**`);

  const exchange = await request.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: CALLBACK,
    },
  });
  expect(exchange.ok(), "the code buys a token").toBe(true);
  const { access_token: token } = (await exchange.json()) as { access_token: string };

  let id = 0;
  const rpc = async (method: string, params?: object): Promise<Rpc> => {
    const answer = await request.post("/api/mcp", {
      headers: { Authorization: `Bearer ${token}` },
      data: { jsonrpc: "2.0", id: ++id, method, params },
    });
    expect(answer.ok(), `${method} is answered`).toBe(true);
    return (await answer.json()) as Rpc;
  };

  return {
    /** Every tool, as Claude is told about it. */
    async tools(): Promise<ListedTool[]> {
      return (await rpc("tools/list")).result?.tools ?? [];
    },
    /** Calls a tool. A call the protocol itself refuses (an unknown tool) fails the test. */
    async call(name: string, args: unknown = {}): Promise<ToolAnswer> {
      const { result, error } = await rpc("tools/call", { name, arguments: args });
      expect(error, `${name} is one of the tools`).toBeUndefined();
      return { isError: result?.isError ?? false, text: result?.content?.[0]?.text ?? "" };
    },
    /** Ends every connection, as the Claude page's own button does. */
    async disconnect() {
      await page.goto("/claude");
      await page.getByRole("button", { name: "Disconnect everything" }).click();
      await expect(page.getByText("Nothing connected yet.")).toBeVisible();
    },
  };
}
