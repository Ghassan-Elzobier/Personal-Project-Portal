import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Who a Claude connector call acts for. The MCP endpoint has no browser
// session, so the bits of state the tools need (the Google connection) come
// from the token lookup and travel with the call instead of from cookies.

export type ConnectorCaller = {
  accountId: string;
  google: { sealed: string; email: string | null; connectedAt: string } | null;
};

const storage = new AsyncLocalStorage<ConnectorCaller>();

export function runAsConnector<T>(caller: ConnectorCaller, fn: () => Promise<T>): Promise<T> {
  return storage.run(caller, fn);
}

export function connectorCaller(): ConnectorCaller | undefined {
  return storage.getStore();
}
