import { createSocketServer, getIO } from "../socket";

export default (nitroApp: any) => {
  let initialized = false;

  nitroApp.hooks.hook("request", async (event: any) => {
    if (initialized) return;

    // في وضع التطوير (Vite)، الـ Socket.io مُدار بواسطة Vite plugin — لا ننشئ خادماً جديداً
    const viteFlag = (process as any).__VITE_SOCKET_IO_CREATED__ || (globalThis as any).__VITE_SOCKET_IO_CREATED__;
    if (viteFlag) {
      initialized = true;
      console.log("[Socket.io] Skipping Nitro Socket.io init (Vite plugin owns it)");
      return;
    }

    // Extract the raw HTTP server instance from the request/response socket
    const httpServer = event.node.req.socket?.server || event.node.res.socket?.server;
    
    if (httpServer) {
      try {
        (httpServer as any).__NITRO_PID__ = process.pid;
        createSocketServer(httpServer);
        initialized = true;
        console.log("[Socket.io] Successfully initialized Socket.io server on Nitro HTTP server");
      } catch (error) {
        console.error("[Socket.io] Error initializing Socket.io server:", error);
      }
    }
  });
};


