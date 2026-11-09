/**
 * Isolated Mock Socket Implementation for Frontend Component Benchmarking
 * Replaces '@/lib/socket' via Vite alias in vite.harness.config.ts
 * Strictly isolated: Zero network requests, zero backend dependencies.
 */

import { mockProfiles } from "./mockProfileData";

type EventHandler = (...args: any[]) => void;

class MockSocket {
  public id = "mock-socket-test-id";
  public connected = true;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private latencyMs = 0; // Configurable mock network delay
  public lastEmitTimestamps: Map<string, number> = new Map();

  public setLatency(ms: number) {
    this.latencyMs = Math.max(0, ms);
  }

  public getLatency(): number {
    return this.latencyMs;
  }

  public on(event: string, handler: EventHandler): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return this;
  }

  public off(event: string, handler: EventHandler): this {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
    return this;
  }

  public removeAllListeners(event?: string): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  public emit(event: string, ...args: any[]): this {
    this.lastEmitTimestamps.set(event, performance.now());

    // Extract callback if last argument is a function
    const lastArg = args[args.length - 1];
    const callback = typeof lastArg === "function" ? lastArg : null;
    const payload = args[0] || {};

    const executeResponse = () => {
      if (event === "profile:view") {
        const requestedId = payload.profileId || "user-standard-1";
        const bundle = mockProfiles[requestedId] || mockProfiles["user-standard-1"];
        if (callback) {
          callback({
            success: true,
            profile: JSON.parse(JSON.stringify(bundle.profile)),
            stats: JSON.parse(JSON.stringify(bundle.stats)),
            relationship: JSON.parse(JSON.stringify(bundle.relationship)),
            visitors: JSON.parse(JSON.stringify(bundle.visitors)),
          });
        }
      } else if (event === "profile:like") {
        if (callback) callback({ success: true, likes: 343 });
      } else if (event === "profile:follow") {
        if (callback) callback({ success: true, isFollowing: true });
      } else if (event === "profile:visitors") {
        const requestedId = payload.profileId || "user-standard-1";
        const bundle = mockProfiles[requestedId] || mockProfiles["user-standard-1"];
        if (callback) callback({ success: true, visitors: bundle.visitors });
      } else if (callback) {
        callback({ success: true });
      }
    };

    if (this.latencyMs > 0) {
      setTimeout(executeResponse, this.latencyMs);
    } else {
      // Immediate execution
      executeResponse();
    }

    return this;
  }

  // Trigger incoming server broadcast to component listeners
  public triggerServerEvent(event: string, data: any) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((h) => {
        try {
          h(data);
        } catch (e) {
          console.error(`[MockSocket] Error in listener for ${event}:`, e);
        }
      });
    }
  }

  public connect(): this {
    this.connected = true;
    return this;
  }

  public disconnect(): this {
    this.connected = false;
    return this;
  }
}

// Global Singleton instance for test harness
export const mockSocketInstance = new MockSocket();

export function getSocket(): any {
  return mockSocketInstance;
}

export function isSocketConnected(): boolean {
  return mockSocketInstance.connected;
}

export function reconnectSocket(): any {
  return mockSocketInstance.connect();
}

export function disconnectSocket(): void {
  mockSocketInstance.disconnect();
}

export function refreshSocketAuth(): void {
  // No-op for mock harness
}

export function logoutSocket(): void {
  mockSocketInstance.disconnect();
}

export function hasValidUserAuth(): boolean {
  return true;
}
