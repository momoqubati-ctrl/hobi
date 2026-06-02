import { createSocketServer, getIO } from "../socket";
import { runAutoMigrations, verifyDatabaseSchema } from "../db/migrate";

let migrationDone = false;

export default (nitroApp: any) => {
  let initialized = false;

  nitroApp.hooks.hook("request", async (event: any) => {
    if (initialized) return;

    // تشغيل الـ migrations تلقائياً مرة واحدة عند أول طلب
    if (!migrationDone) {
      try {
        await runAutoMigrations();
        migrationDone = true;

        const schemaCheck = await verifyDatabaseSchema();
        if (schemaCheck.missingTables.length > 0) {
          console.error("[Migration] Missing tables after auto-migration:", schemaCheck.missingTables);
        }
      } catch (error) {
        console.error("[Migration] Error running auto-migrations:", error);
      }
    }

    // في وضع التطوير (Vite)، الـ Socket.io مُدار بواسطة Vite plugin — لا ننشئ خادماً جديداً
    if ((globalThis as any).__VITE_SOCKET_IO_CREATED__) {
      initialized = true;
      return;
    }

    // Extract the raw HTTP server instance from the request/response socket
    const httpServer = event.node.req.socket?.server || event.node.res.socket?.server;
    
    if (httpServer) {
      try {
        createSocketServer(httpServer);
        initialized = true;
        console.log("[Socket.io] Successfully initialized Socket.io server on Nitro HTTP server");
      } catch (error) {
        console.error("[Socket.io] Error initializing Socket.io server:", error);
      }
    }
  });
};
