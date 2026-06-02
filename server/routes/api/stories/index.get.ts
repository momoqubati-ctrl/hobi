import { defineEventHandler, getQuery } from "h3";
import { getActiveStories, getUserStories } from "../../../services/storyService";

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const userId = String(query.userId || "");

    let result;
    if (userId) {
      result = await getUserStories(userId);
    } else {
      result = await getActiveStories();
    }

    return { success: true, stories: result };
  } catch (err) {
    console.error("[Stories API] GET error:", err);
    return { success: false, error: "فشل تحميل القصص" };
  }
});
