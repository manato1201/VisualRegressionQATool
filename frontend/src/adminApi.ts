import { request } from "./api";
import type { ReferenceImage } from "./types";

/** 管理者だけの API(サーバーも admin に限る)。メイン画面のバンドルには入れない(admin/ だけが読む)。 */
export const adminApi = {
  promoteReference: (capturedImageId: string, approvedBy: string) =>
    request<ReferenceImage>("/api/references/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        captured_image_id: capturedImageId,
        approved_by: approvedBy,
      }),
    }),

  deleteCapturedImage: (capturedImageId: string) =>
    request<void>(`/api/captures/${encodeURIComponent(capturedImageId)}`, {
      method: "DELETE",
    }),
};
