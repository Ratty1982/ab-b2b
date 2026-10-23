export type CustomerSalesUploadRole = "HISTORY_561L" | "HISTORY_SLRB" | "ONGOING";

export type SavedCustomerSalesUpload = {
  uploadId: string;
  filename: string;
  bytes: number;
  sha256: string;
  role: CustomerSalesUploadRole;
  expiresAt: string;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function uploadCustomerSalesReport(input: {
  file: File;
  companyId: string;
  role: CustomerSalesUploadRole;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<SavedCustomerSalesUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/customer-sales-uploads");
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-company-id", input.companyId);
    xhr.setRequestHeader("x-upload-role", input.role);
    xhr.setRequestHeader("x-filename", input.file.name);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded, event.total);
    };
    xhr.onerror = () => reject(new Error("Upload failed before the report could be stored."));
    xhr.onload = () => {
      let body: { ok?: boolean; error?: string; data?: SavedCustomerSalesUpload } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.ok && body.data) {
        resolve(body.data);
        return;
      }
      reject(new Error(body.error || `Upload failed (${xhr.status}). No sales records were written.`));
    };
    xhr.send(input.file);
  });
}
