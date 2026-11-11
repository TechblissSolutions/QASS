"use client";

import { Toaster, toast } from "@yusufceng1z/ding-react";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const btn =
  "rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

export default function DingToast() {
  return (
    <div className="flex min-h-64 flex-wrap items-center justify-center gap-2 p-6">
      <Toaster position="top-center" theme="system" />
      <button className={btn} onClick={() => toast.success("Saved")}>
        Success
      </button>
      <button className={btn} onClick={() => toast.error("Upload failed", { description: "Check your connection and try again." })}>
        Error
      </button>
      <button className={btn} onClick={() => toast.info("New version available", { action: { label: "Update", onClick: () => ({ type: "success", title: "Updated", action: null }) } })}>
        With action
      </button>
      <button
        className={btn}
        onClick={() =>
          toast.promise(wait(1500), {
            loading: "Uploading",
            success: "Uploaded",
            error: "Upload failed",
          })
        }
      >
        Promise
      </button>
    </div>
  );
}
