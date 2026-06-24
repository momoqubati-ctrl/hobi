import { initMinio } from "../services/minioClient";

let initialized = false;

export default (nitroApp: any) => {
  nitroApp.hooks.hook("request", async () => {
    if (initialized) return;
    initialized = true;

    await initMinio();
  });
};
