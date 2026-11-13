import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { anonClient } from "./anon";
import { createClient } from "./server";

// Who a call acts for. A page has the browser session in its cookies; a Claude
// connector call has none, so the MCP endpoint looks up its token and the bits
// of state the tools need (the Google connection) travel with the call instead.

export type ConnectorCaller = {
  accountId: string;
  /** Hash of the caller's token, which the tracker_* RPCs check for connector calls. */
  accessHash: string;
  google: { sealed: string; email: string | null; connectedAt: string } | null;
};

const storage = new AsyncLocalStorage<ConnectorCaller>();

export function runAsConnector<T>(caller: ConnectorCaller, fn: () => Promise<T>): Promise<T> {
  return storage.run(caller, fn);
}

export function connectorCaller(): ConnectorCaller | undefined {
  return storage.getStore();
}

/** Calls an RPC as the caller: browser calls use the session, connector calls prove themselves with their token's hash. */
export async function rpcAsCaller(name: string, args: Record<string, unknown> = {}) {
  const connector = connectorCaller();
  const client = connector ? anonClient() : await createClient();
  return client.rpc(name, connector ? { ...args, p_access_hash: connector.accessHash } : args);
}
