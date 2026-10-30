export {};

interface Pending { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; }
export interface CdpMessage { method?: string; id?: number; sessionId?: string; params?: any; result?: any; error?: any; }
export class CdpConnection {
  readonly ws: WebSocket;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private subscribers = new Set<(message: CdpMessage) => void>();
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(`${message.error.code}: ${message.error.message}`)) : pending.resolve(message.result);
        return;
      }
      for (const listener of this.subscribers) listener(message);
    });
    ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP WebSocket closed')); }
      this.pending.clear();
    });
  }
  static async connect(url: string) {
    const ws = new WebSocket(url);
    const cdp = new CdpConnection(ws);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), 10000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once:true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection error')); }, { once:true });
    });
    return cdp;
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) { reject(new Error('CDP socket is not open')); return; }
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  listen(listener: (message: CdpMessage) => void) { this.subscribers.add(listener); return () => this.subscribers.delete(listener); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}
export class CdpSession {
  readonly connection: CdpConnection;
  readonly sessionId: string;
  constructor(connection: CdpConnection, sessionId: string) { this.connection = connection; this.sessionId = sessionId; }
  send(method: string, params: Record<string, unknown> = {}, timeoutMs?: number) { return this.connection.send(method, params, this.sessionId, timeoutMs); }
  async evaluate<T = any>(expression: string): Promise<T> {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed');
    return response.result?.value as T;
  }
}
