// src/stores/updater.ts
import { defineStore } from "pinia";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "progress"
  | "downloaded"
  | "error"
  | "installing";

export interface UpdatePayload {
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
  releaseNotes?: string;
  releaseName?: string;
  releaseDate?: string;
  silent?: boolean;
}

export const useUpdaterStore = defineStore("updater", {
  state: () => ({
    visible: false as boolean,
    status: "idle" as UpdaterStatus,
    payload: {} as UpdatePayload,
  }),
  actions: {
    handleStatus({
      status,
      payload,
    }: {
      status: UpdaterStatus;
      payload?: UpdatePayload;
    }) {
      this.status = status;
      this.payload = payload || {};
      this.visible = !payload?.silent;
    },
    close() {
      this.visible = false;
      this.status = "idle";
      this.payload = {};
    },
  },
});
