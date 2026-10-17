"use client";

import { backendUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FileImage } from "./photos-section";

// Photo uploads one at a time, with progress, for staff adding a home in
// the field on patchy mobile data. Each photo is its own
// POST /listings/<id>/photos/, so a dropped connection costs one photo,
// not the whole batch, and only the failed ones are sent again.

export type PhotoUpload = {
  state: "uploading" | "done" | "failed";
  /** 0 to 1. */
  progress: number;
  error?: string;
};

// XHR, not fetch: fetch can't report upload progress. Same-origin proxy
// route as authedFetch, so the session cookie rides along and the proxy
// refreshes an expired token the same way.
export function uploadPhoto(
  listingId: string | number,
  file: File,
  onProgress: (progress: number) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", backendUrl(`/listings/${listingId}/photos/`));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true });
        return;
      }
      let message = `Upload failed (HTTP ${xhr.status}).`;
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
      } catch {
        // Not JSON (a proxy or gateway error page): keep the status.
      }
      resolve({ ok: false, message });
    };
    xhr.onerror = () => resolve({ ok: false, message: "The connection dropped." });
    const body = new FormData();
    body.append("images", file);
    xhr.send(body);
  });
}

export function PhotoUploadList({
  files,
  uploads,
}: {
  files: File[];
  uploads: Map<File, PhotoUpload>;
}) {
  return (
    <ul aria-label="Photo uploads" className="flex flex-col gap-3">
      {files.map((file) => {
        const upload = uploads.get(file);
        const percent = Math.round((upload?.progress ?? 0) * 100);
        return (
          <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-3">
            <FileImage file={file} alt="" className="bg-surface size-12 shrink-0 rounded-md object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate text-[13px] leading-5">{file.name}</p>
              <div
                role="progressbar"
                aria-label={`Uploading ${file.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="bg-muted h-1.5 overflow-hidden rounded-full"
              >
                <div
                  className={cn(
                    "h-full transition-[width]",
                    upload?.state === "failed" ? "bg-destructive" : "bg-primary",
                  )}
                  style={{ width: `${upload?.state === "failed" ? 100 : percent}%` }}
                />
              </div>
              <p
                className={cn(
                  "text-[12px] leading-4",
                  upload?.state === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {!upload
                  ? "Waiting"
                  : upload.state === "done"
                    ? "Uploaded"
                    : upload.state === "failed"
                      ? `Didn't upload: ${upload.error}`
                      : `${percent}%`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
